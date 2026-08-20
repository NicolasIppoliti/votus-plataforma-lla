"""Isolated integration coverage for the data-changing migration history."""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

REPO_ROOT = Path(__file__).parent.parent.parent
MIGRATIONS = REPO_ROOT / "supabase" / "migrations"
SUPPORTED_MIGRATION_NUMBERS = frozenset(range(1, 33))


def _validated_migration_path(number: int, *, down: bool = False) -> Path:
    if type(number) is not int or number not in SUPPORTED_MIGRATION_NUMBERS:
        raise ValueError("migration number must be an integer from 1 through 32")

    directory = MIGRATIONS / "down" if down else MIGRATIONS
    resolved_directory = directory.resolve(strict=True)
    if resolved_directory != directory.absolute() or directory.is_symlink():
        raise RuntimeError(f"migration directory must not contain symlinks: {directory}")

    prefix = f"{number:04d}_"
    suffix = ".down.sql" if down else ".sql"
    matches = tuple(directory.glob(f"{prefix}*{suffix}"))
    if len(matches) != 1:
        raise RuntimeError(
            f"expected exactly one migration file for {number:04d}, found {len(matches)}"
        )

    migration = matches[0]
    if (
        migration.is_symlink()
        or not migration.is_file()
        or not migration.name.startswith(prefix)
        or not migration.name.endswith(suffix)
        or migration.resolve(strict=True).parent != resolved_directory
    ):
        raise RuntimeError(f"invalid migration path for {number:04d}: {migration}")
    return migration


def _apply_migration(database_dsn: str, number: int) -> None:
    migration = _validated_migration_path(number)
    migration_sql = migration.read_bytes()
    with psycopg.connect(database_dsn) as connection:
        connection.execute(migration_sql)


def _apply_down_migration(database_dsn: str, number: int) -> None:
    migration = _validated_migration_path(number, down=True)
    migration_sql = migration.read_bytes()
    with psycopg.connect(database_dsn) as connection:
        connection.execute(migration_sql)


def _available_migration_numbers(*, maximum: int | None = None) -> list[int]:
    return sorted(
        int(migration.name.split("_", 1)[0])
        for migration in MIGRATIONS.glob("[0-9][0-9][0-9][0-9]_*.sql")
        if maximum is None or int(migration.name.split("_", 1)[0]) <= maximum
    )


def test_migration_inventory_accepts_exact_history_through_0032() -> None:
    assert SUPPORTED_MIGRATION_NUMBERS == frozenset(range(1, 33))
    assert _available_migration_numbers() == list(range(1, 33))
    assert (
        _validated_migration_path(32).name == "0032_preaggregate_results_exploration_district.sql"
    )
    assert (
        _validated_migration_path(32, down=True).name
        == "0032_preaggregate_results_exploration_district.down.sql"
    )
    with pytest.raises(ValueError, match="1 through 32"):
        _validated_migration_path(33)


def _insert_review_item(database_dsn: str, kind: str, subject_ref: str) -> None:
    with psycopg.connect(database_dsn) as connection:
        connection.execute(
            "insert into review_item (kind, severity, subject_ref) values (%s, 'warning', %s)",
            (kind, subject_ref),
        )


def _seed_pre_0012_history(
    database_dsn: str,
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    pba_jurisdiction_id = uuid.UUID("00000000-0000-0000-0000-000000000010")
    circuito_248_id = uuid.UUID("00000000-0000-0000-0000-000000000020")
    circuito_00248_id = uuid.UUID("00000000-0000-0000-0000-000000000030")
    circuito_249a_id = uuid.UUID("00000000-0000-0000-0000-000000000031")
    circuito_0249a_id = uuid.UUID("00000000-0000-0000-0000-000000000032")

    election_id = uuid.UUID("00000000-0000-0000-0000-000000000040")
    category_id = uuid.UUID("00000000-0000-0000-0000-000000000050")

    with psycopg.connect(database_dsn) as connection:
        connection.execute(
            """
            insert into jurisdiction_crosswalk (
              pba_distrito_code, national_distrito_code, national_seccion_code, name
            ) values ('027', '02', '027', 'Coronel Rosales')
            """
        )
        connection.execute(
            "insert into jurisdiction (id, distrito_code) values (%s, '027')",
            (pba_jurisdiction_id,),
        )
        connection.execute(
            """
            insert into jurisdiction (
              id, distrito_code, seccion_code, circuito_code, circuito_name
            ) values
              (%s, E'\t2\t', E'\t27\t', E'\t248\t', 'conflicting alias A'),
              (%s, '02', '027', '00248', 'conflicting alias B'),
              (%s, E'\t02\t', E'\t027\t', E'\t249a\t',
               'Circuit 249A'),
              (%s, '02', '027', '0249A', 'Circuit 249A'),
              (gen_random_uuid(), '02', '027', '123456', 'over-width numeric'),
              (gen_random_uuid(), '02', '027', '12345a', 'over-width suffix'),
              (gen_random_uuid(), '02', '027', 'circuito-X', 'unrecognized text')
            """,
            (
                circuito_248_id,
                circuito_00248_id,
                circuito_249a_id,
                circuito_0249a_id,
            ),
        )
        connection.execute(
            "insert into election (id, year, round) values (%s, 2025, 'legislativas')",
            (election_id,),
        )
        connection.execute(
            "insert into category (id, name) values (%s, 'DIPUTADOS NACIONALES')",
            (category_id,),
        )
        connection.execute(
            """
            insert into result_row (
              election_id, jurisdiction_id, category_id, granularity, list_id,
              votes, source_kind, archive_entry_id, source_row_index
            ) values (
              %s, %s, %s, 'distrito', '101', 123, 'official',
              'pba/2025-distrito-027', 1
            )
            """,
            (election_id, pba_jurisdiction_id, category_id),
        )

    return (
        pba_jurisdiction_id,
        circuito_00248_id,
        circuito_0249a_id,
    )


def _seed_pre_0017_control_tuples(database_dsn: str) -> tuple[uuid.UUID, uuid.UUID]:
    control_delimiter_id = uuid.UUID("00000000-0000-0000-0000-000000000033")
    control_sentinel_id = uuid.UUID("00000000-0000-0000-0000-000000000034")

    with psycopg.connect(database_dsn) as connection:
        connection.execute(
            """
            insert into jurisdiction (
              id, distrito_code, seccion_code, circuito_code, circuito_name
            ) values
              (%s, 'raw' || chr(31) || 'raw2', 'tail', chr(1),
               'old delimiter collision'),
              (%s, 'raw', 'raw2' || chr(31) || 'tail', chr(1),
               'old sentinel collision')
            """,
            (control_delimiter_id, control_sentinel_id),
        )

    return control_delimiter_id, control_sentinel_id


def _seed_pre_0017_mesa_level_merge_group(database_dsn: str) -> tuple[uuid.UUID, uuid.UUID]:
    """Two mesa-level aliases whose survivor is NOT the already-canonical row.

    The unique constraint on `jurisdiction` treats NULLs as distinct, so a
    merge group only collides when `establecimiento_code` AND `mesa_code` are
    both present -- which is every mesa-level jurisdiction, the bulk of the
    projection, and exactly what the other fixtures leave NULL.

    0017 picks the survivor with `min(id::text)`, which is arbitrary and not
    "the row that is already canonical". Here the padded alias sorts lower, so
    it survives while the already-canonical row is the one scheduled for
    removal.
    """
    surviving_alias_id = uuid.UUID("00000000-0000-0000-0000-000000000035")
    already_canonical_id = uuid.UUID("00000000-0000-0000-0000-000000000036")

    with psycopg.connect(database_dsn) as connection:
        connection.execute(
            """
            insert into jurisdiction (
              id, distrito_code, seccion_code, circuito_code,
              establecimiento_code, mesa_code, circuito_name
            ) values
              (%s, E'\t2\t', E'\t27\t', E'\t248\t', 'E1', 4243, 'Circuit 248'),
              (%s, '02', '027', '00248', 'E1', 4243, 'Circuit 248')
            """,
            (surviving_alias_id, already_canonical_id),
        )

    return surviving_alias_id, already_canonical_id


def _seed_pre_0018_fiscalizacion_case(
    database_dsn: str,
) -> tuple[uuid.UUID, uuid.UUID, int]:
    official_jurisdiction_id = uuid.UUID("00000000-0000-0000-0000-000000000060")
    fiscalizacion_jurisdiction_id = uuid.UUID("00000000-0000-0000-0000-000000000070")

    with psycopg.connect(database_dsn) as connection:
        election_id = connection.execute(
            "select id from election where year = 2025 and round = 'legislativas'"
        ).fetchone()
        category_id = connection.execute(
            "select id from category where name = 'DIPUTADOS NACIONALES'"
        ).fetchone()
        assert election_id is not None
        assert category_id is not None

        connection.execute(
            """
            insert into jurisdiction (
              id, distrito_code, seccion_code, circuito_code, mesa_code
            ) values
              (%s, '02', '027', '00248', 4242),
              (%s, '02', '027', null, 4242)
            """,
            (official_jurisdiction_id, fiscalizacion_jurisdiction_id),
        )
        connection.execute(
            """
            insert into result_row (
              election_id, jurisdiction_id, category_id, granularity, list_id,
              votes, source_kind, archive_entry_id, source_row_index
            ) values
              (%s, %s, %s, 'mesa', '110', 120, 'official',
               'national/2025-migration-fixture', 1),
              (%s, %s, %s, 'mesa', '110', 119, 'fiscalizacion',
               'fiscalizacion/2025-migration-fixture', 1)
            """,
            (
                election_id[0],
                official_jurisdiction_id,
                category_id[0],
                election_id[0],
                fiscalizacion_jurisdiction_id,
                category_id[0],
            ),
        )
        connection.execute(
            """
            insert into review_item (kind, severity, subject_ref, note)
            values (
              'unreadable_vote_cell', 'warning', 'migration fixture',
              'proves 0018 preserves kinds introduced by earlier migrations'
            )
            """
        )
        before_count = connection.execute("select count(*) from result_row").fetchone()
        assert before_count is not None

    return official_jurisdiction_id, fiscalizacion_jurisdiction_id, before_count[0]


PUBLIC_SCOPE_FIXTURE_PREFIX = "votus_official_0029_"


def _reap_orphaned_public_scope_fixtures(database_dsn: str) -> None:
    """Remove public scope fixtures a killed run could not clean up in its finally block."""
    orphan_pattern = f"{PUBLIC_SCOPE_FIXTURE_PREFIX}%"
    with psycopg.connect(database_dsn) as connection:
        connection.execute("delete from public.category where name like %s", (orphan_pattern,))
        connection.execute("delete from public.election where round like %s", (orphan_pattern,))


def test_0029_through_0032_forward_down_reapply_preserve_function_history_and_indexes() -> None:
    """Cover migration-history mechanics only.

    This schema isolates DDL, never data: the exploration functions pin
    search_path=public,pg_temp and result_row's jurisdiction foreign key binds to
    public.jurisdiction even though 0002 writes it unqualified. Seeding facts here would
    contaminate public, so payload volume belongs to the scale proof, which measures real
    index selection over production-shaped data.
    """
    database_dsn = os.environ.get("ETL_TEST_DATABASE_URL")
    if not database_dsn:
        pytest.skip("ETL_TEST_DATABASE_URL is required for isolated migration-history coverage")

    schema_name = f"{PUBLIC_SCOPE_FIXTURE_PREFIX}{uuid.uuid4().hex}"
    schema_created = False
    public_scope_created = False
    empty_ids: tuple[uuid.UUID, uuid.UUID] | None = None
    try:
        _reap_orphaned_public_scope_fixtures(database_dsn)
        with psycopg.connect(database_dsn) as connection:
            connection.execute(sql.SQL("create schema {}").format(sql.Identifier(schema_name)))
        schema_created = True
        params = conninfo_to_dict(database_dsn)
        params["options"] = f"-csearch_path={schema_name}"
        history_dsn = make_conninfo(**{key: str(value) for key, value in params.items()})
        assert _available_migration_numbers(maximum=32) == list(range(1, 33))
        for number in (*range(1, 9), *range(11, 21)):
            _apply_migration(history_dsn, number)
        with psycopg.connect(history_dsn) as connection:
            assert connection.execute(
                "select to_regrole('results_exploration_executor')"
            ).fetchone() != (None,)
            # 0029/0030 hand ownership to results_exploration_executor and only grant it
            # CREATE on public; the isolated history schema must grant the same privilege
            # so the ownership transfer resolves against this schema instead of public.
            connection.execute(
                sql.SQL("grant usage, create on schema {} to results_exploration_executor").format(
                    sql.Identifier(schema_name)
                )
            )
            connection.execute(
                sql.SQL(
                    "alter function results_exploration_official"
                    "(uuid,uuid,text,text,text,text,integer,text) "
                    "rename to results_exploration_official_0020"
                )
            )
            connection.execute(
                "create function results_exploration_official("
                "p_election_id uuid, p_category_id uuid, p_distrito_code text,"
                "p_seccion_code text default null, p_circuito_code text default null,"
                "p_establecimiento_code text default null, p_mesa_code integer default null,"
                "p_requested_level text default 'seccion') returns jsonb "
                "language sql stable security definer set search_path=public,pg_temp as "
                "$$ select results_exploration_official_0020($1,$2,$3,$4,$5,$6,$7,$8) "
                "|| jsonb_build_object('source_exclusions','[]'::jsonb) $$"
            )
            baseline = connection.execute(
                "select results_exploration_official(%s,%s,'02','027')",
                (uuid.uuid4(), uuid.uuid4()),
            ).fetchone()
        _apply_migration(history_dsn, 29)
        with psycopg.connect(history_dsn) as connection:
            optimized = connection.execute(
                "select results_exploration_official(%s,%s,'02','027')",
                (uuid.uuid4(), uuid.uuid4()),
            ).fetchone()
            assert connection.execute(
                "select to_regprocedure('results_exploration_official_0020"
                "(uuid,uuid,text,text,text,text,integer,text)')"
            ).fetchone() != (None,)
        assert optimized == baseline
        _apply_down_migration(history_dsn, 29)
        with psycopg.connect(history_dsn) as connection:
            assert connection.execute(
                "select to_regprocedure('results_exploration_official_0029"
                "(uuid,uuid,text,text,text,text,integer,text)')"
            ).fetchone() == (None,)
        _apply_migration(history_dsn, 29)
        empty_ids = uuid.uuid4(), uuid.uuid4()
        # Every exploration function pins search_path=public,pg_temp, so the scope this
        # history schema exercises must exist in public even though the function bodies,
        # tables, and indexes under test live in the isolated schema. Both natural keys
        # carry the run-unique schema name so a killed run cannot collide with the next.
        with psycopg.connect(history_dsn) as connection:
            connection.execute(
                "with e as (insert into public.election(id,year,round) values (%s,2025,%s)) "
                "insert into public.category(id,name) values (%s,%s)",
                (empty_ids[0], schema_name, empty_ids[1], schema_name),
            )
            public_scope_created = True
            before_0030 = connection.execute(
                "select results_exploration_official(%s,%s,'02',p_requested_level=>'distrito')",
                empty_ids,
            ).fetchone()
        _apply_migration(history_dsn, 30)
        with psycopg.connect(history_dsn) as connection:
            after_0030 = connection.execute(
                "select results_exploration_official(%s,%s,'02',p_requested_level=>'distrito')",
                empty_ids,
            ).fetchone()
            installed = connection.execute(
                "select to_regprocedure('results_exploration_official_0030"
                "(uuid,uuid,text,text,text,text,integer,text)') is not null,"
                "to_regclass('result_row_official_district_geography_idx') is not null,"
                "has_function_privilege('authenticated','results_exploration_official_0030"
                "(uuid,uuid,text,text,text,text,integer,text)','execute')"
            ).fetchone()
        assert after_0030 == before_0030 and installed == (True, True, False)
        _apply_down_migration(history_dsn, 30)
        with psycopg.connect(history_dsn) as connection:
            removed = connection.execute(
                "select to_regprocedure('results_exploration_official_0030"
                "(uuid,uuid,text,text,text,text,integer,text)') is null,"
                "to_regclass('result_row_official_district_geography_idx') is null"
            ).fetchone()
        assert removed == (True, True)
        _apply_migration(history_dsn, 30)
        with psycopg.connect(history_dsn) as connection:
            before_0031 = connection.execute(
                "select results_exploration_official(%s,%s,'02',p_requested_level=>'distrito')",
                empty_ids,
            ).fetchone()
            function_before_0031 = connection.execute(
                "select pg_get_functiondef('results_exploration_official_0030"
                "(uuid,uuid,text,text,text,text,integer,text)'::regprocedure)"
            ).fetchone()
            rows_before_0031 = connection.execute("select count(*) from result_row").fetchone()
        _apply_migration(history_dsn, 31)
        with psycopg.connect(history_dsn) as connection:
            after_0031 = connection.execute(
                "select results_exploration_official(%s,%s,'02',p_requested_level=>'distrito')",
                empty_ids,
            ).fetchone()
            function_after_0031 = connection.execute(
                "select pg_get_functiondef('results_exploration_official_0030"
                "(uuid,uuid,text,text,text,text,integer,text)'::regprocedure)"
            ).fetchone()
            installed_0031 = connection.execute(
                "select to_regclass(%s) is null,to_regclass(%s) is not null,"
                "lower(pg_get_indexdef(%s::regclass)),"
                "(select indisvalid and indisready from pg_index where indexrelid=%s::regclass),"
                "count(*) from result_row",
                (
                    "result_row_official_district_geography_idx",
                    "result_row_official_district_scope_idx",
                    "result_row_official_district_scope_idx",
                    "result_row_official_district_scope_idx",
                ),
            ).fetchone()
        assert after_0031 == before_0031
        assert function_after_0031 == function_before_0031
        assert installed_0031 is not None and rows_before_0031 is not None
        assert installed_0031[:2] == (True, True)
        assert "(election_id, category_id, jurisdiction_id)" in installed_0031[2]
        assert "include (archive_entry_id, granularity, list_id, votes)" in installed_0031[2]
        assert installed_0031[3] is True
        assert installed_0031[4] == rows_before_0031[0]
        _apply_down_migration(history_dsn, 31)
        with psycopg.connect(history_dsn) as connection:
            restored_0030_index = connection.execute(
                "select to_regclass(%s) is null,to_regclass(%s) is not null,"
                "lower(pg_get_indexdef(%s::regclass)),"
                "(select indisvalid and indisready from pg_index where indexrelid=%s::regclass),"
                "count(*) from result_row",
                (
                    "result_row_official_district_scope_idx",
                    "result_row_official_district_geography_idx",
                    "result_row_official_district_geography_idx",
                    "result_row_official_district_geography_idx",
                ),
            ).fetchone()
        assert restored_0030_index is not None
        assert restored_0030_index[:2] == (True, True)
        assert restored_0030_index[3] is True
        assert "(jurisdiction_id, election_id, category_id)" in restored_0030_index[2]
        assert restored_0030_index[4] == rows_before_0031[0]
        _apply_migration(history_dsn, 31)
        with psycopg.connect(history_dsn) as connection:
            before_0032 = connection.execute(
                "select results_exploration_official(%s,%s,'02',p_requested_level=>'distrito')",
                empty_ids,
            ).fetchone()
            wrapper_before_0032 = connection.execute(
                "select pg_get_functiondef('results_exploration_official"
                "(uuid,uuid,text,text,text,text,integer,text)'::regprocedure)"
            ).fetchone()
        _apply_migration(history_dsn, 32)
        with psycopg.connect(history_dsn) as connection:
            after_0032 = connection.execute(
                "select results_exploration_official(%s,%s,'02',p_requested_level=>'distrito')",
                empty_ids,
            ).fetchone()
            installed_0032 = connection.execute(
                "select to_regprocedure('results_exploration_official_0032"
                "(uuid,uuid,text,text,text,text,integer,text)') is not null,"
                "to_regprocedure('results_exploration_official_wrapper_0031"
                "(uuid,uuid,text,text,text,text,integer,text)') is not null,"
                "has_function_privilege('authenticated','results_exploration_official_0032"
                "(uuid,uuid,text,text,text,text,integer,text)','execute')"
            ).fetchone()
        assert after_0032 == before_0032
        assert installed_0032 == (True, True, False)
        _apply_down_migration(history_dsn, 32)
        with psycopg.connect(history_dsn) as connection:
            restored_0031 = connection.execute(
                "select pg_get_functiondef('results_exploration_official"
                "(uuid,uuid,text,text,text,text,integer,text)'::regprocedure),"
                "to_regprocedure('results_exploration_official_0032"
                "(uuid,uuid,text,text,text,text,integer,text)') is null,"
                "to_regprocedure('results_exploration_official_wrapper_0031"
                "(uuid,uuid,text,text,text,text,integer,text)') is null"
            ).fetchone()
        assert restored_0031 is not None
        assert restored_0031 == (wrapper_before_0032[0], True, True)
        _apply_migration(history_dsn, 32)
    finally:
        if public_scope_created and empty_ids is not None:
            with psycopg.connect(database_dsn) as connection:
                connection.execute("delete from public.category where id = %s", (empty_ids[1],))
                connection.execute("delete from public.election where id = %s", (empty_ids[0],))
        if schema_created:
            with psycopg.connect(database_dsn) as connection:
                drop_schema = sql.SQL("drop schema {} cascade").format(sql.Identifier(schema_name))
                connection.execute(drop_schema)


def test_0025_facets_forward_down_and_reapply_restore_0020_behavior() -> None:
    forward = MIGRATIONS / "0025_optimize_results_exploration_facets.sql"
    down = MIGRATIONS / "down" / "0025_optimize_results_exploration_facets.down.sql"
    assert forward.exists(), "0025 facets optimization migration is required"
    assert down.exists(), "0025 facets optimization down migration is required"

    database_dsn = os.environ.get("ETL_TEST_DATABASE_URL")
    if not database_dsn:
        pytest.skip("ETL_TEST_DATABASE_URL is required for isolated migration-history coverage")

    schema_name = f"votus_facets_0025_{uuid.uuid4().hex}"
    schema_created = False
    try:
        with psycopg.connect(database_dsn) as connection:
            connection.execute(sql.SQL("create schema {}").format(sql.Identifier(schema_name)))
        schema_created = True

        params = conninfo_to_dict(database_dsn)
        params["options"] = f"-csearch_path={schema_name}"
        history_dsn = make_conninfo(**{key: str(value) for key, value in params.items()})
        signature = "results_exploration_facets(uuid,uuid,text,text,text)"
        assert _available_migration_numbers(maximum=25) == list(range(1, 26))
        # 0009/0010 establish cluster-global roles prepared by the integration harness.
        for number in (*range(1, 9), *range(11, 21)):
            _apply_migration(history_dsn, number)

        with psycopg.connect(history_dsn) as connection:
            baseline = connection.execute(
                "select pg_get_functiondef(%s::regprocedure)", (signature,)
            ).fetchone()
        assert baseline is not None

        _apply_migration(history_dsn, 25)
        with psycopg.connect(history_dsn) as connection:
            optimized = connection.execute(
                "select pg_get_functiondef(%s::regprocedure)", (signature,)
            ).fetchone()
        assert optimized is not None and optimized != baseline

        _apply_down_migration(history_dsn, 25)
        with psycopg.connect(history_dsn) as connection:
            restored = connection.execute(
                "select pg_get_functiondef(%s::regprocedure)", (signature,)
            ).fetchone()
        assert restored == baseline

        _apply_migration(history_dsn, 25)
        with psycopg.connect(history_dsn) as connection:
            reapplied = connection.execute(
                "select pg_get_functiondef(%s::regprocedure)", (signature,)
            ).fetchone()
        assert reapplied == optimized
    finally:
        if schema_created:
            with psycopg.connect(database_dsn) as connection:
                connection.execute(
                    sql.SQL("drop schema {} cascade").format(sql.Identifier(schema_name))
                )


def test_0026_facets_forward_down_and_reapply_preserve_0025_and_exact_signatures() -> None:
    database_dsn = os.environ.get("ETL_TEST_DATABASE_URL")
    if not database_dsn:
        pytest.skip("ETL_TEST_DATABASE_URL is required for isolated migration-history coverage")

    schema_name = f"votus_facets_0026_{uuid.uuid4().hex}"
    schema_created = False
    try:
        with psycopg.connect(database_dsn) as connection:
            connection.execute(sql.SQL("create schema {}").format(sql.Identifier(schema_name)))
        schema_created = True
        params = conninfo_to_dict(database_dsn)
        params["options"] = f"-csearch_path={schema_name}"
        history_dsn = make_conninfo(**{key: str(value) for key, value in params.items()})
        five_args = "results_exploration_facets(uuid,uuid,text,text,text)"
        six_args = "results_exploration_facets(uuid,uuid,text,text,text,text)"
        assert _available_migration_numbers(maximum=26) == list(range(1, 27))
        for number in (*range(1, 9), *range(11, 21), 24, 25):
            _apply_migration(history_dsn, number)

        with psycopg.connect(history_dsn) as connection:
            optimized_five = connection.execute(
                "select pg_get_functiondef(%s::regprocedure)", (five_args,)
            ).fetchone()
        assert optimized_five is not None

        _apply_migration(history_dsn, 26)
        with psycopg.connect(history_dsn) as connection:
            assert connection.execute("select to_regprocedure(%s)", (five_args,)).fetchone() == (
                None,
            )
            six_definition = connection.execute(
                "select pg_get_functiondef(%s::regprocedure)", (six_args,)
            ).fetchone()
        assert six_definition is not None
        assert "p_establecimiento_code text DEFAULT NULL::text" in six_definition[0]

        _apply_down_migration(history_dsn, 26)
        with psycopg.connect(history_dsn) as connection:
            restored_five = connection.execute(
                "select pg_get_functiondef(%s::regprocedure)", (five_args,)
            ).fetchone()
            assert connection.execute("select to_regprocedure(%s)", (six_args,)).fetchone() == (
                None,
            )
        assert restored_five == optimized_five

        _apply_migration(history_dsn, 26)
        with psycopg.connect(history_dsn) as connection:
            reapplied_six = connection.execute(
                "select pg_get_functiondef(%s::regprocedure)", (six_args,)
            ).fetchone()
            review_constraint = connection.execute(
                "select pg_get_constraintdef(oid) from pg_constraint "
                "where conname = 'review_item_kind_check'"
            ).fetchone()
        assert reapplied_six == six_definition
        assert review_constraint is not None
        assert "ambiguous_official_mesa_identity" in review_constraint[0]
    finally:
        if schema_created:
            with psycopg.connect(database_dsn) as connection:
                connection.execute(
                    sql.SQL("drop schema {} cascade").format(sql.Identifier(schema_name))
                )


def test_0024_review_kinds_reject_then_accept_and_rollback_reapply_safely() -> None:
    database_dsn = os.environ.get("ETL_TEST_DATABASE_URL")
    if not database_dsn:
        pytest.skip("ETL_TEST_DATABASE_URL is required for isolated migration-history coverage")

    added_kinds = (
        "ambiguous_official_mesa_identity",
        "pba_conflicting_duplicate_semantic_result",
        "pba_exact_duplicate_semantic_result",
        "pba_unreadable_vote_cell",
    )
    unknown_kind = "unknown_review_kind"
    schema_name = f"votus_review_kinds_{uuid.uuid4().hex}"
    with psycopg.connect(database_dsn) as connection:
        connection.execute(sql.SQL("create schema {}").format(sql.Identifier(schema_name)))
    params = conninfo_to_dict(database_dsn)
    params["options"] = f"-csearch_path={schema_name}"
    history_dsn = make_conninfo(**{key: str(value) for key, value in params.items()})
    try:
        available_numbers = _available_migration_numbers(maximum=24)
        assert available_numbers == list(range(1, 25))

        # 0009/0010 create cluster-global etl_writer roles, and 0022 creates the
        # cluster-global results_exploration_executor role. The disposable harness
        # prepares 0009/0010 separately, while its schema-local role is intentionally
        # NOCREATEROLE. Migrations 0019-0023 do not change review_item_kind_check, so
        # this constraint test needs only the safe schema-local history through 0018.
        for number in (*range(1, 9), *range(11, 19)):
            _apply_migration(history_dsn, number)

        for kind in added_kinds:
            with pytest.raises(psycopg.errors.CheckViolation):
                _insert_review_item(history_dsn, kind, f"before-0024:{kind}")
        with pytest.raises(psycopg.errors.CheckViolation):
            _insert_review_item(history_dsn, unknown_kind, "before-0024:unknown")

        _apply_migration(history_dsn, 24)
        for kind in added_kinds:
            _insert_review_item(history_dsn, kind, f"0024-only:{kind}")
        with pytest.raises(psycopg.errors.CheckViolation):
            _insert_review_item(history_dsn, unknown_kind, "after-0024:unknown")

        with pytest.raises(psycopg.errors.RaiseException, match="0024-only review_item"):
            _apply_down_migration(history_dsn, 24)

        with psycopg.connect(history_dsn) as connection:
            connection.execute("delete from review_item where subject_ref like '0024-only:%'")
        _apply_down_migration(history_dsn, 24)
        for kind in added_kinds:
            with pytest.raises(psycopg.errors.CheckViolation):
                _insert_review_item(history_dsn, kind, f"after-down:{kind}")

        _apply_migration(history_dsn, 24)
        for kind in added_kinds:
            _insert_review_item(history_dsn, kind, f"after-reapply:{kind}")
        with pytest.raises(psycopg.errors.CheckViolation):
            _insert_review_item(history_dsn, unknown_kind, "after-reapply:unknown")
    finally:
        with psycopg.connect(database_dsn) as connection:
            connection.execute(
                sql.SQL("drop schema {} cascade").format(sql.Identifier(schema_name))
            )


def test_real_migration_history_repairs_pba_and_merges_circuito_aliases() -> None:
    database_dsn = os.environ.get("ETL_TEST_DATABASE_URL")
    if not database_dsn:
        pytest.skip("ETL_TEST_DATABASE_URL is required for isolated migration-history coverage")

    schema_name = f"votus_migration_history_{uuid.uuid4().hex}"
    with psycopg.connect(database_dsn) as connection:
        connection.execute(sql.SQL("create schema {}").format(sql.Identifier(schema_name)))
    params = conninfo_to_dict(database_dsn)
    params["options"] = f"-csearch_path={schema_name}"
    history_dsn = make_conninfo(**{key: str(value) for key, value in params.items()})
    try:
        available_numbers = _available_migration_numbers(maximum=19)
        assert available_numbers == list(range(1, 20))

        # 0009/0010 only establish cluster-global etl_writer state. The harness
        # applies and verifies those before this unprivileged child starts.
        for number in (*range(1, 9), 11):
            _apply_migration(history_dsn, number)

        (
            old_pba_jurisdiction_id,
            obsolete_circuito_alias_id,
            obsolete_suffix_alias_id,
        ) = _seed_pre_0012_history(history_dsn)

        _apply_migration(history_dsn, 12)
        with psycopg.connect(history_dsn) as connection:
            old_0012_pair = connection.execute(
                """
                select j.distrito_code, j.seccion_code
                from result_row rr
                join jurisdiction j on j.id = rr.jurisdiction_id
                where rr.archive_entry_id = 'pba/2025-distrito-027'
                """
            ).fetchone()
        assert old_0012_pair == ("02", None)

        _apply_migration(history_dsn, 13)
        with psycopg.connect(history_dsn) as connection:
            result_count_after_0013 = connection.execute(
                "select count(*) from result_row"
            ).fetchone()
            pba_count_after_0013 = connection.execute(
                """
                select count(*)
                from result_row
                where archive_entry_id = 'pba/2025-distrito-027'
                """
            ).fetchone()
        assert result_count_after_0013 == (1,)
        assert pba_count_after_0013 == (1,)

        _apply_migration(history_dsn, 14)
        _apply_migration(history_dsn, 15)
        _apply_migration(history_dsn, 16)

        control_delimiter_id, control_sentinel_id = _seed_pre_0017_control_tuples(history_dsn)
        (
            surviving_mesa_alias_id,
            already_canonical_mesa_id,
        ) = _seed_pre_0017_mesa_level_merge_group(history_dsn)

        with pytest.raises(psycopg.Error, match="metadata conflict"):
            _apply_migration(history_dsn, 17)
        with psycopg.connect(history_dsn) as connection:
            conflicted_aliases = connection.execute(
                "select circuito_name from jurisdiction where id in (%s, %s) order by id",
                (
                    uuid.UUID("00000000-0000-0000-0000-000000000020"),
                    obsolete_circuito_alias_id,
                ),
            ).fetchall()
            assert conflicted_aliases == [
                ("conflicting alias A",),
                ("conflicting alias B",),
            ]
            connection.execute(
                "update jurisdiction set circuito_name = case when id = %s then null "
                "else 'Circuit 248' end where id in (%s, %s)",
                (
                    uuid.UUID("00000000-0000-0000-0000-000000000020"),
                    uuid.UUID("00000000-0000-0000-0000-000000000020"),
                    obsolete_circuito_alias_id,
                ),
            )
        _apply_migration(history_dsn, 17)

        (
            official_jurisdiction_id,
            fiscalizacion_jurisdiction_id,
            result_count_before_0018,
        ) = _seed_pre_0018_fiscalizacion_case(history_dsn)
        _apply_migration(history_dsn, 18)
        _apply_migration(history_dsn, 19)

        with psycopg.connect(history_dsn) as connection:
            repaired_pair = connection.execute(
                """
                select j.distrito_code, j.seccion_code
                from result_row rr
                join jurisdiction j on j.id = rr.jurisdiction_id
                where rr.archive_entry_id = 'pba/2025-distrito-027'
                """
            ).fetchone()
            alias_rows = connection.execute(
                """
                select id, circuito_code, circuito_name
                from jurisdiction
                where distrito_code = '02'
                  and seccion_code = '027'
                  and circuito_code = '00248'
                  and establecimiento_code is null
                  and mesa_code is null
                """
            ).fetchall()
            suffix_alias_rows = connection.execute(
                """
                select id, circuito_code
                from jurisdiction
                where distrito_code = '02'
                  and seccion_code = '027'
                  and circuito_code = '0249A'
                  and establecimiento_code is null
                  and mesa_code is null
                """
            ).fetchall()
            preserved_circuitos = connection.execute(
                """
                select circuito_code
                from jurisdiction
                where distrito_code = '02'
                  and seccion_code = '027'
                  and circuito_code in ('123456', '12345A', 'circuito-X')
                order by circuito_code
                """
            ).fetchall()
            control_character_rows = connection.execute(
                """
                select id, distrito_code, seccion_code, circuito_code
                from jurisdiction
                where id in (%s, %s)
                order by id
                """,
                (control_delimiter_id, control_sentinel_id),
            ).fetchall()
            result_count = connection.execute("select count(*) from result_row").fetchone()
            fiscalizacion_destination = connection.execute(
                """
                select jurisdiction_id
                from result_row
                where archive_entry_id = 'fiscalizacion/2025-migration-fixture'
                """
            ).fetchone()
            removed_fiscalizacion_jurisdiction = connection.execute(
                "select count(*) from jurisdiction where id = %s",
                (fiscalizacion_jurisdiction_id,),
            ).fetchone()
            preserved_review_kind = connection.execute(
                "select kind from review_item where subject_ref = 'migration fixture'"
            ).fetchone()
            obsolete_rows = connection.execute(
                "select count(*) from jurisdiction where id in (%s, %s, %s)",
                (
                    old_pba_jurisdiction_id,
                    obsolete_circuito_alias_id,
                    obsolete_suffix_alias_id,
                ),
            ).fetchone()
            constraint_columns = connection.execute(
                """
                select array_agg(attribute.attname order by key.ordinality)
                from pg_constraint constraint_row
                cross join lateral unnest(constraint_row.conkey)
                  with ordinality as key(attnum, ordinality)
                join pg_attribute attribute
                  on attribute.attrelid = constraint_row.conrelid
                 and attribute.attnum = key.attnum
                where constraint_row.conrelid = 'mesa_crosswalk'::regclass
                  and constraint_row.conname = 'mesa_crosswalk_identity_key'
                  and constraint_row.contype = 'u'
                """
            ).fetchone()
            historical_requested_granularity = connection.execute(
                "select distinct requested_granularity from result_row"
            ).fetchall()
            mesa_level_merge_rows = connection.execute(
                """
                select id
                from jurisdiction
                where distrito_code = '02'
                  and seccion_code = '027'
                  and circuito_code = '00248'
                  and establecimiento_code = 'E1'
                  and mesa_code = 4243
                """
            ).fetchall()
            removed_canonical_duplicate = connection.execute(
                "select count(*) from jurisdiction where id = %s",
                (already_canonical_mesa_id,),
            ).fetchone()

        assert repaired_pair == ("02", "027")
        assert len(alias_rows) == 1
        assert alias_rows[0][1:] == ("00248", "Circuit 248")
        assert len(suffix_alias_rows) == 1
        assert suffix_alias_rows[0][1] == "0249A"
        assert preserved_circuitos == [("123456",), ("12345A",), ("circuito-X",)]
        assert control_character_rows == [
            (control_delimiter_id, "raw\x1fraw2", "tail", "\x01"),
            (control_sentinel_id, "raw", "raw2\x1ftail", "\x01"),
        ]
        assert result_count == (result_count_before_0018,)
        assert fiscalizacion_destination == (official_jurisdiction_id,)
        assert removed_fiscalizacion_jurisdiction == (0,)
        assert preserved_review_kind == ("unreadable_vote_cell",)
        assert obsolete_rows == (0,)
        assert constraint_columns == (
            ["distrito_code", "seccion_code", "circuito_code", "mesa_code"],
        )
        assert historical_requested_granularity == [(None,)]
        # The merge collapses the pair onto the arbitrary `min(id::text)`
        # survivor, so the already-canonical duplicate must be gone rather than
        # standing in the survivor's way while it is canonicalized.
        assert mesa_level_merge_rows == [(surviving_mesa_alias_id,)]
        assert removed_canonical_duplicate == (0,)
    finally:
        with psycopg.connect(database_dsn) as connection:
            connection.execute(
                sql.SQL("drop schema {} cascade").format(sql.Identifier(schema_name))
            )
