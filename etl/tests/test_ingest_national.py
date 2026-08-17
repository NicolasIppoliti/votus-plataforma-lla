"""RED tests for national 2023/2025 ZIP ingestion (`electoral-ingestion` spec,
national subset). Fixtures are derived from real data, never from a live
network fetch or the gitignored 88 MB archived ZIP:

- `fixtures/national_2023_sample.csv`: 4 rows sliced directly from the real,
  already-archived `archive/national_2023_paso/2023-PROVISORIOS_PASO.zip`
  (`2023_PASO/ResultadosElectorales.csv`), filtered to distrito 02 / seccion
  027 (Coronel Rosales), mesas 1-2, cargo PRESIDENTE/A, agrupaciones 134/135 —
  real bytes, real vote counts, extracted by a one-off `python3 -c` streaming
  filter (never fully materializing the 3.7 GB uncompressed CSV).
- `fixtures/national_2025_sample.csv`: this legacy fixture was RECONSTRUCTED
  before the hash-matching 2025 ZIP was independently downloaded, using the
  exact real 2025 header and the exact
  real distrito/seccion/agrupación values recorded in
  `spikes/001-granularity-and-join-keys.md` (a)/(c)/(h) — not invented, but
  reassembled rather than sliced from a live download. Documented here per
  the apply instructions' "derive a MINIMAL one and say exactly how".
- `fixtures/national_2025_establecimientos_sample.csv`: exact header and two
  complete rows sliced from `localesDeVotacionyMesas.csv` in the independently
  downloaded 2025 ZIP whose SHA-256 is
  `5fb19bb280af8895dc0bc2ac19d79e836fb4053b713a135357743bf35371ee4b`,
  matching `archive-manifest.json`. The rows are distrito 02 / seccion 027 /
  mesas 00001-00002 and retain the source's zero padding and metadata.
"""

from __future__ import annotations

import io
from pathlib import Path

import pytest

from etl.ingest.national import (
    NationalSchemaError,
    extract_raw_mesa_identities_from_text,
    ingest_national,
    load_national_rows,
)
from etl.storage import extract_zip_safely

FIXTURES = Path(__file__).parent / "fixtures"


def _read(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def _text_of(csv_bytes: bytes) -> io.TextIOWrapper:
    """A fixture's bytes as the text stream the identity projection reads.

    Production hands it a file handle over an extracted ZIP member; these
    fixtures are small literals, so wrapping them keeps the tests reading the
    same entry point without inventing a second one for their convenience.
    """
    return io.TextIOWrapper(io.BytesIO(csv_bytes), encoding="utf-8-sig", newline="")


def test_2023_paso_fixture_keeps_internal_lists_one_row_per_mesa_list_combination() -> None:
    rows = ingest_national(
        _read("national_2023_sample.csv"),
        archive_entry_id="national/2023-generales",
        election_year=2023,
        election_round="paso",
    )

    # 2 mesas x 2 lists = 4 combinations, no more, no fewer — one normalized
    # row per (mesa, list, category). `list_id` is the (agrupación, lista)
    # pair, because in a PASO one agrupación fields several competing internal
    # lists; it degrades to the bare agrupación id where the source carries no
    # `lista_numero`.
    assert len(rows) == 4
    assert {(r.mesa, r.list_id) for r in rows} == {
        (1, "134-3005"),
        (1, "135-3016"),
        (2, "134-3005"),
        (2, "135-3016"),
    }
    for row in rows:
        assert row.granularity == "mesa"
        assert row.category == "PRESIDENTE/A"
        # `estado_final` is absent from the 2023 schema entirely (SPIKE b) —
        # MUST be treated as absent, never defaulted to a guessed status.
        assert row.estado_final is None
        # Every registered 2023 national round omits polling-place metadata.
        # Unknown is the truthful value; neither circuito nor mesa may be
        # copied into the establecimiento fields as a surrogate.
        assert row.establecimiento is None
        assert row.establecimiento_name is None


def test_real_national_fixture_preserves_authoritative_jurisdiction_names() -> None:
    rows = ingest_national(
        _read("national_2023_sample.csv"),
        archive_entry_id="national/2023-paso",
        election_year=2023,
        election_round="paso",
    )

    assert rows
    assert {
        (
            row.jurisdiction_names.distrito,
            row.jurisdiction_names.seccion,
            row.jurisdiction_names.circuito,
            row.jurisdiction_names.establecimiento,
        )
        for row in rows
    } == {
        (
            "Buenos Aires",
            "Coronel de Marina L. Rosales",
            "00248",
            None,
        )
    }


def test_code_equivalent_circuito_names_collapse_across_categories_without_quarantine(
    capsys: pytest.CaptureFixture[str],
) -> None:
    csv_bytes = (
        b"distrito_id,distrito_nombre,seccion_id,seccion_nombre,circuito_id,"
        b"circuito_nombre,mesa_id,cargo_nombre,agrupacion_id,lista_numero,votos_tipo,"
        b"votos_cantidad\n"
        b"02,Buenos Aires,027,Coronel Rosales,00001,1,9001,PRESIDENTE Y VICE,"
        b"110,,POSITIVO,7\n"
        b"02,Buenos Aires,027,Coronel Rosales,00001,00001,9001,DIPUTADO NACIONAL,"
        b"110,,POSITIVO,5\n"
    )

    rows = ingest_national(
        csv_bytes,
        archive_entry_id="national/2023-generales",
        election_year=2023,
        election_round="generales",
    )

    assert len(rows) == 2
    assert {row.category for row in rows} == {"PRESIDENTE Y VICE", "DIPUTADO NACIONAL"}
    assert {
        (
            row.result.distrito,
            row.result.seccion,
            row.result.circuito,
            row.result.mesa,
        )
        for row in rows
    } == {("02", "027", "00001", 9001)}
    assert {row.jurisdiction_names.circuito for row in rows} == {"00001"}
    assert capsys.readouterr().err == ""


def test_load_national_rows_passes_all_names_to_the_batch_db_boundary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rows = ingest_national(
        _read("national_2023_sample.csv"),
        archive_entry_id="national/name-boundary",
        election_year=2023,
        election_round="paso",
    )
    captured_names = []

    monkeypatch.setattr(
        "etl.ingest.national.db.upsert_election", lambda *_args, **_kwargs: "election"
    )
    monkeypatch.setattr(
        "etl.ingest.national.db.upsert_category", lambda _conn, *, name: f"category:{name}"
    )

    def capture_batch(_conn, keys, *, names=None):
        captured_names.extend(names or ())
        return {key: f"jurisdiction:{index}" for index, key in enumerate(dict.fromkeys(keys))}

    monkeypatch.setattr("etl.ingest.national.db.batch_upsert_jurisdictions", capture_batch)
    monkeypatch.setattr(
        "etl.ingest.national.db.load_result_rows",
        lambda _conn, **kwargs: len(kwargs["records"]),
    )

    inserted = load_national_rows(
        object(),
        rows,
        year=2023,
        round_="paso",
        archive_entry_id="national/name-boundary",
    )

    assert inserted == len(rows)
    assert len(captured_names) == len(rows)
    assert {
        (names.distrito, names.seccion, names.circuito, names.establecimiento)
        for names in captured_names
    } == {("Buenos Aires", "Coronel de Marina L. Rosales", "00248", None)}


def test_blank_outer_whitespace_jurisdiction_name_normalizes_to_none() -> None:
    source = _read("national_2023_sample.csv").decode("utf-8")
    source = source.replace(",Buenos Aires,6,", ",   ,6,", 1)

    rows = ingest_national(
        source.encode(),
        archive_entry_id="national/2023-paso",
        election_year=2023,
        election_round="paso",
    )

    assert rows[0].jurisdiction_names.distrito is None
    assert rows[1].jurisdiction_names.distrito == "Buenos Aires"


def test_national_parser_requires_authoritative_jurisdiction_name_columns() -> None:
    missing_names = (
        b"distrito_id,seccion_id,circuito_id,mesa_id,cargo_nombre,agrupacion_id,"
        b"votos_tipo,votos_cantidad\n"
        b"02,027,00248,1,DIPUTADO NACIONAL,135,POSITIVO,90\n"
    )

    with pytest.raises(NationalSchemaError) as excinfo:
        ingest_national(
            missing_names,
            archive_entry_id="national/missing-names",
            election_year=2025,
            election_round="legislativas",
        )

    message = str(excinfo.value)
    assert "distrito_nombre" in message
    assert "seccion_nombre" in message
    assert "circuito_nombre" in message


def test_2025_companion_enriches_mesas_across_source_zero_padding() -> None:
    rows = ingest_national(
        _read("national_2025_sample.csv"),
        archive_entry_id="national/2025-legislativas",
        election_year=2025,
        election_round="fixture-legacy",
        establecimientos_csv_bytes=_read("national_2025_establecimientos_sample.csv"),
    )

    assert len(rows) == 2
    assert {(row.mesa, row.establecimiento, row.establecimiento_name) for row in rows} == {
        (1, "37974", "INSTITUTO SUPERIOR DE FORM.DOCENTE N°79"),
        (2, "37974", "INSTITUTO SUPERIOR DE FORM.DOCENTE N°79"),
    }


def test_companion_quarantines_a_mesa_present_under_multiple_result_circuits(
    capsys: pytest.CaptureFixture[str],
) -> None:
    results = _read("national_2025_sample.csv").decode("utf-8")
    header, mesa_1, mesa_2 = results.splitlines()
    same_mesa_different_circuit = mesa_2.replace("00248,00248,2", "00999,00999,1")

    rows = ingest_national(
        f"{header}\n{mesa_1}\n{same_mesa_different_circuit}\n".encode(),
        archive_entry_id="national/2025-legislativas",
        election_year=2025,
        election_round="fixture-legacy",
        establecimientos_csv_bytes=_read("national_2025_establecimientos_sample.csv"),
    )

    assert rows == [], "a companion with no circuito_id cannot choose between result circuits"
    assert "ambiguous result circuits for establecimiento companion: 2 rows / 175 votes" in (
        capsys.readouterr().err
    )


def test_present_companion_quarantines_unmatched_mesas_with_vote_breakdown(
    capsys: pytest.CaptureFixture[str],
) -> None:
    companion = _read("national_2025_establecimientos_sample.csv").decode("utf-8")
    header, mesa_1, _mesa_2 = companion.splitlines()

    rows = ingest_national(
        _read("national_2025_sample.csv"),
        archive_entry_id="national/2025-legislativas",
        election_year=2025,
        election_round="fixture-legacy",
        establecimientos_csv_bytes=f"{header}\n{mesa_1}\n".encode(),
    )

    assert [row.mesa for row in rows] == [1]
    assert "missing establecimiento companion match: 1 rows / 85 votes" in capsys.readouterr().err


def test_present_companion_quarantines_conflicting_mesa_metadata_without_picking(
    capsys: pytest.CaptureFixture[str],
) -> None:
    companion = _read("national_2025_establecimientos_sample.csv").decode("utf-8")
    header, mesa_1, mesa_2 = companion.splitlines()
    conflicting_mesa_1 = mesa_1.replace(
        "37974,INSTITUTO SUPERIOR DE FORM.DOCENTE N°79",
        "99999,OTRO ESTABLECIMIENTO",
    )

    rows = ingest_national(
        _read("national_2025_sample.csv"),
        archive_entry_id="national/2025-legislativas",
        election_year=2025,
        election_round="fixture-legacy",
        establecimientos_csv_bytes=(
            f"{header}\n{mesa_1}\n{conflicting_mesa_1}\n{mesa_2}\n"
        ).encode(),
    )

    assert [row.mesa for row in rows] == [2]
    assert "conflicting establecimiento companion metadata: 1 rows / 90 votes" in (
        capsys.readouterr().err
    )


def test_present_companion_quarantines_one_code_with_conflicting_names(
    capsys: pytest.CaptureFixture[str],
) -> None:
    companion = _read("national_2025_establecimientos_sample.csv").decode("utf-8")
    header, mesa_1, mesa_2 = companion.splitlines()
    conflicting_mesa_2 = mesa_2.replace(
        "INSTITUTO SUPERIOR DE FORM.DOCENTE N°79",
        "OTRO ESTABLECIMIENTO",
    )

    rows = ingest_national(
        _read("national_2025_sample.csv"),
        archive_entry_id="national/2025-legislativas",
        election_year=2025,
        election_round="fixture-legacy",
        establecimientos_csv_bytes=(f"{header}\n{mesa_1}\n{conflicting_mesa_2}\n").encode(),
    )

    assert rows == []
    assert "conflicting establecimiento companion metadata: 2 rows / 175 votes" in (
        capsys.readouterr().err
    )


def test_2025_bup_format_parsed_or_fails_loudly() -> None:
    rows = ingest_national(
        _read("national_2025_sample.csv"),
        archive_entry_id="national/2025-legislativas",
        election_year=2025,
        # This reconstructed legacy fixture carries populated lista_numero values;
        # it is not evidence for the measured legislativas export invariant.
        election_round="fixture-legacy",
    )

    assert len(rows) == 2
    for row in rows:
        assert row.granularity == "mesa"
        assert row.category == "DIPUTADO NACIONAL"
        # 2025's BUP format adds `estado_final` — MUST be captured, not
        # silently dropped by a parser written only against the 2023 shape.
        assert row.estado_final == "DEFINITIVO"


def test_2025_bup_format_fails_loudly_on_missing_required_column() -> None:
    malformed = (
        b"distrito_id,distrito_nombre,seccion_id,seccion_nombre,circuito_id,"
        b"circuito_nombre,cargo_nombre,agrupacion_id,votos_tipo,votos_cantidad\n"
        b"02,Buenos Aires,027,Coronel Rosales,00248,Circuito 248,DIPUTADO NACIONAL,"
        b"135,POSITIVO,90\n"
    )  # missing `mesa_id` entirely — an unrecognized structure, not partial data.

    with pytest.raises(NationalSchemaError, match="mesa_id"):
        ingest_national(
            malformed,
            archive_entry_id="national/2025-legislativas",
            election_year=2025,
            election_round="legislativas",
        )


def test_idempotent_reingest_same_archive_entry() -> None:
    data = _read("national_2023_sample.csv")

    first = ingest_national(
        data,
        archive_entry_id="national/2023-generales",
        election_year=2023,
        election_round="paso",
    )
    second = ingest_national(
        data,
        archive_entry_id="national/2023-generales",
        election_year=2023,
        election_round="paso",
    )

    assert first == second
    # The FULL lineage, which is what `_quarantine_ambiguous_rows` and the
    # database constraint both key on. The `natural_key` field was a weaker
    # third idea — `mesa_id` alone is not unique in the 2023 file.
    lineage = [
        (
            r.result.distrito,
            r.result.seccion,
            r.result.circuito,
            r.result.mesa,
            r.category,
            r.list_id,
        )
        for r in first
    ]
    assert len(lineage) == len(set(lineage)), "no duplicate rows on re-ingest"


def test_full_rebuild_from_archive_is_identical() -> None:
    data = _read("national_2023_sample.csv")

    built = ingest_national(
        data,
        archive_entry_id="national/2023-generales",
        election_year=2023,
        election_round="paso",
    )
    # "Drop and rebuild": discard the in-memory projection entirely and
    # re-derive it from the same archived bytes, exactly as a real rebuild
    # would re-run ingestion against the immutable archive (D8) with no
    # normalized-layer state carried across the drop.
    del built
    rebuilt = ingest_national(
        data,
        archive_entry_id="national/2023-generales",
        election_year=2023,
        election_round="paso",
    )

    assert rebuilt == ingest_national(
        data,
        archive_entry_id="national/2023-generales",
        election_year=2023,
        election_round="paso",
    )


def test_idempotent_reingest_via_real_fixture_zip(tmp_path: Path) -> None:
    # Task 3.8 REFACTOR: confirm idempotency through the same
    # extract-then-parse path a real archive entry would take, using
    # `national_2023_sample.zip` — a ZIP built directly from the real bytes
    # sliced out of the archived 2023 PASO source (see module docstring),
    # not a bare CSV.
    zip_bytes = (FIXTURES / "national_2023_sample.zip").read_bytes()
    extracted = extract_zip_safely(zip_bytes, tmp_path)
    (csv_path,) = [p for p in extracted if p.name == "ResultadosElectorales.csv"]
    data = csv_path.read_bytes()

    first = ingest_national(
        data,
        archive_entry_id="national/2023-generales",
        election_year=2023,
        election_round="paso",
    )
    second = ingest_national(
        data,
        archive_entry_id="national/2023-generales",
        election_year=2023,
        election_round="paso",
    )

    assert first == second
    assert len(first) == 4


def test_ambiguous_duplicate_natural_keys_are_quarantined_not_crashed() -> None:
    """The 2023 national file contains rows that are byte-identical across
    every column except `votos_cantidad`.

    Measured in the real archived `2023-generales.zip`: 5.051 natural keys
    repeat, confined entirely to the two most local categories the national
    file bundles -- INTENDENTE (2.379) and MIEMBROS DE JUNTA COMUNAL
    (2.672). For a municipal race the file's distrito/seccion/circuito/mesa
    lineage does not identify the municipio, so those rows are genuinely
    indistinguishable from one another in the source itself.

    Before this, the whole ingest aborted on a raw psycopg
    `UniqueViolation` against `result_row_natural_key` -- one ambiguous
    municipal row killed 2,7 million good national rows. The specs require
    degradation to be surfaced and conflicting rows quarantined, never
    dropped and never silently resolved by picking one arbitrarily.
    """
    csv_text = (
        "año,eleccion_tipo,recuento_tipo,padron_tipo,distrito_id,distrito_nombre,"
        "seccionprovincial_id,seccionprovincial_nombre,seccion_id,seccion_nombre,"
        "circuito_id,circuito_nombre,mesa_id,mesa_tipo,mesa_electores,cargo_id,"
        "cargo_nombre,agrupacion_id,agrupacion_nombre,lista_numero,lista_nombre,"
        "votos_tipo,votos_cantidad\n"
        # Two rows identical in every dimension except the vote count.
        "2023,GENERAL,DEFINITIVO,NAC,20,X,,,1,S,00001,C,1,NATIVOS,300,7,INTENDENTE,"
        "200704,AGRUP,,,POSITIVO,79\n"
        "2023,GENERAL,DEFINITIVO,NAC,20,X,,,1,S,00001,C,1,NATIVOS,300,7,INTENDENTE,"
        "200704,AGRUP,,,POSITIVO,63\n"
        # An unambiguous row in the same file must survive untouched.
        "2023,GENERAL,DEFINITIVO,NAC,02,Y,,,27,S,00099,C,5,NATIVOS,300,3,DIPUTADO NACIONAL,"
        "135,LLA,3016,L,POSITIVO,42\n"
    )

    rows = ingest_national(
        csv_text.encode("utf-8"),
        archive_entry_id="test/ambiguous",
        election_year=2024,
        election_round="other",
    )

    keys = [(r.result.distrito, r.result.mesa, r.category, r.list_id) for r in rows]
    assert len(keys) == len(set(keys)), (
        "ingest must not emit two rows sharing one natural key; the ambiguous "
        f"pair was not quarantined: {keys}"
    )
    assert any(r.list_id == "135-3016" for r in rows), (
        "the unambiguous row must still be ingested -- one ambiguous municipal "
        "row must not discard the rest of the file"
    )


def test_mesa_tipo_is_captured_from_the_source() -> None:
    """Phase 16a: `mesa_tipo` MUST be carried through, not dropped.

    Every row in the real 2023/2025 fixtures is a regular (`NATIVOS`) mesa —
    this only proves the column reaches `NationalRow`, not that a foreign
    mesa is handled (that is `test_extranjeros_mesa_is_distinguishable_from_a_regular_mesa`
    below).
    """
    rows = ingest_national(
        _read("national_2023_sample.csv"),
        archive_entry_id="national/2023-generales",
        election_year=2023,
        election_round="paso",
    )

    assert len(rows) == 4
    for row in rows:
        assert row.mesa_tipo == "NATIVOS"


@pytest.mark.parametrize("mesa_tipo", ["DESCONOCIDO", "nativos", " NATIVOS ", "\tEXTRANJEROS", " "])
def test_unsupported_mesa_tipo_fails_before_any_rows_are_returned(mesa_tipo: str) -> None:
    csv_text = (
        "distrito_id,distrito_nombre,seccion_id,seccion_nombre,circuito_id,circuito_nombre,"
        "mesa_id,mesa_tipo,cargo_nombre,agrupacion_id,votos_tipo,votos_cantidad\n"
        "02,Buenos Aires,027,Coronel Rosales,00248,Circuito 248,1,NATIVOS,"
        "DIPUTADO NACIONAL,135,POSITIVO,90\n"
        f"02,Buenos Aires,027,Coronel Rosales,00248,Circuito 248,2,{mesa_tipo},"
        "DIPUTADO NACIONAL,135,POSITIVO,12\n"
    )

    with pytest.raises(NationalSchemaError) as excinfo:
        ingest_national(
            csv_text.encode(),
            archive_entry_id="national/mesa-tipo-contract",
            election_year=2025,
            election_round="legislativas",
        )

    message = str(excinfo.value)
    assert repr(mesa_tipo) in message
    assert "source row 1" in message


@pytest.mark.parametrize("mesa_tipo", ["NATIVOS", "EXTRANJEROS"])
def test_supported_mesa_tipo_values_pass_exactly(mesa_tipo: str) -> None:
    csv_text = (
        "distrito_id,distrito_nombre,seccion_id,seccion_nombre,circuito_id,circuito_nombre,"
        "mesa_id,mesa_tipo,cargo_nombre,agrupacion_id,votos_tipo,votos_cantidad\n"
        f"02,Buenos Aires,027,Coronel Rosales,00248,Circuito 248,1,{mesa_tipo},"
        "DIPUTADO NACIONAL,135,POSITIVO,90\n"
    )

    rows = ingest_national(
        csv_text.encode(),
        archive_entry_id="national/mesa-tipo-contract",
        election_year=2025,
        election_round="legislativas",
    )

    assert [row.mesa_tipo for row in rows] == [mesa_tipo]


def test_empty_or_missing_mesa_tipo_remains_absent() -> None:
    with_column = (
        b"distrito_id,distrito_nombre,seccion_id,seccion_nombre,circuito_id,circuito_nombre,"
        b"mesa_id,mesa_tipo,cargo_nombre,agrupacion_id,votos_tipo,votos_cantidad\n"
        b"02,Buenos Aires,027,Coronel Rosales,00248,Circuito 248,1,,DIPUTADO NACIONAL,"
        b"135,POSITIVO,90\n"
    )
    without_column = (
        b"distrito_id,distrito_nombre,seccion_id,seccion_nombre,circuito_id,circuito_nombre,"
        b"mesa_id,cargo_nombre,agrupacion_id,votos_tipo,votos_cantidad\n"
        b"02,Buenos Aires,027,Coronel Rosales,00248,Circuito 248,2,DIPUTADO NACIONAL,"
        b"135,POSITIVO,12\n"
    )

    rows = [
        *ingest_national(
            with_column,
            archive_entry_id="national/mesa-tipo-empty",
            election_year=2025,
            election_round="legislativas",
        ),
        *ingest_national(
            without_column,
            archive_entry_id="national/mesa-tipo-missing",
            election_year=2025,
            election_round="legislativas",
        ),
    ]

    assert [row.mesa_tipo for row in rows] == [None, None]


def test_extranjeros_mesa_is_distinguishable_from_a_regular_mesa() -> None:
    """The two extra mesas measured live in Coronel Rosales (9001/9002) carry
    `mesa_tipo = EXTRANJEROS` — foreign residents vote in PBA
    provincial/municipal races but not national ones. That is a real
    electoral fact, not a defect, but the database can only preserve the
    distinction if `mesa_tipo` survives ingestion per-mesa, not just as a
    fixed constant.
    """
    csv_text = (
        "año,eleccion_tipo,recuento_tipo,padron_tipo,distrito_id,distrito_nombre,"
        "seccionprovincial_id,seccionprovincial_nombre,seccion_id,seccion_nombre,"
        "circuito_id,circuito_nombre,mesa_id,mesa_tipo,mesa_electores,cargo_id,"
        "cargo_nombre,agrupacion_id,agrupacion_nombre,lista_numero,lista_nombre,"
        "votos_tipo,votos_cantidad\n"
        "2023,GENERAL,DEFINITIVO,NAC,02,X,,,27,S,00248,C,1,NATIVOS,300,3,"
        "DIPUTADO NACIONAL,135,LLA,3016,L,POSITIVO,90\n"
        "2023,GENERAL,DEFINITIVO,NAC,02,X,,,27,S,00248,C,9001,EXTRANJEROS,300,3,"
        "DIPUTADO NACIONAL,135,LLA,3016,L,POSITIVO,12\n"
    )

    rows = ingest_national(
        csv_text.encode("utf-8"),
        archive_entry_id="test/extranjeros",
        election_year=2024,
        election_round="other",
    )

    assert len(rows) == 2
    by_mesa = {row.mesa: row.mesa_tipo for row in rows}
    assert by_mesa == {1: "NATIVOS", 9001: "EXTRANJEROS"}, (
        "mesa_tipo must be captured per-mesa, distinguishing a foreign-resident "
        f"mesa from a regular one; got {by_mesa}"
    )


@pytest.mark.parametrize(
    ("election_year", "election_round", "lista_numero", "expected_list_id"),
    [
        (2023, "generales", "", "110"),
        (2023, "paso", "3005", "110-3005"),
        (2025, "legislativas", "", "110"),
    ],
)
def test_measured_elections_accept_their_observed_lista_numero_shape(
    election_year: int,
    election_round: str,
    lista_numero: str,
    expected_list_id: str,
) -> None:
    csv_bytes = (
        "distrito_id,distrito_nombre,seccion_id,seccion_nombre,circuito_id,circuito_nombre,"
        "mesa_id,cargo_nombre,agrupacion_id,lista_numero,votos_tipo,votos_cantidad\n"
        f"02,Buenos Aires,027,Coronel Rosales,1,Circuito 1,9001,DIPUTADO NACIONAL,"
        f"110,{lista_numero},POSITIVO,7\n"
    ).encode()

    rows = ingest_national(
        csv_bytes,
        archive_entry_id="national/measured-shape",
        election_year=election_year,
        election_round=election_round,
    )

    assert [row.list_id for row in rows] == [expected_list_id]


@pytest.mark.parametrize(
    ("election_year", "election_round", "lista_numero"),
    [
        (2023, "generales", "3005"),
        (2023, "paso", ""),
        (2025, "legislativas", "2206"),
    ],
)
def test_measured_elections_reject_unobserved_lista_numero_shape(
    election_year: int, election_round: str, lista_numero: str
) -> None:
    csv_bytes = (
        "distrito_id,distrito_nombre,seccion_id,seccion_nombre,circuito_id,circuito_nombre,"
        "mesa_id,cargo_nombre,agrupacion_id,lista_numero,votos_tipo,votos_cantidad\n"
        f"02,Buenos Aires,027,Coronel Rosales,1,Circuito 1,9001,DIPUTADO NACIONAL,"
        f"110,{lista_numero},POSITIVO,7\n"
    ).encode()

    with pytest.raises(NationalSchemaError) as excinfo:
        ingest_national(
            csv_bytes,
            archive_entry_id="national/measured-shape",
            election_year=election_year,
            election_round=election_round,
        )

    message = str(excinfo.value)
    assert f"{election_year}/{election_round}" in message
    assert "source row 0" in message
    assert repr(lista_numero) in message


def test_internal_primary_lists_are_distinct_rows_not_quarantined() -> None:
    """In a PASO, one agrupación fields SEVERAL internal lists.

    That is the entire point of a primary: agrupación 134 in the real 2023
    PASO file runs `3005 A- CELESTE Y BLANCA` and `3006 B- JUSTA Y
    SOBERANA` against each other in the same mesa and cargo. They are
    different candidacies with different vote counts, not a data defect.

    Deriving `list_id` from `agrupacion_id` alone collapses them into one
    natural key, so the ambiguity quarantine — added for the genuinely
    indistinguishable municipal rows in the 2023 generales file — discarded
    every internal list in the PASO: 6.462.906 rows across 2.666.412 keys,
    spanning every category including PRESIDENTE. `lista_numero` is empty
    in the 2023 generales file, populated throughout the PASO, and
    populated for about a quarter of the 2025 rows, so the identity of a
    list is the pair, not the agrupación.
    """
    csv_text = (
        "año,eleccion_tipo,recuento_tipo,padron_tipo,distrito_id,distrito_nombre,"
        "seccionprovincial_id,seccionprovincial_nombre,seccion_id,seccion_nombre,"
        "circuito_id,circuito_nombre,mesa_id,mesa_tipo,mesa_electores,cargo_id,"
        "cargo_nombre,agrupacion_id,agrupacion_nombre,lista_numero,lista_nombre,"
        "votos_tipo,votos_cantidad\n"
        "2023,PASO,DEFINITIVO,NAC,01,X,,,1,S,00001,C,1,NATIVOS,300,1,PRESIDENTE,"
        "134,UXP,3005,A- CELESTE Y BLANCA,POSITIVO,49\n"
        "2023,PASO,DEFINITIVO,NAC,01,X,,,1,S,00001,C,1,NATIVOS,300,1,PRESIDENTE,"
        "134,UXP,3006,B- JUSTA Y SOBERANA,POSITIVO,25\n"
    )

    rows = ingest_national(
        csv_text.encode("utf-8"),
        archive_entry_id="test/paso",
        election_year=2023,
        election_round="paso",
    )

    assert len(rows) == 2, (
        f"both internal lists of the same agrupación must survive as distinct rows; got {len(rows)}"
    )
    assert len({r.list_id for r in rows}) == 2, (
        f"the two lists must carry distinct list_ids; got {[r.list_id for r in rows]}"
    )
    assert {r.result.votes for r in rows} == {49, 25}


# ---------------------------------------------------------------------------
# Rule 3 — every exclusion is reported per reason, in rows and in votes
# ---------------------------------------------------------------------------


def test_each_out_of_scope_reason_is_counted_separately_in_rows_and_votes(capsys) -> None:
    """Three reasons, three counts. Reported as one total, a filter that
    started swallowing POSITIVO rows would hide inside the EN BLANCO count
    that always looks large and always looks expected.
    """
    csv_bytes = (
        b"distrito_id,distrito_nombre,seccion_id,seccion_nombre,circuito_id,"
        b"circuito_nombre,mesa_id,cargo_nombre,agrupacion_id,votos_tipo,votos_cantidad\n"
        # kept
        b"02,Buenos Aires,027,Coronel Rosales,1,Circuito 1,9001,DIPUTADO NACIONAL,"
        b"110,POSITIVO,50\n"
        # excluded: three distinct reasons, distinct vote counts
        b"02,Buenos Aires,027,Coronel Rosales,1,Circuito 1,9001,DIPUTADO NACIONAL,"
        b"110,EN BLANCO,7\n"
        b"02,Buenos Aires,027,Coronel Rosales,1,Circuito 1,9001,DIPUTADO NACIONAL,"
        b"110,NULO,3\n"
        b"02,Buenos Aires,027,Coronel Rosales,1,Circuito 1,9001,DIPUTADO NACIONAL,"
        b",POSITIVO,11\n"
        b"02,Buenos Aires,027,Coronel Rosales,1,Circuito 1,9001,DIPUTADO NACIONAL,"
        b"0,POSITIVO,13\n"
    )

    rows = ingest_national(
        csv_bytes,
        archive_entry_id="national/test",
        election_year=2025,
        election_round="legislativas",
    )

    assert len(rows) == 1
    report = capsys.readouterr().err
    assert "excluded 4 row(s)" in report
    assert "'EN BLANCO': 1 rows / 7 votes" in report
    assert "'NULO': 1 rows / 3 votes" in report
    assert "agrupacion_id empty: 1 rows / 11 votes" in report
    assert 'agrupacion_id "0": 1 rows / 13 votes' in report


def test_an_excluded_row_with_an_unreadable_vote_count_is_not_summed_as_zero(capsys) -> None:
    """A number nobody could read is not the number zero. It is counted as a
    dropped row and named as unreadable, never folded into the votes total.
    """
    csv_bytes = (
        b"distrito_id,distrito_nombre,seccion_id,seccion_nombre,circuito_id,"
        b"circuito_nombre,mesa_id,cargo_nombre,agrupacion_id,votos_tipo,votos_cantidad\n"
        b"02,Buenos Aires,027,Coronel Rosales,1,Circuito 1,9001,DIPUTADO NACIONAL,"
        b"110,EN BLANCO,4\n"
        b"02,Buenos Aires,027,Coronel Rosales,1,Circuito 1,9001,DIPUTADO NACIONAL,"
        b"110,EN BLANCO,cuatro\n"
    )

    ingest_national(
        csv_bytes,
        archive_entry_id="national/test",
        election_year=2025,
        election_round="legislativas",
    )

    report = capsys.readouterr().err
    assert "'EN BLANCO': 2 rows / 4 votes" in report
    assert "1 with an unparseable vote count, not summed" in report


def test_an_unreadable_kept_row_is_excluded_by_reason_not_a_dead_run(capsys) -> None:
    """`int("")` on a truncated line killed the whole ingest -- and
    `_report_exclusions` runs AFTER the loop, so the breakdown for every row
    already excluded died with it. Both cells get their own reason: an
    unreadable vote count is not the number zero.
    """
    csv_bytes = (
        b"distrito_id,distrito_nombre,seccion_id,seccion_nombre,circuito_id,"
        b"circuito_nombre,mesa_id,cargo_nombre,agrupacion_id,votos_tipo,votos_cantidad\n"
        b"02,Buenos Aires,027,Coronel Rosales,1,Circuito 1,9001,DIPUTADO NACIONAL,"
        b"110,POSITIVO,50\n"
        b"02,Buenos Aires,027,Coronel Rosales,1,Circuito 1,,DIPUTADO NACIONAL,"
        b"110,POSITIVO,9\n"
        b"02,Buenos Aires,027,Coronel Rosales,1,Circuito 1,9002,DIPUTADO NACIONAL,"
        b"110,POSITIVO,\n"
        b"02,Buenos Aires,027,Coronel Rosales,1,Circuito 1,9003,DIPUTADO NACIONAL,"
        b"110,EN BLANCO,4\n"
    )

    rows = ingest_national(
        csv_bytes,
        archive_entry_id="national/test",
        election_year=2025,
        election_round="legislativas",
    )

    assert [row.mesa for row in rows] == [9001]
    report = capsys.readouterr().err
    assert "unreadable mesa_id: 1 rows / 9 votes" in report
    assert "unreadable votos_cantidad: 1 rows" in report
    # The breakdown for the ordinary exclusions still gets printed, which is
    # what the crash used to take with it.
    assert "'EN BLANCO': 1 rows / 4 votes" in report


@pytest.mark.parametrize("field", ["distrito_id", "seccion_id", "circuito_id"])
@pytest.mark.parametrize("bad_value", ["", "XX", "?", "true", "false", "2_7"])
def test_malformed_administrative_codes_are_excluded_per_field_with_vote_counts(
    capsys, field: str, bad_value: str
) -> None:
    columns = [
        "distrito_id",
        "distrito_nombre",
        "seccion_id",
        "seccion_nombre",
        "circuito_id",
        "circuito_nombre",
        "mesa_id",
        "cargo_nombre",
        "agrupacion_id",
        "votos_tipo",
        "votos_cantidad",
    ]
    values = {
        "distrito_id": "02",
        "distrito_nombre": "Buenos Aires",
        "seccion_id": "027",
        "seccion_nombre": "Coronel Rosales",
        "circuito_id": "00248",
        "circuito_nombre": "Circuito 248",
        "mesa_id": "9001",
        "cargo_nombre": "DIPUTADO NACIONAL",
        "agrupacion_id": "110",
        "votos_tipo": "POSITIVO",
        "votos_cantidad": "7",
    }
    values[field] = bad_value
    csv_bytes = (
        ",".join(columns) + "\n" + ",".join(values[column] for column in columns) + "\n"
    ).encode()

    rows = ingest_national(
        csv_bytes,
        archive_entry_id="national/test",
        election_year=2025,
        election_round="legislativas",
    )

    assert rows == []
    assert capsys.readouterr().err == (
        "excluded 1 row(s) as out of scope for normalized list votes -- "
        f"unreadable {field}: 1 rows / 7 votes\n"
    )


@pytest.mark.parametrize(
    "codes",
    [
        ("2", "27", "248"),
        ("02", "027", "00248"),
    ],
)
def test_padded_and_unpadded_numeric_administrative_codes_are_accepted(
    codes: tuple[str, str, str],
) -> None:
    distrito, seccion, circuito = codes
    csv_bytes = (
        b"distrito_id,distrito_nombre,seccion_id,seccion_nombre,circuito_id,"
        b"circuito_nombre,mesa_id,cargo_nombre,agrupacion_id,votos_tipo,votos_cantidad\n"
        + f"{distrito},Buenos Aires,{seccion},Coronel Rosales,{circuito},Circuito,"
        "9001,DIPUTADO NACIONAL,110,POSITIVO,7\n".encode()
    )

    rows = ingest_national(
        csv_bytes,
        archive_entry_id="national/test",
        election_year=2025,
        election_round="legislativas",
    )

    assert len(rows) == 1
    result = rows[0].result
    assert (result.distrito, result.seccion, result.circuito) == codes


def test_alphanumeric_circuito_survives_ingest_and_raw_identity_extraction() -> None:
    csv_bytes = (
        b"distrito_id,distrito_nombre,seccion_id,seccion_nombre,circuito_id,"
        b"circuito_nombre,mesa_id,cargo_nombre,agrupacion_id,votos_tipo,votos_cantidad\n"
        b"02,Buenos Aires,027,Coronel Rosales,0249A,Circuito 249A,9001,"
        b"DIPUTADO NACIONAL,110,POSITIVO,7\n"
    )

    rows = ingest_national(
        csv_bytes,
        archive_entry_id="national/test-circuito-suffix",
        election_year=2025,
        election_round="legislativas",
    )

    assert len(rows) == 1
    assert rows[0].result.circuito == "0249A"
    assert rows[0].result.votes == 7
    assert extract_raw_mesa_identities_from_text(_text_of(csv_bytes)) == {
        ("02", "027", "0249A", 9001)
    }


@pytest.mark.parametrize("bad_circuito", ["249AB", "24A9", "24_9A", "+249A", "٢49A"])
def test_malformed_alphanumeric_circuitos_remain_reported(capsys, bad_circuito: str) -> None:
    csv_bytes = (
        b"distrito_id,distrito_nombre,seccion_id,seccion_nombre,circuito_id,"
        b"circuito_nombre,mesa_id,cargo_nombre,agrupacion_id,votos_tipo,votos_cantidad\n"
        + f"02,Buenos Aires,027,Coronel Rosales,{bad_circuito},Circuito,9001,"
        "DIPUTADO NACIONAL,110,POSITIVO,7\n".encode()
    )

    assert (
        ingest_national(
            csv_bytes,
            archive_entry_id="national/test-circuito-suffix",
            election_year=2025,
            election_round="legislativas",
        )
        == []
    )
    assert "unreadable circuito_id: 1 rows / 7 votes" in capsys.readouterr().err


def test_raw_mesa_identities_include_circuito_in_the_exact_identity(capsys) -> None:
    csv_bytes = (
        b"distrito_id,seccion_id,circuito_id,mesa_id,cargo_nombre,agrupacion_id,"
        b"votos_tipo,votos_cantidad\n"
        b"02,027,00001,142,DIPUTADO NACIONAL,110,POSITIVO,7\n"
        b"02,027,00002,142,DIPUTADO NACIONAL,110,POSITIVO,8\n"
        b"02,no-leible,00003,143,DIPUTADO NACIONAL,110,POSITIVO,9\n"
        b"02,027,,144,DIPUTADO NACIONAL,110,POSITIVO,10\n"
        b"02,027,circuito,145,DIPUTADO NACIONAL,110,POSITIVO,11\n"
    )

    identities = extract_raw_mesa_identities_from_text(_text_of(csv_bytes))

    assert identities == {
        ("02", "027", "00001", 142),
        ("02", "027", "00002", 142),
    }
    report = capsys.readouterr().err
    assert "unreadable seccion_id: 1 row(s)" in report
    assert "absent circuito_id: 1 row(s)" in report
    assert "unreadable circuito_id: 1 row(s)" in report


def test_raw_mesa_identities_precede_vote_filters_and_quarantine(capsys) -> None:
    csv_bytes = (
        b"\xef\xbb\xbfdistrito_id,seccion_id,circuito_id,mesa_id,cargo_nombre,agrupacion_id,"
        b"votos_tipo,votos_cantidad\n"
        b"02,027,1,9001,DIPUTADO NACIONAL,,EN BLANCO,7\n"
        b"02,027,1,9002,DIPUTADO NACIONAL,,POSITIVO,11\n"
        b"02,027,1,9003,DIPUTADO NACIONAL,110,POSITIVO,no-leible\n"
        b"02,027,1,09004,DIPUTADO NACIONAL,110,POSITIVO,5\n"
        b"02,027,1,9004,DIPUTADO NACIONAL,111,POSITIVO,6\n"
        b",027,1,9005,DIPUTADO NACIONAL,110,POSITIVO,1\n"
        b"XX,027,1,9006,DIPUTADO NACIONAL,110,POSITIVO,1\n"
        b"02,027,1,,DIPUTADO NACIONAL,110,POSITIVO,1\n"
        b"02,027,1,mesa,DIPUTADO NACIONAL,110,POSITIVO,1\n"
        b"02,,1,9007,DIPUTADO NACIONAL,110,POSITIVO,1\n"
    )

    identities = extract_raw_mesa_identities_from_text(_text_of(csv_bytes))

    assert identities == {
        ("02", "027", "1", 9001),
        ("02", "027", "1", 9002),
        ("02", "027", "1", 9003),
        ("02", "027", "1", 9004),
    }
    report = capsys.readouterr().err
    assert "absent distrito_id: 1 row(s)" in report
    assert "unreadable distrito_id: 1 row(s)" in report
    assert "absent mesa_id: 1 row(s)" in report
    assert "unreadable mesa_id: 1 row(s)" in report


@pytest.mark.parametrize("missing_column", ["distrito_id", "seccion_id", "circuito_id", "mesa_id"])
def test_raw_mesa_identity_schema_requires_named_columns(missing_column: str) -> None:
    columns = ["distrito_id", "seccion_id", "circuito_id", "mesa_id"]
    columns.remove(missing_column)
    csv_bytes = (",".join(columns) + "\n" + ",".join("1" for _ in columns) + "\n").encode()

    with pytest.raises(NationalSchemaError, match=missing_column):
        extract_raw_mesa_identities_from_text(_text_of(csv_bytes))


@pytest.mark.parametrize("bad_value", ["1_2", "+12", "-1"])
@pytest.mark.parametrize("field", ["mesa_id", "votos_cantidad"])
def test_signed_and_permissive_python_integer_forms_are_excluded_by_source_field(
    capsys, field: str, bad_value: str
) -> None:
    values = {
        "distrito_id": "02",
        "distrito_nombre": "Buenos Aires",
        "seccion_id": "027",
        "seccion_nombre": "Coronel Rosales",
        "circuito_id": "1",
        "circuito_nombre": "Circuito 1",
        "mesa_id": "9001",
        "cargo_nombre": "DIPUTADO NACIONAL",
        "agrupacion_id": "110",
        "votos_tipo": "POSITIVO",
        "votos_cantidad": "12",
    }
    values[field] = bad_value
    columns = tuple(values)
    csv_bytes = (
        ",".join(columns) + "\n" + ",".join(values[column] for column in columns) + "\n"
    ).encode()

    assert (
        ingest_national(
            csv_bytes,
            archive_entry_id="national/test",
            election_year=2025,
            election_round="legislativas",
        )
        == []
    )
    vote_summary = (
        "12 votes"
        if field == "mesa_id"
        else "0 votes (1 with an unparseable vote count, not summed)"
    )
    assert capsys.readouterr().err == (
        "excluded 1 row(s) as out of scope for normalized list votes -- "
        f"unreadable {field}: 1 rows / {vote_summary}\n"
    )
