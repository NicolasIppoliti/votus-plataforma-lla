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

from pathlib import Path

from etl.crosswalk import (
    CrosswalkTable,
    FiscalizacionMesaRow,
    JurisdictionCrosswalkEntry,
    OfficialMesaVotes,
    QuarantinedJurisdiction,
    compute_mesa_stability,
    join_fiscalizacion_identity,
    load_crosswalk,
    resolve_jurisdiction,
)
from etl.ingest.national import ingest_national, resolve_jurisdictions

FIXTURES = Path(__file__).parent / "fixtures"
CURATED = Path(__file__).parent.parent.parent / "curated"


def _read(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def _load_crosswalk_table() -> CrosswalkTable:
    return load_crosswalk(CURATED / "crosswalk.yaml")


def test_coronel_rosales_resolves_across_numbering_schemes() -> None:
    table = _load_crosswalk_table()

    via_pba = resolve_jurisdiction(table, pba_distrito_code="027")
    via_national = table.resolve_national(distrito_code="02", seccion_code="027")

    assert not isinstance(via_pba, QuarantinedJurisdiction)
    assert via_national is not None
    # Both numbering schemes MUST resolve to the same canonical entry.
    assert via_pba is via_national
    assert via_pba.name == "Coronel de Marina Leonardo Rosales"


def test_unmapped_jurisdiction_code_is_quarantined() -> None:
    table = _load_crosswalk_table()

    result = resolve_jurisdiction(table, pba_distrito_code="999")

    assert isinstance(result, QuarantinedJurisdiction)
    assert result.code == "999"
    # Never silently assigned to an unrelated jurisdiction.
    assert result.reason


def test_mesa_code_stable_across_years() -> None:
    rows_2023 = ingest_national(
        _read("crosswalk_national_2023_sample.csv"), archive_entry_id="national/2023-generales"
    )
    rows_2025 = ingest_national(
        _read("crosswalk_national_2025_sample.csv"), archive_entry_id="national/2025-legislativas"
    )
    mesas_2023 = {r.mesa for r in rows_2023}
    mesas_2025 = {r.mesa for r in rows_2025}

    stability = compute_mesa_stability(mesas_2023, mesas_2025)
    by_mesa = {s.mesa: s for s in stability}

    # Mesas 1 and 2 appear in both years -> stable.
    assert by_mesa[1].stable is True
    assert by_mesa[1].discontinuous is False
    assert by_mesa[2].stable is True


def test_mesa_code_absent_in_one_year_reported_as_discontinuity() -> None:
    rows_2023 = ingest_national(
        _read("crosswalk_national_2023_sample.csv"), archive_entry_id="national/2023-generales"
    )
    rows_2025 = ingest_national(
        _read("crosswalk_national_2025_sample.csv"), archive_entry_id="national/2025-legislativas"
    )
    mesas_2023 = {r.mesa for r in rows_2023}
    mesas_2025 = {r.mesa for r in rows_2025}

    stability = compute_mesa_stability(mesas_2023, mesas_2025)
    by_mesa = {s.mesa: s for s in stability}

    # Mesa 3 is real 2023 data (see module docstring) with deliberately no
    # 2025 counterpart in this fixture set -> a reported discontinuity, not
    # a silently dropped mesa and NOT substituted by a different mesa.
    assert by_mesa[3].present_2023 is True
    assert by_mesa[3].present_2025 is False
    assert by_mesa[3].discontinuous is True
    assert by_mesa[3].stable is False


def test_national_row_with_unmapped_jurisdiction_is_quarantined_not_dropped() -> None:
    rows = ingest_national(
        _read("crosswalk_national_2025_sample.csv"), archive_entry_id="national/2025-legislativas"
    )
    # A crosswalk containing NO entry for distrito 02 / seccion 027 at all --
    # every row must be quarantined, never dropped and never mapped anyway.
    empty_crosswalk = CrosswalkTable(jurisdictions=())

    result = resolve_jurisdictions(rows, empty_crosswalk)

    assert result.mapped == ()
    assert len(result.quarantined) == len(rows)
    for quarantined_row in result.quarantined:
        assert quarantined_row.reason


def test_national_row_with_mapped_jurisdiction_resolves() -> None:
    rows = ingest_national(
        _read("crosswalk_national_2025_sample.csv"), archive_entry_id="national/2025-legislativas"
    )
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

    result = resolve_jurisdictions(rows, crosswalk)

    assert result.quarantined == ()
    assert len(result.mapped) == len(rows)


def _fiscalizacion_rows_from_fixture() -> list[FiscalizacionMesaRow]:
    import csv

    from etl.crosswalk import FISCALIZACION_VOTE_COLUMNS

    rows = []
    fixture_path = FIXTURES / "fiscalizacion_2025_stripped_sample.csv"
    with fixture_path.open(newline="", encoding="utf-8") as f:
        for raw in csv.DictReader(f):
            mesa = int(raw["Mesa"].replace("Mesa", "").strip())
            votes = {col: int(raw[col]) for col in FISCALIZACION_VOTE_COLUMNS}
            rows.append(FiscalizacionMesaRow(mesa=mesa, escuela=raw["Escuela"], votes=votes))
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
