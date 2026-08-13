"""RED tests for the national <-> PBA jurisdiction crosswalk, cross-year mesa
stability, and the fiscalización mesa identity join (`jurisdiction-model`
spec; design D9.5; the ACCEPTED mesa-identity decision, Engram #1410).

Fixtures, all derived from real data, never from a live network fetch:

- `crosswalk_national_2023_sample.csv` / `crosswalk_national_2025_sample.csv`:
  distrito 02 / seccion 027, mesas 1-2 sliced from the same real archived
  sources as `national_202{3,5}_sample.csv` (Phase 3), PLUS a real mesa 3
  sliced from `archive/national_2023_paso/2023-PROVISORIOS_PASO.zip`
  (cargo PRESIDENTE/A, agrupaciones 134/135) that has NO 2025 counterpart in
  this fixture set — a genuine, deliberately-scoped discontinuity used only
  by the cross-year stability tests. This is a separate, dedicated fixture
  pair from Phase 3's `national_202{3,5}_sample.csv` so Phase 3's row-count
  assertions are never touched by Phase 4 fixture changes.
- `fiscalizacion_2025_stripped_sample.csv`: 4 real rows (mesas 1, 3, 45, 149)
  sliced directly from the real, user-supplied fiscalización CSV
  (`~/Documents/Carga de Datos de Fiscalización - La Libertad Avanza -
  Elecciones 2025 - Mesas Procesadas.csv`, outside the repo), with the
  `Nombre`/`Apellido` columns dropped before the file was ever written here
  (D9.3 — personal data never reaches a committed fixture). `Escuela` is
  retained per D9.3. The 4 mesas were chosen to exercise every divergence
  shape measured in Engram #1410: mesa 45 is an exact 17-column match; mesa
  1 diverges only on `Impugnado`; mesa 3 diverges only on a genuine party
  column (`Union Liberal`); a fourth mesa is unused directly here but kept
  for `national_2025_027_diputados_sample.csv` completeness.
- `national_2025_027_diputados_sample.csv`: the official counterpart rows
  (`POSITIVO`/`EN BLANCO`/`IMPUGNADO` only) for the same 4 mesas, sliced
  directly from the real archived 2025 national ZIP now at
  `archive/national_2025/legislativas2025.zip`
  (sha256 5fb19bb280af8895dc0bc2ac19d79e836fb4053b713a135357743bf35371ee4b),
  filtered to distrito 02 / seccion 027 / cargo DIPUTADO NACIONAL.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import psycopg
import pytest
import yaml

from etl.__main__ import find_unmapped_jurisdictions
from etl.crosswalk import (
    OFFICIAL_AGRUPACION_NAME_BY_COLUMN,
    OFFICIAL_VOTOS_TIPO_BY_COLUMN,
    CrosswalkTable,
    CrosswalkValidationError,
    DuplicateCrosswalkKeyError,
    FiscalizacionMesaRow,
    JurisdictionCrosswalkEntry,
    MesaStability,
    OfficialMesaVotes,
    compute_mesa_stability,
    join_fiscalizacion_identity,
    load_crosswalk,
)
from etl.db import load_crosswalk_rows
from etl.ingest.national import ingest_national
from etl.jurisdiction import QuarantinedPbaDistrito, resolve_pba_distrito_code

FIXTURES = Path(__file__).parent / "fixtures"
CURATED = Path(__file__).parent.parent.parent / "curated"


def _read(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def _load_crosswalk_table() -> CrosswalkTable:
    return load_crosswalk(CURATED / "crosswalk.yaml")


def test_crosswalk_loader_replaces_the_curated_projection_and_empty_input_clears_it() -> None:
    dsn = os.environ.get(
        "ETL_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    )
    try:
        conn = psycopg.connect(dsn, connect_timeout=2)
    except psycopg.OperationalError as exc:
        pytest.skip(f"no ephemeral Postgres reachable at {dsn!r}: {exc}")

    token = uuid.uuid4().int
    desired = JurisdictionCrosswalkEntry(
        pba_distrito_code=str(token),
        national_distrito_code="2",
        national_seccion_code="27",
        name="Desired",
    )
    stale = JurisdictionCrosswalkEntry(
        pba_distrito_code=str(token + 1),
        national_distrito_code="3",
        national_seccion_code="28",
        name="Stale",
    )
    desired_stability = MesaStability(circuito="1", mesa=1, present_2023=True, present_2025=True)
    stale_stability = MesaStability(circuito="2", mesa=2, present_2023=True, present_2025=False)

    try:
        load_crosswalk_rows(
            conn,
            CrosswalkTable(jurisdictions=(desired, stale)),
            mesa_stabilities=(("2", "27", desired_stability), ("3", "28", stale_stability)),
        )
        with conn.cursor() as cur:
            cur.execute("select count(*) from archive_entry")
            archive_count = cur.fetchone()
            cur.execute("select count(*) from election")
            election_count = cur.fetchone()
            cur.execute("select count(*) from result_row")
            result_count = cur.fetchone()

        load_crosswalk_rows(
            conn,
            CrosswalkTable(jurisdictions=(desired,)),
            mesa_stabilities=(("2", "27", desired_stability),),
        )
        with conn.cursor() as cur:
            cur.execute("select pba_distrito_code from jurisdiction_crosswalk")
            assert cur.fetchall() == [(desired.pba_distrito_code,)]
            cur.execute(
                "select distrito_code, seccion_code, circuito_code, mesa_code from mesa_crosswalk"
            )
            assert cur.fetchall() == [
                ("02", "027", desired_stability.circuito, desired_stability.mesa)
            ]

        load_crosswalk_rows(conn, CrosswalkTable(jurisdictions=()), mesa_stabilities=())
        with conn.cursor() as cur:
            cur.execute("select count(*) from jurisdiction_crosswalk")
            assert cur.fetchone() == (0,)
            cur.execute("select count(*) from mesa_crosswalk")
            assert cur.fetchone() == (0,)
            cur.execute("select count(*) from archive_entry")
            assert cur.fetchone() == archive_count
            cur.execute("select count(*) from election")
            assert cur.fetchone() == election_count
            cur.execute("select count(*) from result_row")
            assert cur.fetchone() == result_count
    finally:
        conn.rollback()
        conn.close()


@pytest.mark.parametrize(
    "content",
    [
        "- not-a-mapping\n",
        "jurisdictions: not-a-list\n",
        "jurisdictions:\n  - not-a-mapping\n",
    ],
)
def test_crosswalk_loader_rejects_invalid_yaml_shapes(tmp_path: Path, content: str) -> None:
    path = tmp_path / "crosswalk.yaml"
    path.write_text(content, encoding="utf-8")

    with pytest.raises(CrosswalkValidationError, match="crosswalk.yaml"):
        load_crosswalk(path)


@pytest.mark.parametrize("field", ["pba_distrito", "national_distrito", "national_seccion", "name"])
@pytest.mark.parametrize("bad_value", [None, True, False, 27, "   ", [], {}])
def test_crosswalk_loader_rejects_non_string_or_empty_required_scalars(
    tmp_path: Path, field: str, bad_value: object
) -> None:
    entry: dict[str, object] = {
        "pba_distrito": "027",
        "national_distrito": "02",
        "national_seccion": "027",
        "name": "Coronel Rosales",
    }
    entry[field] = bad_value
    path = tmp_path / "crosswalk.yaml"
    path.write_text(yaml.safe_dump({"jurisdictions": [entry]}), encoding="utf-8")

    with pytest.raises(CrosswalkValidationError) as excinfo:
        load_crosswalk(path)

    message = str(excinfo.value)
    assert "entry 0" in message
    assert field in message


@pytest.mark.parametrize(
    ("field", "bad_value"),
    [
        ("pba_distrito", "O2"),
        ("pba_distrito", "2_7"),
        ("national_distrito", "O2"),
        ("national_distrito", "2_7"),
        ("national_seccion", "O2"),
        ("national_seccion", "2_7"),
    ],
)
def test_crosswalk_loader_rejects_codes_that_cannot_be_canonicalized(
    tmp_path: Path, field: str, bad_value: str
) -> None:
    entry = {
        "pba_distrito": "027",
        "national_distrito": "02",
        "national_seccion": "027",
        "name": "Coronel Rosales",
    }
    entry[field] = bad_value
    path = tmp_path / "crosswalk.yaml"
    path.write_text(yaml.safe_dump({"jurisdictions": [entry]}), encoding="utf-8")

    with pytest.raises(CrosswalkValidationError) as excinfo:
        load_crosswalk(path)

    message = str(excinfo.value)
    assert "entry 0" in message
    assert field in message


@pytest.mark.parametrize(
    "entries",
    [
        [
            {
                "pba_distrito": "027",
                "national_distrito": "02",
                "national_seccion": "027",
                "name": "A",
            },
            {
                "pba_distrito": "027",
                "national_distrito": "02",
                "national_seccion": "028",
                "name": "B",
            },
        ],
        [
            {
                "pba_distrito": "027",
                "national_distrito": "2",
                "national_seccion": "27",
                "name": "A",
            },
            {
                "pba_distrito": "028",
                "national_distrito": "02",
                "national_seccion": "027",
                "name": "B",
            },
        ],
    ],
)
def test_crosswalk_loader_rejects_duplicate_natural_keys(
    tmp_path: Path, entries: list[dict[str, object]]
) -> None:
    path = tmp_path / "crosswalk.yaml"
    path.write_text(yaml.safe_dump({"jurisdictions": entries}), encoding="utf-8")

    with pytest.raises(DuplicateCrosswalkKeyError, match="duplicate"):
        load_crosswalk(path)


def test_crosswalk_loader_normalizes_pba_codes_before_resolution(tmp_path: Path) -> None:
    path = tmp_path / "crosswalk.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "jurisdictions": [
                    {
                        "pba_distrito": "27",
                        "national_distrito": "02",
                        "national_seccion": "027",
                        "name": "Coronel Rosales",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    table = load_crosswalk(path)

    assert table.jurisdictions[0].pba_distrito_code == "027"
    assert table.resolve_pba("27") == table.resolve_pba("027")
    assert table.resolve_pba(" 27 ") == table.resolve_pba("027")


def test_crosswalk_loader_rejects_normalized_duplicate_pba_codes(tmp_path: Path) -> None:
    path = tmp_path / "crosswalk.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "jurisdictions": [
                    {
                        "pba_distrito": "27",
                        "national_distrito": "02",
                        "national_seccion": "027",
                        "name": "A",
                    },
                    {
                        "pba_distrito": "027",
                        "national_distrito": "03",
                        "national_seccion": "028",
                        "name": "B",
                    },
                ]
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(DuplicateCrosswalkKeyError, match="027"):
        load_crosswalk(path)


def test_crosswalk_loader_allows_different_secciones_in_one_national_distrito(
    tmp_path: Path,
) -> None:
    path = tmp_path / "crosswalk.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "jurisdictions": [
                    {
                        "pba_distrito": "027",
                        "national_distrito": "02",
                        "national_seccion": "027",
                        "name": "A",
                    },
                    {
                        "pba_distrito": "028",
                        "national_distrito": "02",
                        "national_seccion": "028",
                        "name": "B",
                    },
                ]
            }
        ),
        encoding="utf-8",
    )

    assert len(load_crosswalk(path).jurisdictions) == 2


def test_coronel_rosales_resolves_across_numbering_schemes() -> None:
    table = _load_crosswalk_table()

    # Through the resolvers PRODUCTION uses. `resolve_jurisdiction` was a
    # second PBA resolver with no production caller, deleted; every PBA row
    # goes through `resolve_pba_distrito_code`.
    via_pba = resolve_pba_distrito_code("027", table)
    via_national = table.resolve_national(distrito_code="02", seccion_code="027")

    assert not isinstance(via_pba, QuarantinedPbaDistrito)
    assert via_national is not None
    # Both numbering schemes MUST resolve to the same canonical jurisdiction.
    assert via_pba == (via_national.national_distrito_code, via_national.national_seccion_code)
    assert via_national.name == "Coronel de Marina Leonardo Rosales"


def test_unmapped_jurisdiction_code_is_quarantined() -> None:
    table = _load_crosswalk_table()

    result = resolve_pba_distrito_code("999", table)

    assert isinstance(result, QuarantinedPbaDistrito)
    assert result.pba_distrito_code == "999"
    # Never silently assigned to an unrelated jurisdiction.
    assert result.reason


def test_same_mesa_number_in_different_circuitos_is_two_discontinuities() -> None:
    stability = compute_mesa_stability({("A", 142)}, {("B", 142)})

    assert stability == [
        MesaStability(circuito="A", mesa=142, present_2023=True, present_2025=False),
        MesaStability(circuito="B", mesa=142, present_2023=False, present_2025=True),
    ]
    assert all(item.discontinuous and not item.stable for item in stability)


def test_mesa_code_stable_across_years() -> None:
    rows_2023 = ingest_national(
        _read("crosswalk_national_2023_sample.csv"),
        archive_entry_id="national/2023-generales",
        election_year=2023,
        election_round="paso",
    )
    rows_2025 = ingest_national(
        _read("crosswalk_national_2025_sample.csv"),
        archive_entry_id="national/2025-legislativas",
        election_year=2025,
        election_round="fixture-legacy",
    )
    assert all(r.mesa is not None and r.result.circuito is not None for r in rows_2023)
    assert all(r.mesa is not None and r.result.circuito is not None for r in rows_2025)
    mesas_2023: set[tuple[str, int]] = {
        (r.result.circuito, r.mesa)
        for r in rows_2023
        if r.mesa is not None and r.result.circuito is not None
    }
    mesas_2025: set[tuple[str, int]] = {
        (r.result.circuito, r.mesa)
        for r in rows_2025
        if r.mesa is not None and r.result.circuito is not None
    }

    stability = compute_mesa_stability(mesas_2023, mesas_2025)
    by_mesa = {s.mesa: s for s in stability}

    # Mesas 1 and 2 appear in both years -> stable.
    assert by_mesa[1].stable is True
    assert by_mesa[1].discontinuous is False
    assert by_mesa[2].stable is True


def test_mesa_code_absent_in_one_year_reported_as_discontinuity() -> None:
    rows_2023 = ingest_national(
        _read("crosswalk_national_2023_sample.csv"),
        archive_entry_id="national/2023-generales",
        election_year=2023,
        election_round="paso",
    )
    rows_2025 = ingest_national(
        _read("crosswalk_national_2025_sample.csv"),
        archive_entry_id="national/2025-legislativas",
        election_year=2025,
        election_round="fixture-legacy",
    )
    assert all(r.mesa is not None and r.result.circuito is not None for r in rows_2023)
    assert all(r.mesa is not None and r.result.circuito is not None for r in rows_2025)
    mesas_2023: set[tuple[str, int]] = {
        (r.result.circuito, r.mesa)
        for r in rows_2023
        if r.mesa is not None and r.result.circuito is not None
    }
    mesas_2025: set[tuple[str, int]] = {
        (r.result.circuito, r.mesa)
        for r in rows_2025
        if r.mesa is not None and r.result.circuito is not None
    }

    stability = compute_mesa_stability(mesas_2023, mesas_2025)
    by_mesa = {s.mesa: s for s in stability}

    # Mesa 3 is real 2023 data (see module docstring) with deliberately no
    # 2025 counterpart in this fixture set -> a reported discontinuity, not
    # a silently dropped mesa and NOT substituted by a different mesa.
    assert by_mesa[3].present_2023 is True
    assert by_mesa[3].present_2025 is False
    assert by_mesa[3].discontinuous is True
    assert by_mesa[3].stable is False


def test_a_national_code_absent_from_the_crosswalk_is_reported_not_passed() -> None:
    """The national crosswalk guard is `validate-crosswalk`, not a quarantine
    inside the loader.

    `resolve_jurisdictions` used to quarantine a national row whose
    (distrito, seccion) had no curated entry. It had no production caller,
    and wiring it in would have discarded the corpus: `crosswalk.yaml` holds
    ONE entry, the PBA-to-national translation for distrito 027, because PBA
    is the only source writing codes in a foreign scheme. National codes are
    already national, so every distrito except 02/027 resolves to nothing.
    What the codes are checked against instead is this command.
    """
    rows = ingest_national(
        _read("crosswalk_national_2025_sample.csv"),
        archive_entry_id="national/2025-legislativas",
        election_year=2025,
        election_round="fixture-legacy",
    )
    codes = sorted({(row.result.distrito, row.result.seccion) for row in rows})
    assert codes, "fixture must carry at least one jurisdiction code"

    unmapped = find_unmapped_jurisdictions(codes, CrosswalkTable(jurisdictions=()))

    assert len(unmapped) == len(codes)
    for entry in unmapped:
        assert entry.reason


def test_a_curated_national_code_resolves_through_the_crosswalk() -> None:
    rows = ingest_national(
        _read("crosswalk_national_2025_sample.csv"),
        archive_entry_id="national/2025-legislativas",
        election_year=2025,
        election_round="fixture-legacy",
    )
    codes = sorted({(row.result.distrito, row.result.seccion) for row in rows})
    crosswalk = CrosswalkTable(
        jurisdictions=(
            JurisdictionCrosswalkEntry(
                pba_distrito_code="027",
                national_distrito_code="02",
                national_seccion_code="027",
                name="Coronel de Marina Leonardo Rosales",
            ),
        )
    )

    assert find_unmapped_jurisdictions(codes, crosswalk) == []


def _fiscalizacion_rows_from_fixture() -> list[FiscalizacionMesaRow]:
    import csv

    from etl.crosswalk import FISCALIZACION_VOTE_COLUMNS

    rows = []
    fixture_path = FIXTURES / "fiscalizacion_2025_stripped_sample.csv"
    with fixture_path.open(newline="", encoding="utf-8") as f:
        for raw in csv.DictReader(f):
            mesa = int(raw["Mesa"].replace("Mesa", "").strip())
            votes = {col: int(raw[col]) for col in FISCALIZACION_VOTE_COLUMNS}
            rows.append(FiscalizacionMesaRow(mesa=mesa, votes=votes))
    return rows


def _official_by_mesa_from_fixture() -> dict[int, OfficialMesaVotes]:
    import csv
    from collections import defaultdict

    votes_by_mesa: dict[int, dict[str, int]] = defaultdict(dict)
    tipo_by_mesa: dict[int, dict[str, int]] = defaultdict(dict)
    fixture_path = FIXTURES / "national_2025_027_diputados_sample.csv"
    with fixture_path.open(newline="", encoding="utf-8") as f:
        for raw in csv.DictReader(f):
            mesa = int(raw["mesa_id"])
            if raw["votos_tipo"] == "POSITIVO":
                votes_by_mesa[mesa][raw["agrupacion_nombre"]] = int(raw["votos_cantidad"])
            elif raw["votos_tipo"] in ("EN BLANCO", "IMPUGNADO"):
                tipo_by_mesa[mesa][raw["votos_tipo"]] = int(raw["votos_cantidad"])

    return {
        mesa: OfficialMesaVotes(
            mesa=mesa,
            votes_by_agrupacion_name=votes_by_mesa[mesa],
            votos_tipo_totals=tipo_by_mesa[mesa],
        )
        for mesa in votes_by_mesa
    }


def test_official_vector_refuses_missing_party_and_vote_type_tallies() -> None:
    votes_by_name = {name: 1 for name in OFFICIAL_AGRUPACION_NAME_BY_COLUMN.values()}
    totals_by_type = {vote_type: 1 for vote_type in OFFICIAL_VOTOS_TIPO_BY_COLUMN.values()}
    missing_name = OFFICIAL_AGRUPACION_NAME_BY_COLUMN["Liber.AR"]
    missing_type = OFFICIAL_VOTOS_TIPO_BY_COLUMN["Impugnado"]
    votes_by_name.pop(missing_name)
    totals_by_type.pop(missing_type)

    with pytest.raises(ValueError) as excinfo:
        OfficialMesaVotes(
            mesa=147,
            votes_by_agrupacion_name=votes_by_name,
            votos_tipo_totals=totals_by_type,
        ).vector()

    assert type(excinfo.value).__name__ == "IncompleteOfficialMesaError"
    message = str(excinfo.value)
    assert "mesa 147" in message
    assert missing_name in message
    assert missing_type in message


def test_official_vector_contains_all_curated_parties_and_vote_types() -> None:
    votes_by_name = {
        name: index
        for index, name in enumerate(OFFICIAL_AGRUPACION_NAME_BY_COLUMN.values(), start=1)
    }
    totals_by_type = {
        vote_type: index
        for index, vote_type in enumerate(OFFICIAL_VOTOS_TIPO_BY_COLUMN.values(), start=101)
    }

    vector = OfficialMesaVotes(
        mesa=148,
        votes_by_agrupacion_name=votes_by_name,
        votos_tipo_totals=totals_by_type,
    ).vector()

    assert set(vector) == set(OFFICIAL_AGRUPACION_NAME_BY_COLUMN) | set(
        OFFICIAL_VOTOS_TIPO_BY_COLUMN
    )
    assert len(vector) == 17


def test_fiscalizacion_mesa_identity_is_accepted_and_injective() -> None:
    fiscalizacion_rows = _fiscalizacion_rows_from_fixture()
    official_by_mesa = _official_by_mesa_from_fixture()

    result = join_fiscalizacion_identity(fiscalizacion_rows, official_by_mesa)

    # Every fiscalización mesa number in this fixture has exactly one
    # official counterpart -- zero unmatched, zero collisions (Engram #1410:
    # 93/93 on the real full data set; this fixture reproduces the same
    # property at a minimal, testable scale).
    assert result.unmatched_mesas == ()
    assert result.collided_mesas == ()
    assert len(result.joined) == len(fiscalizacion_rows)


def test_tally_divergence_is_informational_not_a_join_failure() -> None:
    fiscalizacion_rows = _fiscalizacion_rows_from_fixture()
    official_by_mesa = _official_by_mesa_from_fixture()

    result = join_fiscalizacion_identity(fiscalizacion_rows, official_by_mesa)

    # Mesa 3 genuinely diverges from the official tally on a party column
    # (Union Liberal) -- real fiscalización-quality noise, not a numbering
    # mismatch. It MUST still be present in `joined`, and the divergence
    # MUST be recorded as an informational record, never as a join failure.
    mesa_3_joined = [pair for pair in result.joined if pair[0].mesa == 3]
    assert len(mesa_3_joined) == 1, "a diverging mesa must still join"
    assert 3 not in result.unmatched_mesas
    assert 3 not in result.collided_mesas

    party_divergences = [
        d for d in result.divergences if d.mesa == 3 and not d.is_expected_category_difference
    ]
    assert len(party_divergences) == 1
    assert party_divergences[0].column == "Union Liberal"


def test_impugnado_and_en_blanco_mismatch_is_expected_not_drift() -> None:
    fiscalizacion_rows = _fiscalizacion_rows_from_fixture()
    official_by_mesa = _official_by_mesa_from_fixture()

    result = join_fiscalizacion_identity(fiscalizacion_rows, official_by_mesa)

    # Mesa 1 diverges only on `Impugnado` (fiscal's provisional judgement vs
    # the definitive escrutinio) -- an EXPECTED, documented category
    # difference between source kinds, not drift.
    mesa_1_divergences = [d for d in result.divergences if d.mesa == 1]
    assert len(mesa_1_divergences) == 1
    assert mesa_1_divergences[0].column == "Impugnado"
    assert mesa_1_divergences[0].is_expected_category_difference is True

    # Mesa 149 diverges only on `En blanco` -- same expected category shape.
    mesa_149_divergences = [d for d in result.divergences if d.mesa == 149]
    assert len(mesa_149_divergences) == 1
    assert mesa_149_divergences[0].column == "En blanco"
    assert mesa_149_divergences[0].is_expected_category_difference is True

    # Mesa 45 is an exact 17-column match -- no divergence recorded at all.
    mesa_45_divergences = [d for d in result.divergences if d.mesa == 45]
    assert mesa_45_divergences == []

    # None of the expected-category divergences are ever misclassified as
    # generic (non-expected) drift.
    for divergence in result.divergences:
        if divergence.column in ("En blanco", "Impugnado"):
            assert divergence.is_expected_category_difference is True


def test_an_absent_distrito_is_reported_as_absent_not_as_the_string_none() -> None:
    """A row with NO distrito -- `csv.DictReader` fills a truncated line's
    missing fields with `None` -- was interpolated into the report as the
    literal string `"None"`, naming a jurisdiction no source ever wrote, and
    its dedup key collapsed it in with genuinely-coded jurisdictions.

    A non-numeric code is a different case and NOT this one:
    `normalize_distrito_code` falls back to the raw value unchanged, so
    `"no es un codigo"` canonicalizes to itself and is reported the ordinary
    way, under its own spelling.
    """
    unmapped = find_unmapped_jurisdictions(
        [(None, None), ("no es un codigo", None), (None, None)],
        CrosswalkTable(jurisdictions=()),
    )

    codes = [entry.code for entry in unmapped]
    assert len(codes) == 2, "the repeated absent distrito is one problem, not two"
    assert not any(code.startswith("None/") for code in codes), (
        "the report must never name a jurisdiction nobody wrote"
    )
    absent = [e for e in unmapped if "(sin distrito)" in e.code]
    assert len(absent) == 1
    assert "cannot be canonicalized" in absent[0].reason
    coded = [e for e in unmapped if "no es un codigo" in e.code]
    assert len(coded) == 1 and "no curated crosswalk entry" in coded[0].reason


def test_a_row_with_no_distrito_does_not_kill_the_sort_before_its_handler_runs() -> None:
    """`collect_national_jurisdiction_codes` sorts its pairs with `or ""` on
    the seccion half and nothing on the distrito half, so a truncated row --
    `csv.DictReader` fills missing trailing fields with `None` -- raised
    `TypeError: '<' not supported between 'NoneType' and 'str'` inside the
    sort. `validate-crosswalk` died with a traceback and the `None`-distrito
    handler downstream never ran, while the module contract promises a
    non-zero exit on a validation failure, not a stack trace.
    """
    codes = sorted(
        {(None, None), ("02", "027"), ("02", None)}, key=lambda pair: (pair[0] or "", pair[1] or "")
    )

    unmapped = find_unmapped_jurisdictions(codes, CrosswalkTable(jurisdictions=()))

    assert len(unmapped) == 3
    # And no report line names a jurisdiction nobody wrote.
    for entry in unmapped:
        assert "None" not in entry.code
        assert "None" not in entry.reason


def test_distrito_lookup_normalizes_without_mapping_an_incomplete_row() -> None:
    """Distrito lookup normalizes codes but cannot supply a missing seccion."""
    table = _load_crosswalk_table()

    assert len(table.entries_in_distrito("2")) == 1
    assert len(table.entries_in_distrito("02")) == 1
    assert table.entries_in_distrito("99") == []
    unmapped = find_unmapped_jurisdictions([("2", None)], table)
    assert [entry.code for entry in unmapped] == ["02/(sin seccion)"]


def test_a_seccion_less_row_refuses_when_two_entries_share_its_distrito() -> None:
    """National distrito `02` is the whole province of Buenos Aires, and
    `crosswalk.yaml` is curated and will grow. Returning the first match meant
    the day a second partido is added, a row carrying no seccion resolves to
    whichever line the YAML happens to list first -- and the entry returned
    carries a `national_seccion_code` and a `name` that would then be read as
    that row's.
    """
    table = CrosswalkTable(
        jurisdictions=(
            JurisdictionCrosswalkEntry(
                pba_distrito_code="027",
                national_distrito_code="02",
                national_seccion_code="027",
                name="Coronel de Marina Leonardo Rosales",
            ),
            JurisdictionCrosswalkEntry(
                pba_distrito_code="007",
                national_distrito_code="02",
                national_seccion_code="007",
                name="Bahia Blanca",
            ),
        )
    )

    # The PAIRED lookup still resolves: the seccion tells them apart.
    assert table.resolve_national(distrito_code="02", seccion_code="027") is not None

    # The coarse one hands back BOTH, so the caller reports rather than picks.
    assert len(table.entries_in_distrito("02")) == 2

    reported = find_unmapped_jurisdictions([("02", None)], table)
    assert len(reported) == 1
    assert "cannot be attributed" in reported[0].reason
    assert "Coronel de Marina Leonardo Rosales" in reported[0].reason
    assert "Bahia Blanca" in reported[0].reason
