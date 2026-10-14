"""Writer replay contracts exercised only inside the repository-owned database."""

import json
import uuid
from pathlib import Path
from types import SimpleNamespace

import psycopg
import pytest

from etl.__main__ import load_curated
from etl.admin_codes import normalize_circuito_code

CONFLICT = "record_review_item_v2 active review context set conflicts with explicit contexts"
BASE = dict(
    context_role="observed",
    source_kind="official",
    archive_availability="unknown",
    election_id=None,
    category_id=None,
    archive_entry_id=None,
    unknown_reason="source_archive_not_attributable",
)
CONTEXTS = [BASE | {"election_year": year} for year in (2023, 2025)]
MIGRATIONS = Path(__file__).resolve().parents[2] / "supabase" / "migrations"
VERSION = "20261014000000_upgrade_historical_review_contexts"
CALL = "select workspace_private.record_review_item_v2('mesa_discontinuity','warning',%s,null,array[]::text[],array[]::text[],%s::jsonb)"  # noqa: E501


def seed(connection, subject, reasons, note=None):
    connection.execute("set local role etl_writer")
    connection.execute(
        "select workspace_private.record_review_item('mesa_discontinuity','warning',%s,%s,array[]::text[],array[]::text[])",  # noqa: E501
        (subject, note),
    )
    connection.execute("set local role workspace_review_ingest_owner")
    item_id = connection.execute(
        "select id from public.review_item where subject_ref=%s", (subject,)
    ).fetchone()[0]
    connection.execute(
        "delete from workspace_private.review_item_context where review_item_id=%s", (item_id,)
    )
    for reason in reasons:
        explicit = reason == "source_archive_not_attributable"
        unclassified = reason in ("historical_unclassified", "writer_context_not_provided")
        connection.execute(
            "insert into workspace_private.review_item_context(review_item_id,context_role,source_kind,archive_availability,election_year,unknown_reason) values(%s,%s,%s,'unknown',%s,%s)",  # noqa: E501
            (
                item_id,
                "unknown" if unclassified else "observed",
                "unknown" if unclassified else "official",
                2023 if explicit else None,
                reason,
            ),
        )
    return item_id


def snapshot(connection, item_id):
    connection.execute("set local role workspace_review_ingest_owner")
    return connection.execute(
        "select context_id,context_role,source_kind,archive_availability,election_year,election_id,category_id,archive_entry_id,unknown_reason from workspace_private.review_item_context where review_item_id=%s order by election_year nulls first,unknown_reason",  # noqa: E501
        (item_id,),
    ).fetchall()


@pytest.mark.owned_database
@pytest.mark.parametrize(
    "reasons,upgrade",
    [
        (["historical_archive_not_linked"], True),
        (["historical_unclassified"], True),
        (["historical_archive_not_linked", "historical_unclassified"], True),
        (["source_archive_not_attributable"], False),
        (["historical_archive_not_linked", "source_archive_not_attributable"], False),
        (["writer_context_not_provided"], True),
    ],
)
def test_writer_replaces_only_historical_sets_and_fallback(owned_database, reasons, upgrade):
    with owned_database.owner_connection("workspace_review_ingest_owner") as connection:
        subject = f"historical-upgrade-{uuid.uuid4()}"
        item_id = seed(connection, subject, reasons)
        before = snapshot(connection, item_id)
        connection.execute("set local role etl_writer")
        if upgrade:
            assert connection.execute(CALL, (subject, json.dumps(CONTEXTS))).fetchone() == (False,)
            after = snapshot(connection, item_id)
            assert [row[1:] for row in after] == [
                (
                    "observed",
                    "official",
                    "unknown",
                    year,
                    None,
                    None,
                    None,
                    "source_archive_not_attributable",
                )
                for year in (2023, 2025)
            ]
            connection.execute("set local role etl_writer")
            assert connection.execute(
                CALL, (subject, json.dumps(list(reversed(CONTEXTS))))
            ).fetchone() == (False,)
            assert snapshot(connection, item_id) == after
        else:
            with pytest.raises(psycopg.errors.CheckViolation) as error, connection.transaction():
                connection.execute(CALL, (subject, json.dumps(CONTEXTS)))
            assert error.value.diag.message_primary == CONFLICT
            assert snapshot(connection, item_id) == before
        # Unwind the fixture-owned transaction without explicit rollback().
        raise psycopg.Rollback()


def test_historical_context_down_restores_exact_previous_definition():
    previous = (MIGRATIONS / "20260831150450_allow_year_level_review_contexts.sql").read_text()
    forward = (MIGRATIONS / f"{VERSION}.sql").read_text()
    down = (MIGRATIONS / "down" / f"{VERSION}.down.sql").read_text()

    def definition(source):
        return source[
            source.index("create or replace function ") : source.index(
                "end $$;", source.index("create or replace function ")
            )
            + len("end $$;")
        ]

    assert definition(down) == definition(previous)
    expected = (
        definition(previous)
        .replace("fallback_count integer;", "fallback_count integer; historical_count integer;")
        .replace(
            ") into context_count,fallback_count from workspace_private.review_item_context",
            "),count(*) filter(where unknown_reason in ('historical_archive_not_linked','historical_unclassified')) into context_count,fallback_count,historical_count from workspace_private.review_item_context",  # noqa: E501
        )
        .replace(
            "if context_count=1 and fallback_count=1 then",
            "if (context_count=1 and fallback_count=1) or (context_count>0 and historical_count=context_count) then",  # noqa: E501
        )
    )
    assert definition(forward) == expected
    # Neither migration rewrites rows outside the writer function.
    for source in (forward, down):
        outside = source.replace(definition(source), "")
        assert "delete from workspace_private.review_item_context" not in outside
        assert "update workspace_private.review_item_context" not in outside
        grants = previous[
            previous.index("revoke all on function ") : previous.index("set role postgres;")
        ]
        assert grants in outside


@pytest.mark.owned_database
def test_historical_context_down_and_reapply_preserve_rows_and_function_security(owned_database):
    signature = "workspace_private.record_review_item_v2(text,text,text,text,text[],text[],jsonb)"
    metadata = "select pg_get_functiondef(oid),proowner,proacl,prosecdef,proconfig from pg_proc where oid=%s::regprocedure"  # noqa: E501
    rows = "select coalesce(jsonb_agg(to_jsonb(c) order by context_id),'[]'::jsonb) from workspace_private.review_item_context c"  # noqa: E501
    with owned_database.connect() as connection:
        before = connection.execute(metadata, (signature,)).fetchone()
        contexts = connection.execute(rows).fetchone()
    try:
        with owned_database.connect() as connection:
            connection.execute((MIGRATIONS / "down" / f"{VERSION}.down.sql").read_bytes())
        with owned_database.connect() as connection:
            restored = connection.execute(metadata, (signature,)).fetchone()
            assert "historical_count" not in restored[0]
            assert restored[1:] == before[1:]
            assert connection.execute(rows).fetchone() == contexts
    finally:
        with owned_database.connect() as connection:
            connection.execute((MIGRATIONS / f"{VERSION}.sql").read_bytes())
    with owned_database.connect() as connection:
        assert connection.execute(metadata, (signature,)).fetchone() == before
        assert connection.execute(rows).fetchone() == contexts


@pytest.mark.owned_database
def test_load_curated_upgrades_historical_discontinuity(owned_database, tmp_path, monkeypatch):
    import etl.__main__ as cli

    circuito = normalize_circuito_code("1")
    subject = f"02-027-circuito-{circuito}-mesa-2"
    with owned_database.owner_connection("workspace_review_ingest_owner") as connection:
        note = f"mesa 2 circuito {circuito} in 02/027 is present in 2025 but not 2023; it is NOT stable across years and must not be compared as if it were"  # noqa: E501
        item_id = seed(connection, subject, ["historical_archive_not_linked"], note)

        # load_curated commits its real writer transaction; keep that transaction
        # within the owned connection so all state is visible and disposable.
        class Connection:
            # A transaction is active even though owner_connection uses an
            # autocommit connection to establish its fixture-owned transaction.
            autocommit = False

            def __getattr__(self, name):
                return getattr(connection, name)

            def commit(self):
                pass

            def close(self):
                pass

            def rollback(self):
                # The writer re-raises; the owned outer transaction rolls back.
                pass

        manifest = tmp_path / "manifest.json"
        manifest.write_text("[]\n")
        monkeypatch.setattr(cli, "_require_complete_national_corpus", lambda *a, **kw: None)
        monkeypatch.setattr(cli, "load_party_map", lambda p: object())
        monkeypatch.setattr(
            cli,
            "load_crosswalk",
            lambda p: SimpleNamespace(
                jurisdictions=(
                    SimpleNamespace(national_distrito_code="02", national_seccion_code="027"),
                )
            ),
        )
        monkeypatch.setattr(
            cli,
            "collect_national_mesa_codes",
            lambda *a, year, **kw: {("1", 1)} if year == 2023 else {("1", 1), ("1", 2)},
        )
        monkeypatch.setattr(cli, "load_party_map_rows", lambda *a: None)
        monkeypatch.setattr(cli, "load_crosswalk_rows", lambda *a, **kw: None)
        monkeypatch.setattr(cli.psycopg, "connect", lambda url: Connection())
        connection.execute("set local role etl_writer")
        load_curated(
            database_url=owned_database.dsn,
            sources={},
            local_root=tmp_path,
            manifest_path=manifest,
            party_map_path=tmp_path / "party.yaml",
            crosswalk_path=tmp_path / "crosswalk.yaml",
        )
        assert [row[1:] for row in snapshot(connection, item_id)] == [
            (
                "observed",
                "official",
                "unknown",
                year,
                None,
                None,
                None,
                "source_archive_not_attributable",
            )
            for year in (2023, 2025)
        ]
        raise psycopg.Rollback()
