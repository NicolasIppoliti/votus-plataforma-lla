"""Tests for the normalized jurisdiction hierarchy model.

Covers `jurisdiction-model` spec, "Explicit jurisdiction hierarchy"
requirement: every stored result MUST be attributable to exactly one
level, and a coarser-granularity row MUST NOT fabricate the finer levels
it does not have (task 3.1).

Phase 17 additions: Coronel Rosales was measured live as THREE separate
jurisdiction identities (national unpadded `"2"`/`"27"`, fiscalización
padded `"02"`/`"027"`, PBA's own `"027"`) because administrative codes were
normalized per call site instead of behind one boundary (tasks 17.1-17.3).
"""

from __future__ import annotations

import pytest

from etl.crosswalk import CrosswalkTable, JurisdictionCrosswalkEntry
from etl.jurisdiction import (
    QuarantinedPbaDistrito,
    is_canonicalizable_circuito_code,
    is_canonicalizable_code,
    make_result_row,
    normalize_circuito_code,
    normalize_distrito_code,
    normalize_pba_distrito_code,
    normalize_seccion_code,
    resolve_pba_distrito_code,
)


def test_mesa_row_records_full_lineage() -> None:
    row = make_result_row(
        granularity="mesa",
        distrito="02",
        seccion="027",
        circuito="00248",
        establecimiento="Escuela N.1",
        mesa=1,
        category="PRESIDENTE/A",
        list_id="134",
        votes=13,
    )

    assert row.granularity == "mesa"
    assert row.distrito == "02"
    assert row.seccion == "027"
    assert row.circuito == "00248"
    assert row.establecimiento == "Escuela N.1"
    assert row.mesa == 1


def test_distrito_row_does_not_fabricate_lower_levels() -> None:
    row = make_result_row(
        granularity="distrito",
        distrito="02",
        category="INTENDENTE",
        list_id="134",
        votes=1000,
    )

    assert row.granularity == "distrito"
    assert row.distrito == "02"
    # No sección/circuito/establecimiento/mesa data exists at this
    # granularity — the model MUST NOT invent placeholder values for them.
    assert row.seccion is None
    assert row.circuito is None
    assert row.establecimiento is None
    assert row.mesa is None


def test_distrito_row_rejects_a_fabricated_mesa_value() -> None:
    # Passing a mesa value alongside `granularity="distrito"` is a caller
    # bug, not data the model may silently store — the fabrication ban is
    # a structural constraint, not just a default.
    with pytest.raises(ValueError, match="distrito"):
        make_result_row(
            granularity="distrito",
            distrito="02",
            mesa=1,
            category="INTENDENTE",
            list_id="134",
            votes=1000,
        )


# ---------------------------------------------------------------------------
# Phase 17 — single administrative-code normalization boundary
# ---------------------------------------------------------------------------


def test_padded_and_unpadded_codes_resolve_to_one_jurisdiction() -> None:
    """Format cause (Phase 17): national ingestion writes the raw CSV's
    UNPADDED distrito/seccion (`"2"`/`"27"`) while fiscalización writes the
    curated PADDED form (`"02"`/`"027"`) — the same real mesa, two distinct
    jurisdiction rows before this fix. `normalize_distrito_code` /
    `normalize_seccion_code` must collapse both spellings to one canonical
    value — the transform `etl.db.upsert_jurisdiction` (and the batched
    variant) apply at the actual write boundary, proven end-to-end against a
    real Postgres in `test_integration_idempotent.py::
    test_padded_and_unpadded_national_codes_share_one_jurisdiction_row`.

    Deliberately NOT asserted through `make_result_row` here: a `ResultRow`'s
    `distrito` is not always yet a national code at construction time (see
    the module docstring on why PBA's raw parse output must never be
    blindly re-padded) — `make_result_row` itself stays a pass-through on
    these fields, by design.
    """
    assert normalize_distrito_code("2") == normalize_distrito_code("02") == "02"
    assert normalize_seccion_code("27") == normalize_seccion_code("027") == "027"


def test_normalize_seccion_code_passes_none_through_unchanged() -> None:
    # A coarser-than-seccion row legitimately carries no seccion value at
    # all (the fabrication ban) -- normalizing `None` must stay `None`,
    # never a fabricated padded value.
    assert normalize_seccion_code(None) is None


def test_pba_distrito_normalization_is_a_distinct_three_digit_scheme() -> None:
    assert normalize_pba_distrito_code(" 27 ") == "027"
    assert normalize_pba_distrito_code("027") == "027"
    assert normalize_pba_distrito_code(None) is None
    assert normalize_pba_distrito_code("P27") == "P27"
    assert normalize_distrito_code("27") == "27"


@pytest.mark.parametrize("raw", ["٢", "１２", "²", "2_7", "+2", "-2"])
def test_non_ascii_or_decorated_codes_are_not_canonicalizable(raw: str) -> None:
    assert is_canonicalizable_code(raw) is False
    assert normalize_distrito_code(raw) == raw
    assert normalize_seccion_code(raw) == raw
    assert normalize_circuito_code(raw) == raw


def test_normalize_code_preserves_digit_string_too_long_for_int_conversion() -> None:
    raw = "9" * 10_000

    assert is_canonicalizable_code(raw) is True
    assert normalize_distrito_code(raw) == raw


def test_pba_distrito_code_resolves_through_the_crosswalk_to_the_national_pair() -> None:
    """Scheme cause (Phase 17): PBA writes its own `distrito_code = "027"`.
    `jurisdiction_crosswalk`'s single entry says PBA `"027"` maps to
    national `"02"`/`"027"` — this must actually be consulted, resolving to
    the SAME national distrito national ingestion and fiscalización use,
    never a third, PBA-only code space.
    """
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

    resolved = resolve_pba_distrito_code("027", crosswalk)

    # The PAIR, as this test's own name says: PBA's distrito `027` is the
    # partido, national distrito `02` is the province, and Coronel Rosales is
    # its seccion `027`. Resolving only the province attributes a partido
    # total to all of Buenos Aires.
    assert resolved == ("02", "027")


def test_an_uncurated_pba_code_is_quarantined_not_silently_written() -> None:
    """A PBA distrito code with no curated crosswalk entry must not create
    a new jurisdiction island under PBA's own numbering scheme — it is
    quarantined and surfaced as data, matching the existing
    `QuarantinedJurisdiction` shape for the analogous national-side problem.
    """
    crosswalk = CrosswalkTable(jurisdictions=())

    resolved = resolve_pba_distrito_code("999", crosswalk)

    assert isinstance(resolved, QuarantinedPbaDistrito)
    assert resolved.pba_distrito_code == "999"
    assert "999" in resolved.reason


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("248", "00248"), ("0249A", "0249A"), ("249a", "0249A"), ("12345A", "12345A")],
)
def test_circuito_codes_use_their_alphanumeric_canonical_scheme(raw: str, expected: str) -> None:
    assert is_canonicalizable_circuito_code(raw) is True
    assert normalize_circuito_code(raw) == expected


@pytest.mark.parametrize("raw", ["", "   ", "٢", "１２", "+249A", "24_9A", "249AB", "24A9", "A249"])
def test_malformed_circuito_codes_are_not_canonicalizable(raw: str) -> None:
    assert is_canonicalizable_circuito_code(raw) is False
    assert normalize_circuito_code(raw) == raw


def test_normalize_circuito_code_pads_and_never_truncates() -> None:
    """Circuito is normalized at the same boundary as distrito and seccion.

    Leaving it out meant `jurisdiction.py` declared itself the single
    normalization boundary while one of its three codes was written raw,
    forcing every reader to compensate — two independent ideas of the same
    code, which is what produced Coronel Rosales as three identities.

    The padding must never truncate: SQL's `lpad(x, 5, '0')` cuts a wider
    value from the right, and a normalizer that silently shortens a code is
    worse than one that leaves it alone.
    """
    assert normalize_circuito_code("1") == "00001"
    assert normalize_circuito_code("00001") == "00001"
    assert normalize_circuito_code(None) is None
    assert normalize_circuito_code("123456") == "123456", (
        "a wider code must survive intact, never be truncated to the padding width"
    )


def test_merge_key_distinguishes_null_empty_and_present_mesa_values() -> None:
    from etl.db import merge_key

    base = (None, "027", "A|B", "School\\C")
    assert merge_key(*base, None) != merge_key("", *base[1:], None)
    assert merge_key(*base, None) != merge_key(*base, 0)


def test_the_sql_and_python_merge_keys_agree_on_nulls_and_escaped_characters() -> None:
    """The production batch path keeps hostile and NULL-bearing lineages injective.

    Calling the real batch entry point twice exercises both the Python merge-key
    encoder and its SQL join expression. The transaction is always rolled back.
    """
    import os

    import psycopg
    import pytest

    from etl.db import batch_upsert_jurisdictions

    dsn = os.environ.get(
        "ETL_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    )
    try:
        conn = psycopg.connect(dsn, connect_timeout=2)
    except psycopg.OperationalError as exc:
        pytest.skip(f"no ephemeral Postgres reachable at {dsn!r}: {exc}")

    lineages = [
        ("02", None, "A|B", "School\\C", None),
        ("02", "", "A|B", "School\\C", None),
        ("02", None, "A|B", "School\\C", 0),
        ("02", "027", "A|B", "School\\C", 1),
        ("02", "027", "A", "B|School\\C", 1),
    ]
    try:
        first = batch_upsert_jurisdictions(conn, lineages)
        second = batch_upsert_jurisdictions(conn, lineages)

        assert len(set(first.values())) == len(lineages), (
            "NULL, empty, mesa, separator, and backslash differences must stay distinct"
        )
        assert second == first, "a repeated batch must resolve the same jurisdiction ids"
    finally:
        conn.rollback()
        conn.close()
