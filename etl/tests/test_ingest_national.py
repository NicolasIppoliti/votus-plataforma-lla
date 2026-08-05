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
