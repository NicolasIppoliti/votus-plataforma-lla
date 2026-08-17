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
    JurisdictionNames,
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


def test_jurisdiction_names_normalize_only_outer_whitespace_and_blank_values() -> None:
    names = JurisdictionNames(
        distrito="  Buenos Aires  ",
        seccion="\tCoronel de Marina L. Rosales\n",
        circuito="  ",
        establecimiento="Escuela N° 1",
    )

    assert names.distrito == "Buenos Aires"
    assert names.seccion == "Coronel de Marina L. Rosales"
    assert names.circuito is None
    assert names.establecimiento == "Escuela N° 1"


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


class _ExistingJurisdictionCursor:
    def __init__(self, state: list[str | None]) -> None:
        self.state = state
        self.fetchone_result = None
        self.fetchall_result = []
        self.name_updates = 0
        self.queries: list[str] = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def execute(self, query, params=None) -> None:
        if not isinstance(query, str):
            self.queries.append("batch lineage select")
            keys = list(zip(*params[:5]))
            self.fetchall_result = [
                (
                    *key,
                    "jurisdiction-id" if len(keys) == 1 else f"jurisdiction-id-{index}",
                    *self.state,
                )
                for index, key in enumerate(keys)
            ]
            return

        self.queries.append(query.strip())
        normalized_query = " ".join(query.split()).lower()
        if normalized_query == "lock table jurisdiction in share row exclusive mode":
            return
        if "select id, distrito_name" in normalized_query:
            self.fetchone_result = ("jurisdiction-id", *self.state)
        elif "update jurisdiction" in normalized_query:
            self.state[:] = params[:4]
            self.name_updates += 1
        else:  # pragma: no cover - this fake only models an already-existing row
            raise AssertionError(f"unexpected SQL shape: {query}")

    def fetchone(self):
        return self.fetchone_result

    def fetchall(self):
        return self.fetchall_result

    def executemany(self, query, params) -> None:
        assert "update jurisdiction" in query
        values = list(params)
        assert len(values) == 1
        self.state[:] = values[0][:4]
        self.name_updates += 1


class _ExistingJurisdictionConnection:
    def __init__(self) -> None:
        self.cursor_instance = _ExistingJurisdictionCursor([None, None, None, None])

    def cursor(self):
        return self.cursor_instance


@pytest.mark.parametrize("mode", ["single", "batch"])
def test_jurisdiction_writers_lock_before_any_lineage_read_or_write(mode: str) -> None:
    from etl.db import batch_upsert_jurisdictions, upsert_jurisdiction

    conn = _ExistingJurisdictionConnection()
    key = ("02", "027", "00248", "37974", 990000)

    if mode == "single":
        assert (
            upsert_jurisdiction(
                conn,
                distrito=key[0],
                seccion=key[1],
                circuito=key[2],
                establecimiento=key[3],
                mesa=key[4],
            )
            == "jurisdiction-id"
        )
    else:
        batch_keys = [(*key[:4], key[4] + offset) for offset in range(50)]
        resolved = batch_upsert_jurisdictions(conn, batch_keys)
        assert len(resolved) == len(batch_keys)

    assert conn.cursor_instance.queries[0] == (
        "LOCK TABLE jurisdiction IN SHARE ROW EXCLUSIVE MODE"
    )
    assert len(conn.cursor_instance.queries) == 2, (
        "the shared lock adds one round trip without changing either writer's bounded query shape"
    )


@pytest.mark.parametrize("mode", ["single", "batch"])
def test_jurisdiction_writers_reject_autocommit_connections(mode: str) -> None:
    conn = _ExistingJurisdictionConnection()
    conn.autocommit = True
    key = ("02", "027", "00248", "37974", 990000)

    with pytest.raises(RuntimeError, match="require a transaction; autocommit"):
        _write_jurisdiction(conn, mode, key, JurisdictionNames())
    assert conn.cursor_instance.queries == []


@pytest.mark.parametrize("mode", ["single", "batch"])
def test_name_reconciliation_contract_runs_through_both_database_entrypoints(mode: str) -> None:
    from etl.db import (
        JurisdictionNameConflictError,
        batch_upsert_jurisdictions,
        upsert_jurisdiction,
    )

    conn = _ExistingJurisdictionConnection()
    key = ("02", "027", "00248", "37974", 990001)

    def write(row_names: JurisdictionNames) -> str:
        if mode == "single":
            return upsert_jurisdiction(
                conn,
                distrito=key[0],
                seccion=key[1],
                circuito=key[2],
                establecimiento=key[3],
                mesa=key[4],
                names=row_names,
            )
        return batch_upsert_jurisdictions(conn, [key], names=[row_names])[key]

    official = JurisdictionNames(
        distrito="Buenos Aires",
        seccion="Coronel de Marina L. Rosales",
        circuito="Circuito 248",
        establecimiento="Escuela N° 1",
    )
    assert write(official) == "jurisdiction-id"
    assert conn.cursor_instance.state == [
        "Buenos Aires",
        "Coronel de Marina L. Rosales",
        "Circuito 248",
        "Escuela N° 1",
    ]
    assert conn.cursor_instance.name_updates == 1

    assert write(JurisdictionNames()) == "jurisdiction-id"
    assert (
        write(
            JurisdictionNames(
                distrito=" Buenos Aires ",
                seccion="Coronel de Marina L. Rosales",
                circuito="Circuito 248",
                establecimiento="Escuela N° 1",
            )
        )
        == "jurisdiction-id"
    )
    assert conn.cursor_instance.name_updates == 1, "NULL and identical re-ingest are no-ops"

    private_sentinel = "PRIVATE_PERSON_SENTINEL"
    for field_name, column_name in (
        ("distrito", "distrito_name"),
        ("seccion", "seccion_name"),
        ("circuito", "circuito_name"),
        ("establecimiento", "establecimiento_name"),
    ):
        with pytest.raises(JurisdictionNameConflictError) as excinfo:
            write(JurisdictionNames(**{field_name: private_sentinel}))
        message = str(excinfo.value)
        assert "exact distrito/seccion/circuito/establecimiento/mesa lineage" in message
        assert column_name in message
        assert private_sentinel not in message
    assert conn.cursor_instance.name_updates == 1


@pytest.mark.parametrize("mode", ["single", "batch"])
def test_jurisdiction_name_upserts_are_conflict_safe_and_idempotent(mode: str) -> None:
    """Both write paths share the same four-column NULL/conflict contract."""
    import os
    import uuid

    import psycopg

    from etl.db import (
        JurisdictionNameConflictError,
        batch_upsert_jurisdictions,
        upsert_jurisdiction,
    )

    dsn = os.environ.get(
        "ETL_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    )
    try:
        conn = psycopg.connect(dsn, connect_timeout=2)
    except psycopg.OperationalError as exc:
        pytest.skip(f"no ephemeral Postgres reachable at {dsn!r}: {exc}")

    marker = f"X{uuid.uuid4().hex[:8]}"
    key = (marker, "027", "00248", "37974", 990001)
    official_names = JurisdictionNames(
        distrito="Buenos Aires",
        seccion="Coronel de Marina L. Rosales",
        circuito="00248",
        establecimiento="Escuela N° 1",
    )

    def write(names: JurisdictionNames) -> str:
        if mode == "single":
            return upsert_jurisdiction(
                conn,
                distrito=key[0],
                seccion=key[1],
                circuito=key[2],
                establecimiento=key[3],
                mesa=key[4],
                names=names,
            )
        return batch_upsert_jurisdictions(conn, [key], names=[names])[key]

    try:
        jurisdiction_id = write(JurisdictionNames())
        filled_id = write(official_names)
        assert filled_id == jurisdiction_id

        # Re-ingest with identical normalized values is a no-op, while NULL
        # input deliberately preserves every existing name.
        assert (
            write(
                JurisdictionNames(
                    distrito=" Buenos Aires ",
                    seccion="Coronel de Marina L. Rosales",
                    circuito="00248",
                    establecimiento="Escuela N° 1",
                )
            )
            == jurisdiction_id
        )
        assert write(JurisdictionNames()) == jurisdiction_id

        with conn.cursor() as cur:
            cur.execute(
                """
                select distrito_name, seccion_name, circuito_name, establecimiento_name
                from jurisdiction where id = %s
                """,
                (jurisdiction_id,),
            )
            assert cur.fetchone() == (
                "Buenos Aires",
                "Coronel de Marina L. Rosales",
                "00248",
                "Escuela N° 1",
            )

        private_sentinel = "PRIVATE_PERSON_SENTINEL"
        with pytest.raises(JurisdictionNameConflictError) as excinfo:
            write(JurisdictionNames(seccion=private_sentinel))
        message = str(excinfo.value)
        assert "exact distrito/seccion/circuito/establecimiento/mesa lineage" in message
        assert "seccion_name" in message
        assert private_sentinel not in message
    finally:
        conn.rollback()
        conn.close()


def _open_ephemeral_postgres_connections(count: int):
    import os

    import psycopg

    dsn = os.environ.get(
        "ETL_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    )
    connections = []
    try:
        for _ in range(count):
            connections.append(psycopg.connect(dsn, connect_timeout=2))
    except psycopg.OperationalError:
        for connection in connections:
            connection.close()
        pytest.skip("no ephemeral Postgres reachable for jurisdiction concurrency proof")
    return connections


def _write_jurisdiction(
    conn,
    mode: str,
    key: tuple[str, str | None, str | None, str | None, int | None],
    names: JurisdictionNames,
) -> str:
    from etl.db import batch_upsert_jurisdictions, upsert_jurisdiction

    if mode == "single":
        return upsert_jurisdiction(
            conn,
            distrito=key[0],
            seccion=key[1],
            circuito=key[2],
            establecimiento=key[3],
            mesa=key[4],
            names=names,
        )
    return batch_upsert_jurisdictions(conn, [key], names=[names])[key]


def _start_jurisdiction_writer(conn, mode: str, key, names: JurisdictionNames):
    import threading

    started = threading.Event()
    finished = threading.Event()
    outcome: dict[str, object] = {}

    def write() -> None:
        started.set()
        try:
            outcome["value"] = _write_jurisdiction(conn, mode, key, names)
        except BaseException as exc:  # surfaced and asserted by the owning test thread
            outcome["error"] = exc
        finally:
            finished.set()

    thread = threading.Thread(target=write, daemon=True)
    thread.start()
    assert started.wait(timeout=1)
    return thread, finished, outcome


def _assert_writer_waits_for_first_transaction(finished) -> None:
    assert not finished.wait(timeout=0.2), (
        "the competing jurisdiction writer completed before the first transaction released its lock"
    )


def _finish_writer_after_commit(conn, thread, finished) -> None:
    conn.commit()
    assert finished.wait(timeout=5), (
        "the serialized jurisdiction writer did not resume after commit"
    )
    thread.join(timeout=1)


def _cleanup_concurrency_row(conn, marker: str) -> None:
    conn.rollback()
    with conn.cursor() as cur:
        cur.execute("delete from jurisdiction where distrito_code = %s", (marker,))
    conn.commit()


def test_concurrent_single_and_batch_same_lineage_and_names_resolve_one_row() -> None:
    import uuid

    first, second, observer = _open_ephemeral_postgres_connections(3)
    marker = f"X{uuid.uuid4().hex[:8]}"
    key = (marker, "027", "00248", "37974", 990010)
    names = JurisdictionNames(distrito="Buenos Aires", seccion="Coronel Rosales")
    thread = None
    try:
        first_id = _write_jurisdiction(first, "single", key, names)
        assert _write_jurisdiction(first, "single", key, names) == first_id, (
            "one transaction must be able to re-enter the table lock through the single writer"
        )
        thread, finished, outcome = _start_jurisdiction_writer(second, "batch", key, names)
        _assert_writer_waits_for_first_transaction(finished)
        _finish_writer_after_commit(first, thread, finished)

        assert "error" not in outcome
        assert outcome["value"] == first_id
        with observer.cursor() as cur:
            cur.execute("select id from jurisdiction where distrito_code = %s", (marker,))
            assert cur.fetchall() == [(first_id,)]
    finally:
        first.rollback()
        second.rollback()
        if thread is not None:
            thread.join(timeout=1)
        _cleanup_concurrency_row(observer, marker)
        first.close()
        second.close()
        observer.close()


def test_concurrent_conflicting_names_serialize_then_preserve_authoritative_value() -> None:
    import uuid

    from etl.db import JurisdictionNameConflictError

    first, second, observer = _open_ephemeral_postgres_connections(3)
    marker = f"X{uuid.uuid4().hex[:8]}"
    key = (marker, "027", "00248", "37974", 990011)
    authoritative = JurisdictionNames(seccion="Coronel Rosales")
    private_sentinel = "PRIVATE_PERSON_SENTINEL"
    thread = None
    try:
        first_id = _write_jurisdiction(first, "batch", key, authoritative)
        thread, finished, outcome = _start_jurisdiction_writer(
            second,
            "single",
            key,
            JurisdictionNames(seccion=private_sentinel),
        )
        _assert_writer_waits_for_first_transaction(finished)
        _finish_writer_after_commit(first, thread, finished)

        error = outcome.get("error")
        assert isinstance(error, JurisdictionNameConflictError)
        assert private_sentinel not in str(error)
        with observer.cursor() as cur:
            cur.execute(
                "select id, seccion_name from jurisdiction where distrito_code = %s",
                (marker,),
            )
            assert cur.fetchall() == [(first_id, "Coronel Rosales")]
    finally:
        first.rollback()
        second.rollback()
        if thread is not None:
            thread.join(timeout=1)
        _cleanup_concurrency_row(observer, marker)
        first.close()
        second.close()
        observer.close()


def test_concurrent_nullable_lineage_does_not_duplicate() -> None:
    import uuid

    first, second, observer = _open_ephemeral_postgres_connections(3)
    marker = f"X{uuid.uuid4().hex[:8]}"
    key = (marker, None, None, None, None)
    thread = None
    try:
        first_id = _write_jurisdiction(first, "single", key, JurisdictionNames())
        thread, finished, outcome = _start_jurisdiction_writer(
            second, "batch", key, JurisdictionNames()
        )
        _assert_writer_waits_for_first_transaction(finished)
        _finish_writer_after_commit(first, thread, finished)

        assert "error" not in outcome
        assert outcome["value"] == first_id
        with observer.cursor() as cur:
            cur.execute(
                """
                select id
                from jurisdiction
                where distrito_code = %s
                  and seccion_code is null
                  and circuito_code is null
                  and establecimiento_code is null
                  and mesa_code is null
                """,
                (marker,),
            )
            assert cur.fetchall() == [(first_id,)]
    finally:
        first.rollback()
        second.rollback()
        if thread is not None:
            thread.join(timeout=1)
        _cleanup_concurrency_row(observer, marker)
        first.close()
        second.close()
        observer.close()


def test_batch_jurisdiction_names_merge_complementary_values_not_first_wins() -> None:
    from etl.db import batch_upsert_jurisdictions

    conn = _ExistingJurisdictionConnection()
    raw_key = ("02", "27", "248", None, 990002)
    padded_key = ("02", "027", "00248", None, 990002)

    resolved = batch_upsert_jurisdictions(
        conn,
        [raw_key, padded_key],
        names=[
            JurisdictionNames(distrito="Buenos Aires"),
            JurisdictionNames(seccion="Coronel de Marina L. Rosales", circuito="00248"),
        ],
    )

    assert resolved[raw_key] == resolved[padded_key] == "jurisdiction-id"
    assert conn.cursor_instance.state == [
        "Buenos Aires",
        "Coronel de Marina L. Rosales",
        "00248",
        None,
    ]

    from etl.db import JurisdictionNameConflictError

    private_sentinel = "PRIVATE_PERSON_SENTINEL"
    with pytest.raises(JurisdictionNameConflictError) as excinfo:
        batch_upsert_jurisdictions(
            conn,
            [raw_key, padded_key],
            names=[
                JurisdictionNames(seccion="Coronel de Marina L. Rosales"),
                JurisdictionNames(seccion=private_sentinel),
            ],
        )
    assert private_sentinel not in str(excinfo.value)


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
