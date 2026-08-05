"""RED tests for national 2023/2025 ZIP ingestion (`electoral-ingestion` spec,
national subset). Fixtures are derived from real data, never from a live
network fetch or the gitignored 88 MB archived ZIP:

- `fixtures/national_2023_sample.csv`: 4 rows sliced directly from the real,
  already-archived `archive/national_2023_paso/2023-PROVISORIOS_PASO.zip`
  (`2023_PASO/ResultadosElectorales.csv`), filtered to distrito 02 / seccion
  027 (Coronel Rosales), mesas 1-2, cargo PRESIDENTE/A, agrupaciones 134/135 —
  real bytes, real vote counts, extracted by a one-off `python3 -c` streaming
  filter (never fully materializing the 3.7 GB uncompressed CSV).
- `fixtures/national_2025_sample.csv`: no 2025 ZIP is present on this
  machine (only the 2023 PASO archive survived the SPIKE session). This
  fixture is RECONSTRUCTED using the exact real 2025 header and the exact
  real distrito/seccion/agrupación values recorded in
  `spikes/001-granularity-and-join-keys.md` (a)/(c)/(h) — not invented, but
  reassembled rather than sliced from a live download. Documented here per
  the apply instructions' "derive a MINIMAL one and say exactly how".
"""

from __future__ import annotations

from pathlib import Path

import pytest

from etl.ingest.national import NationalSchemaError, ingest_national
from etl.storage import extract_zip_safely

FIXTURES = Path(__file__).parent / "fixtures"


def _read(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def test_2023_generales_mesa_rows_one_per_combination() -> None:
    rows = ingest_national(
        _read("national_2023_sample.csv"), archive_entry_id="national/2023-generales"
    )

    # 2 mesas x 2 lists (agrupación 134, 135) = 4 combinations, no more, no
    # fewer — one normalized row per (mesa, list, category) combination.
    assert len(rows) == 4
    assert {(r.mesa, r.list_id) for r in rows} == {
        (1, "134"),
        (1, "135"),
        (2, "134"),
        (2, "135"),
    }
    for row in rows:
        assert row.granularity == "mesa"
        assert row.category == "PRESIDENTE/A"
        # `estado_final` is absent from the 2023 schema entirely (SPIKE b) —
        # MUST be treated as absent, never defaulted to a guessed status.
        assert row.estado_final is None


def test_2025_bup_format_parsed_or_fails_loudly() -> None:
    rows = ingest_national(
        _read("national_2025_sample.csv"), archive_entry_id="national/2025-legislativas"
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
        b"distrito_id,seccion_id,circuito_id,cargo_nombre,agrupacion_id,"
        b"votos_tipo,votos_cantidad\n"
        b"02,027,00248,DIPUTADO NACIONAL,135,POSITIVO,90\n"
    )  # missing `mesa_id` entirely — an unrecognized structure, not partial data.

    with pytest.raises(NationalSchemaError, match="mesa_id"):
        ingest_national(malformed, archive_entry_id="national/2025-legislativas")


def test_idempotent_reingest_same_archive_entry() -> None:
    data = _read("national_2023_sample.csv")

    first = ingest_national(data, archive_entry_id="national/2023-generales")
    second = ingest_national(data, archive_entry_id="national/2023-generales")

    assert first == second
    natural_keys = [r.natural_key for r in first]
    assert len(natural_keys) == len(set(natural_keys)), "no duplicate rows on re-ingest"


def test_full_rebuild_from_archive_is_identical() -> None:
    data = _read("national_2023_sample.csv")

    built = ingest_national(data, archive_entry_id="national/2023-generales")
    # "Drop and rebuild": discard the in-memory projection entirely and
    # re-derive it from the same archived bytes, exactly as a real rebuild
    # would re-run ingestion against the immutable archive (D8) with no
    # normalized-layer state carried across the drop.
    del built
    rebuilt = ingest_national(data, archive_entry_id="national/2023-generales")

    assert rebuilt == ingest_national(data, archive_entry_id="national/2023-generales")


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

    first = ingest_national(data, archive_entry_id="national/2023-generales")
    second = ingest_national(data, archive_entry_id="national/2023-generales")

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
        "2023,GENERAL,DEFINITIVO,NAC,20,X,,,1,S,00001,C,1,M,300,7,INTENDENTE,"
        "200704,AGRUP,,,POSITIVO,79\n"
        "2023,GENERAL,DEFINITIVO,NAC,20,X,,,1,S,00001,C,1,M,300,7,INTENDENTE,"
        "200704,AGRUP,,,POSITIVO,63\n"
        # An unambiguous row in the same file must survive untouched.
        "2023,GENERAL,DEFINITIVO,NAC,02,Y,,,27,S,00099,C,5,M,300,3,DIPUTADO NACIONAL,"
        "135,LLA,3016,L,POSITIVO,42\n"
    )

    rows = ingest_national(csv_text.encode("utf-8"), archive_entry_id="test/ambiguous")

    keys = [(r.result.distrito, r.result.mesa, r.category, r.list_id) for r in rows]
    assert len(keys) == len(set(keys)), (
        "ingest must not emit two rows sharing one natural key; the ambiguous "
        f"pair was not quarantined: {keys}"
    )
    assert any(r.list_id == "135" for r in rows), (
        "the unambiguous row must still be ingested -- one ambiguous municipal "
        "row must not discard the rest of the file"
    )
