"""Isolated integration coverage for the data-changing migration history."""

from __future__ import annotations

import json
import os
import re
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

REPO_ROOT = Path(__file__).parent.parent.parent
MIGRATIONS = REPO_ROOT / "supabase" / "migrations"
SUPPORTED_MIGRATION_NUMBERS = frozenset(range(1, 38))
PBA_113_MIGRATION_VERSION = "20260824193650"
WORKSPACE_FOUNDATION_MIGRATION_VERSION = "20260825144358"
WORKSPACE_AUTHORITY_FACTS_MIGRATION_VERSION = "20260825165116"
WORKSPACE_ADMIN_MIGRATION_VERSION = "20260825180048"
WORKSPACE_CONTEXT_MIGRATION_VERSION = "20260826033130"
WORKSPACE_SELECTION_MIGRATION_VERSION = "20260826050000"
STRUCTURED_REVIEW_SCOPE_MIGRATION_VERSION = "20260826120000"
AUTHORIZED_OFFICIAL_FACETS_MIGRATION_VERSION = "20260826160000"
SUPPORTED_TIMESTAMP_MIGRATION_VERSIONS = frozenset(
    {
        PBA_113_MIGRATION_VERSION,
        WORKSPACE_FOUNDATION_MIGRATION_VERSION,
        WORKSPACE_AUTHORITY_FACTS_MIGRATION_VERSION,
        WORKSPACE_ADMIN_MIGRATION_VERSION,
        WORKSPACE_CONTEXT_MIGRATION_VERSION,
        WORKSPACE_SELECTION_MIGRATION_VERSION,
        STRUCTURED_REVIEW_SCOPE_MIGRATION_VERSION,
        AUTHORIZED_OFFICIAL_FACETS_MIGRATION_VERSION,
    }
)
EXPECTED_MIGRATION_VERSIONS = tuple(
    [*(f"{number:04d}" for number in range(1, 38)), *sorted(SUPPORTED_TIMESTAMP_MIGRATION_VERSIONS)]
)
MIGRATION_FILE_PATTERN = re.compile(r"^(\d{4}|\d{14})_[^/]+\.sql$")


def _normalized_migration_version(version: int | str) -> str:
    if type(version) is int and version in SUPPORTED_MIGRATION_NUMBERS:
        return f"{version:04d}"
    if type(version) is str and version in SUPPORTED_TIMESTAMP_MIGRATION_VERSIONS:
        return version
    raise ValueError(
        "migration version must be an integer from 1 through 37 or one of the exact "
        f"timestamps {sorted(SUPPORTED_TIMESTAMP_MIGRATION_VERSIONS)}"
    )


def _validated_migration_path(version: int | str, *, down: bool = False) -> Path:
    normalized_version = _normalized_migration_version(version)
    directory = MIGRATIONS / "down" if down else MIGRATIONS
    resolved_directory = directory.resolve(strict=True)
    if resolved_directory != directory.absolute() or directory.is_symlink():
        raise RuntimeError(f"migration directory must not contain symlinks: {directory}")

    prefix = f"{normalized_version}_"
    suffix = ".down.sql" if down else ".sql"
    matches = tuple(directory.glob(f"{prefix}*{suffix}"))
    if len(matches) != 1:
        raise RuntimeError(
            f"expected exactly one migration file for {normalized_version}, found {len(matches)}"
        )

    migration = matches[0]
    if (
        migration.is_symlink()
        or not migration.is_file()
        or not migration.name.startswith(prefix)
        or not migration.name.endswith(suffix)
        or migration.resolve(strict=True).parent != resolved_directory
    ):
        raise RuntimeError(f"invalid migration path for {normalized_version}: {migration}")
    return migration


def _apply_migration(database_dsn: str, version: int | str) -> None:
    migration = _validated_migration_path(version)
    migration_sql = migration.read_bytes()
    with psycopg.connect(database_dsn) as connection:
        connection.execute(migration_sql)


def _apply_down_migration(database_dsn: str, version: int | str) -> None:
    migration = _validated_migration_path(version, down=True)
    migration_sql = migration.read_bytes()
    with psycopg.connect(database_dsn) as connection:
        connection.execute(migration_sql)


def _available_migration_versions() -> list[str]:
    versions: list[str] = []
    for migration in MIGRATIONS.glob("*.sql"):
        match = MIGRATION_FILE_PATTERN.fullmatch(migration.name)
        if (
            match is None
            or migration.is_symlink()
            or not migration.is_file()
            or migration.resolve(strict=True).parent != MIGRATIONS.resolve(strict=True)
        ):
            raise RuntimeError(f"invalid production migration inventory entry: {migration.name}")
        versions.append(match.group(1))
    return sorted(versions)


def _available_migration_numbers(*, maximum: int | None = None) -> list[int]:
    return [
        int(version)
        for version in _available_migration_versions()
        if len(version) == 4 and (maximum is None or int(version) <= maximum)
    ]


def test_migration_inventory_accepts_exact_mixed_version_history() -> None:
    assert SUPPORTED_MIGRATION_NUMBERS == frozenset(range(1, 38))
    assert len(EXPECTED_MIGRATION_VERSIONS) == 45
    assert _available_migration_versions() == list(EXPECTED_MIGRATION_VERSIONS)
    assert _available_migration_numbers() == list(range(1, 38))
    assert _validated_migration_path(PBA_113_MIGRATION_VERSION).name == (
        "20260824193650_map_pba_113_party_jurisdictions.sql"
    )
    assert _validated_migration_path(PBA_113_MIGRATION_VERSION, down=True).name == (
        "20260824193650_map_pba_113_party_jurisdictions.down.sql"
    )
    assert _validated_migration_path(WORKSPACE_FOUNDATION_MIGRATION_VERSION).name == (
        "20260825144358_organization_workspace_expand.sql"
    )
    assert _validated_migration_path(WORKSPACE_FOUNDATION_MIGRATION_VERSION, down=True).name == (
        "20260825144358_organization_workspace_expand.down.sql"
    )
    assert _validated_migration_path(WORKSPACE_AUTHORITY_FACTS_MIGRATION_VERSION).name == (
        "20260825165116_organization_workspace_authorization_facts.sql"
    )
    assert (
        _validated_migration_path(WORKSPACE_AUTHORITY_FACTS_MIGRATION_VERSION, down=True).name
        == "20260825165116_organization_workspace_authorization_facts.down.sql"
    )
    assert _validated_migration_path(WORKSPACE_ADMIN_MIGRATION_VERSION).name == (
        "20260825180048_organization_workspace_authorization_admin.sql"
    )
    assert _validated_migration_path(WORKSPACE_ADMIN_MIGRATION_VERSION, down=True).name == (
        "20260825180048_organization_workspace_authorization_admin.down.sql"
    )
    assert _validated_migration_path(WORKSPACE_CONTEXT_MIGRATION_VERSION).name == (
        "20260826033130_session_bound_context_invalidation.sql"
    )
    assert _validated_migration_path(WORKSPACE_CONTEXT_MIGRATION_VERSION, down=True).name == (
        "20260826033130_session_bound_context_invalidation.down.sql"
    )
    assert _validated_migration_path(WORKSPACE_SELECTION_MIGRATION_VERSION).name == (
        "20260826050000_workspace_context_selection.sql"
    )
    assert _validated_migration_path(WORKSPACE_SELECTION_MIGRATION_VERSION, down=True).name == (
        "20260826050000_workspace_context_selection.down.sql"
    )
    assert _validated_migration_path(STRUCTURED_REVIEW_SCOPE_MIGRATION_VERSION).name == (
        "20260826120000_structured_review_scope.sql"
    )
    assert (
        _validated_migration_path(STRUCTURED_REVIEW_SCOPE_MIGRATION_VERSION, down=True).name
        == "20260826120000_structured_review_scope.down.sql"
    )
    assert _validated_migration_path(AUTHORIZED_OFFICIAL_FACETS_MIGRATION_VERSION).name == (
        "20260826160000_authorized_official_facets.sql"
    )
    assert (
        _validated_migration_path(AUTHORIZED_OFFICIAL_FACETS_MIGRATION_VERSION, down=True).name
        == "20260826160000_authorized_official_facets.down.sql"
    )
    for unsupported in (
        38,
        "0038",
        "20260824193651",
        "20260825165117",
        "20260825180049",
        "20260826033131",
    ):
        with pytest.raises(ValueError, match="1 through 37"):
            _validated_migration_path(unsupported)


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


def test_0029_through_timestamped_forward_down_reapply_preserve_history_and_indexes() -> None:
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
        assert _available_migration_versions() == list(EXPECTED_MIGRATION_VERSIONS)
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
        # Facets evolved independently of the official-results wrapper. Migration 0037
        # preserves the real six-argument 0028 function, so this combined history harness
        # must establish its 0025 -> 0026 -> 0028 predecessor chain first.
        for number in (25, 26, 28):
            _apply_migration(history_dsn, number)
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
        with psycopg.connect(history_dsn) as connection:
            before_0033 = connection.execute(
                "select results_exploration_official(%s,%s,'02',p_requested_level=>'distrito')",
                empty_ids,
            ).fetchone()
            wrapper_before_0033 = connection.execute(
                "select pg_get_functiondef('results_exploration_official"
                "(uuid,uuid,text,text,text,text,integer,text)'::regprocedure)"
            ).fetchone()
        _apply_migration(history_dsn, 33)
        with psycopg.connect(history_dsn) as connection:
            after_0033 = connection.execute(
                "select results_exploration_official(%s,%s,'02',p_requested_level=>'distrito')",
                empty_ids,
            ).fetchone()
            installed_0033 = connection.execute(
                "select to_regprocedure('results_exploration_official_0033"
                "(uuid,uuid,text,text,text,text,integer,text)') is not null,"
                "to_regprocedure('results_exploration_official_wrapper_0032"
                "(uuid,uuid,text,text,text,text,integer,text)') is not null,"
                "to_regprocedure('results_exploration_official_0032"
                "(uuid,uuid,text,text,text,text,integer,text)') is not null,"
                "has_function_privilege('authenticated','results_exploration_official_0033"
                "(uuid,uuid,text,text,text,text,integer,text)','execute')"
            ).fetchone()
        assert after_0033 == before_0033
        assert installed_0033 == (True, True, True, False)
        with psycopg.connect(history_dsn) as connection:
            before_0034 = connection.execute(
                "select results_exploration_official(%s,%s,'02',p_requested_level=>'distrito')",
                empty_ids,
            ).fetchone()
            wrapper_before_0034 = connection.execute(
                "select pg_get_functiondef('results_exploration_official"
                "(uuid,uuid,text,text,text,text,integer,text)'::regprocedure)"
            ).fetchone()
        _apply_migration(history_dsn, 34)
        with psycopg.connect(history_dsn) as connection:
            after_0034 = connection.execute(
                "select results_exploration_official(%s,%s,'02',p_requested_level=>'distrito')",
                empty_ids,
            ).fetchone()
            installed_0034 = connection.execute(
                "select to_regprocedure('results_exploration_official_0034"
                "(uuid,uuid,text,text,text,text,integer,text)') is not null,"
                "to_regprocedure('results_exploration_official_wrapper_0033"
                "(uuid,uuid,text,text,text,text,integer,text)') is not null,"
                "to_regprocedure('results_exploration_official_0033"
                "(uuid,uuid,text,text,text,text,integer,text)') is not null,"
                "has_function_privilege('authenticated','results_exploration_official_0034"
                "(uuid,uuid,text,text,text,text,integer,text)','execute')"
            ).fetchone()
        assert after_0034 == before_0034
        assert installed_0034 == (True, True, True, False)
        with psycopg.connect(history_dsn) as connection:
            before_0035 = connection.execute(
                "select results_exploration_official(%s,%s,'02',p_requested_level=>'distrito')",
                empty_ids,
            ).fetchone()
            wrapper_before_0035 = connection.execute(
                "select pg_get_functiondef('results_exploration_official"
                "(uuid,uuid,text,text,text,text,integer,text)'::regprocedure)"
            ).fetchone()
        _apply_migration(history_dsn, 35)
        with psycopg.connect(history_dsn) as connection:
            after_0035 = connection.execute(
                "select results_exploration_official(%s,%s,'02',p_requested_level=>'distrito')",
                empty_ids,
            ).fetchone()
            installed_0035 = connection.execute(
                "select to_regprocedure('results_exploration_official_0035"
                "(uuid,uuid,text,text,text,text,integer,text)') is not null,"
                "to_regprocedure('results_exploration_official_wrapper_0034"
                "(uuid,uuid,text,text,text,text,integer,text)') is not null,"
                "to_regprocedure('results_exploration_official_0034"
                "(uuid,uuid,text,text,text,text,integer,text)') is not null,"
                "has_function_privilege('authenticated','results_exploration_official_0035"
                "(uuid,uuid,text,text,text,text,integer,text)','execute')"
            ).fetchone()
        assert after_0035 == before_0035
        assert installed_0035 == (True, True, True, False)
        with psycopg.connect(history_dsn) as connection:
            party_boundary_before_0036 = connection.execute(
                "select pg_get_functiondef('results_exploration_party_jurisdiction"
                "(text,integer,text,text,text,text)'::regprocedure)"
            ).fetchone()
        _apply_migration(history_dsn, 36)
        with psycopg.connect(history_dsn) as connection:
            facets_before_0037 = connection.execute(
                "select pg_get_functiondef('results_exploration_facets"
                "(uuid,uuid,text,text,text,text)'::regprocedure)"
            ).fetchone()
            installed_0036 = connection.execute(
                "select results_exploration_party_jurisdiction("
                "'pba/2025-distrito-027',2025,'provinciales','CONCEJALES','02','027'),"
                "results_exploration_party_jurisdiction("
                "'pba/2025-distrito-027',2025,'provinciales',"
                "'DIPUTADOS PROVINCIALES','02','027'),"
                "results_exploration_party_jurisdiction("
                "'national/2023-generales',2023,'generales','PRESIDENTE','02','027'),"
                "has_function_privilege('authenticated',"
                "'results_exploration_party_jurisdiction(text,integer,text,text,text,text)',"
                "'execute'),has_function_privilege('anon',"
                "'results_exploration_party_jurisdiction(text,integer,text,text,text,text)',"
                "'execute')"
            ).fetchone()
        assert installed_0036 == (
            "coronel_rosales_municipal",
            "pba_provincial",
            "national",
            True,
            False,
        )
        _apply_migration(history_dsn, 37)
        with psycopg.connect(history_dsn) as connection:
            installed_0037 = connection.execute(
                "select to_regprocedure('results_exploration_facets_0036"
                "(uuid,uuid,text,text,text,text)') is not null,"
                "to_regprocedure('results_exploration_facets"
                "(uuid,uuid,text,text,text,text)') is not null,"
                "has_function_privilege('authenticated','results_exploration_facets_0036"
                "(uuid,uuid,text,text,text,text)','execute'),"
                "has_function_privilege('anon','results_exploration_facets_0036"
                "(uuid,uuid,text,text,text,text)','execute'),"
                "has_function_privilege('authenticated','results_exploration_facets"
                "(uuid,uuid,text,text,text,text)','execute'),"
                "has_function_privilege('anon','results_exploration_facets"
                "(uuid,uuid,text,text,text,text)','execute')"
            ).fetchone()
        assert installed_0037 == (True, True, False, False, True, False)
        with psycopg.connect(history_dsn) as connection:
            party_boundary_before_pba_113 = connection.execute(
                "select pg_get_functiondef('results_exploration_party_jurisdiction"
                "(text,integer,text,text,text,text)'::regprocedure)"
            ).fetchone()
        _apply_migration(history_dsn, PBA_113_MIGRATION_VERSION)
        with psycopg.connect(history_dsn) as connection:
            installed_pba_113 = connection.execute(
                "select results_exploration_party_jurisdiction("
                "'pba/2025-distrito-113',2025,'provinciales',"
                "'SENADORES PROVINCIALES','02','113'),"
                "results_exploration_party_jurisdiction("
                "'pba/2025-distrito-113',2025,'provinciales','CONCEJALES','02','113'),"
                "results_exploration_party_jurisdiction("
                "'pba/2025-distrito-027',2025,'provinciales',"
                "'DIPUTADOS PROVINCIALES','02','027'),"
                "has_function_privilege('authenticated',"
                "'results_exploration_party_jurisdiction(text,integer,text,text,text,text)',"
                "'execute'),has_function_privilege('anon',"
                "'results_exploration_party_jurisdiction(text,integer,text,text,text,text)',"
                "'execute')"
            ).fetchone()
        assert installed_pba_113 == (
            "pba_provincial",
            "tigre_municipal",
            "pba_provincial",
            True,
            False,
        )
        _apply_down_migration(history_dsn, PBA_113_MIGRATION_VERSION)
        with psycopg.connect(history_dsn) as connection:
            restored_party_boundary_0037 = connection.execute(
                "select pg_get_functiondef('results_exploration_party_jurisdiction"
                "(text,integer,text,text,text,text)'::regprocedure),"
                "results_exploration_party_jurisdiction("
                "'pba/2025-distrito-113',2025,'provinciales','CONCEJALES','02','113')"
            ).fetchone()
        assert party_boundary_before_pba_113 is not None
        assert restored_party_boundary_0037 == (party_boundary_before_pba_113[0], None)
        _apply_migration(history_dsn, PBA_113_MIGRATION_VERSION)
        with psycopg.connect(history_dsn) as connection:
            reapplied_pba_113 = connection.execute(
                "select results_exploration_party_jurisdiction("
                "'pba/2025-distrito-113',2025,'provinciales','CONCEJALES','02','113')"
            ).fetchone()
        assert reapplied_pba_113 == ("tigre_municipal",)
        _apply_down_migration(history_dsn, PBA_113_MIGRATION_VERSION)
        _apply_down_migration(history_dsn, 37)
        with psycopg.connect(history_dsn) as connection:
            restored_facets_0036 = connection.execute(
                "select pg_get_functiondef('results_exploration_facets"
                "(uuid,uuid,text,text,text,text)'::regprocedure),"
                "to_regprocedure('results_exploration_facets_0036"
                "(uuid,uuid,text,text,text,text)') is null"
            ).fetchone()
        assert facets_before_0037 is not None
        assert restored_facets_0036 == (facets_before_0037[0], True)
        _apply_migration(history_dsn, 37)
        _apply_down_migration(history_dsn, 37)
        _apply_down_migration(history_dsn, 36)
        with psycopg.connect(history_dsn) as connection:
            restored_party_boundary = connection.execute(
                "select pg_get_functiondef('results_exploration_party_jurisdiction"
                "(text,integer,text,text,text,text)'::regprocedure),"
                "results_exploration_party_jurisdiction("
                "'pba/2025-distrito-027',2025,'provinciales',"
                "'DIPUTADOS PROVINCIALES','02','027')"
            ).fetchone()
        assert party_boundary_before_0036 is not None
        assert restored_party_boundary == (party_boundary_before_0036[0], None)
        _apply_migration(history_dsn, 36)
        with psycopg.connect(history_dsn) as connection:
            reapplied_0036 = connection.execute(
                "select results_exploration_party_jurisdiction("
                "'pba/2025-distrito-027',2025,'provinciales',"
                "'DIPUTADOS PROVINCIALES','02','027')"
            ).fetchone()
        assert reapplied_0036 == ("pba_provincial",)
        _apply_down_migration(history_dsn, 36)
        _apply_down_migration(history_dsn, 35)
        with psycopg.connect(history_dsn) as connection:
            restored_0034 = connection.execute(
                "select pg_get_functiondef('results_exploration_official"
                "(uuid,uuid,text,text,text,text,integer,text)'::regprocedure),"
                "to_regprocedure('results_exploration_official_0035"
                "(uuid,uuid,text,text,text,text,integer,text)') is null,"
                "to_regprocedure('results_exploration_official_wrapper_0034"
                "(uuid,uuid,text,text,text,text,integer,text)') is null"
            ).fetchone()
        assert restored_0034 is not None and wrapper_before_0035 is not None
        assert restored_0034 == (wrapper_before_0035[0], True, True)
        _apply_down_migration(history_dsn, 34)
        with psycopg.connect(history_dsn) as connection:
            restored_0033 = connection.execute(
                "select pg_get_functiondef('results_exploration_official"
                "(uuid,uuid,text,text,text,text,integer,text)'::regprocedure),"
                "to_regprocedure('results_exploration_official_0034"
                "(uuid,uuid,text,text,text,text,integer,text)') is null,"
                "to_regprocedure('results_exploration_official_wrapper_0033"
                "(uuid,uuid,text,text,text,text,integer,text)') is null"
            ).fetchone()
        assert restored_0033 is not None and wrapper_before_0034 is not None
        assert restored_0033 == (wrapper_before_0034[0], True, True)
        _apply_down_migration(history_dsn, 33)
        with psycopg.connect(history_dsn) as connection:
            restored_0032 = connection.execute(
                "select pg_get_functiondef('results_exploration_official"
                "(uuid,uuid,text,text,text,text,integer,text)'::regprocedure),"
                "to_regprocedure('results_exploration_official_0033"
                "(uuid,uuid,text,text,text,text,integer,text)') is null,"
                "to_regprocedure('results_exploration_official_wrapper_0032"
                "(uuid,uuid,text,text,text,text,integer,text)') is null"
            ).fetchone()
        assert restored_0032 is not None and wrapper_before_0033 is not None
        assert restored_0032 == (wrapper_before_0033[0], True, True)
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
        assert restored_0031 is not None and wrapper_before_0032 is not None
        assert restored_0031 == (wrapper_before_0032[0], True, True)
        _apply_migration(history_dsn, 32)
        _apply_migration(history_dsn, 33)
        _apply_migration(history_dsn, 34)
        _apply_migration(history_dsn, 35)
        _apply_migration(history_dsn, 36)
        _apply_migration(history_dsn, 37)
        _apply_migration(history_dsn, PBA_113_MIGRATION_VERSION)
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


# fmt: off

def test_workspace_context_selection_switching_and_session_isolation() -> None:
    database_dsn = os.environ.get("ETL_TEST_DATABASE_URL")
    if not database_dsn:
        pytest.skip("ETL_TEST_DATABASE_URL is required for workspace selection coverage")
    params = conninfo_to_dict(database_dsn)
    params["user"] = "postgres"
    params.pop("password", None)
    admin_dsn = make_conninfo(**{key: str(value) for key, value in params.items()})
    user_id, session_id, other_session = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    organizations = [uuid.uuid4() for _ in range(3)]

    def rpc(name: str, session: uuid.UUID, *args: object) -> dict[str, object]:
        claims = json.dumps({"sub": str(user_id), "session_id": str(session), "exp": 253402300798})
        with psycopg.connect(admin_dsn) as connection:
            connection.execute("select set_config('request.jwt.claims',%s,false)", (claims,))
            connection.execute("set role authenticated")
            row = connection.execute(f"select workspace_api.{name}({','.join(['%s'] * len(args))})", args).fetchone()  # noqa: E501, S608
            assert row is not None and isinstance(row[0], dict)
            return row[0]

    try:
        assert rpc("current_workspace", session_id) == {"status": "selection_required", "context_revision": 0}  # noqa: E501
        with psycopg.connect(admin_dsn) as connection:
            connection.execute("set role workspace_admin_owner")
            connection.cursor().executemany(
                "insert into workspace_private.organization(id,slug,display_name,disabled_at) values(%s,%s,%s,%s)",  # noqa: E501
                [(organizations[0], f"active-{organizations[0].hex}", "Active", None),
                 (organizations[1], f"revoked-{organizations[1].hex}", "Revoked", None),
                 (organizations[2], f"disabled-{organizations[2].hex}", "Disabled", "2000-01-01")],
            )
            connection.cursor().executemany(
                "insert into workspace_private.organization_membership(organization_id,user_id,revoked_at) values(%s,%s,%s)",  # noqa: E501
                [(organizations[0], user_id, None), (organizations[1], user_id, "2100-01-01"),
                 (organizations[2], user_id, None)],
            )
        assert rpc("available_organizations", session_id) == {
            "status": "ok",
            "organizations": [{"id": str(organizations[0]), "display_name": "Active"}],
            "total": 1, "truncated": False,
        }
        first = rpc("bootstrap_workspace_context", session_id)
        assert first == {"status": "selection_required", "context_revision": 1}
        assert rpc("bootstrap_workspace_context", session_id) == first
        assert rpc("bootstrap_workspace_context", other_session) == first
        assert rpc("switch_workspace_context", session_id, organizations[0], 1) == {"status": "active", "context_revision": 2}  # noqa: E501
        assert rpc("current_workspace", session_id) == {"status": "active", "context_revision": 2,
            "organization": {"id": str(organizations[0]), "display_name": "Active"}}
        assert rpc("switch_workspace_context", session_id, organizations[0], 2) == {"status": "same_state", "context_revision": 2}  # noqa: E501
        assert rpc("switch_workspace_context", session_id, organizations[0], 1) == {"status": "conflict", "context_revision": 2}  # noqa: E501
        assert rpc("current_workspace", other_session) == {"status": "selection_required", "context_revision": 1}  # noqa: E501
        with psycopg.connect(admin_dsn) as connection:
            connection.execute("set role workspace_admin_owner")
            connection.execute("update workspace_private.organization_membership set membership_revision=2 where organization_id=%s and user_id=%s", (organizations[0], user_id))  # noqa: E501
        assert rpc("current_workspace", session_id) == {"status": "stale", "context_revision": 2}
        assert rpc("switch_workspace_context", session_id, organizations[0], 2) == {"status": "active", "context_revision": 3}  # noqa: E501
        with psycopg.connect(admin_dsn) as connection:
            connection.execute("set role workspace_admin_owner")
            connection.execute("update workspace_private.organization set entitlement_revision=1 where id=%s", (organizations[0],))  # noqa: E501
        assert rpc("current_workspace", session_id) == {"status": "stale", "context_revision": 3}
        assert rpc("switch_workspace_context", session_id, organizations[0], 3) == {"status": "active", "context_revision": 4}  # noqa: E501
        with psycopg.connect(admin_dsn) as connection:
            connection.execute("set role workspace_admin_owner")
            connection.execute("update workspace_private.organization set disabled_at=now() where id=%s", (organizations[0],))  # noqa: E501
        assert rpc("current_workspace", session_id) == {"status": "stale", "context_revision": 4}
        with psycopg.connect(admin_dsn) as connection:
            connection.execute("set role workspace_context_owner")
            connection.execute("update workspace_private.workspace_context set fixed_expires_at='2000-01-01' where session_id=%s", (session_id,))  # noqa: E501
        assert rpc("current_workspace", session_id) == {"status": "expired", "context_revision": 4}
        with psycopg.connect(admin_dsn) as connection:
            connection.execute("set role workspace_context_owner")
            connection.execute("update workspace_private.workspace_context set fixed_expires_at='2100-01-01',revoked_at=now() where session_id=%s", (session_id,))  # noqa: E501
        assert rpc("current_workspace", session_id) == {"status": "revoked", "context_revision": 4}
    finally:
        with psycopg.connect(admin_dsn) as connection:
            connection.execute("delete from workspace_private.workspace_audit_event where user_id=%s", (user_id,))  # noqa: E501
            connection.execute("delete from workspace_private.workspace_context where user_id=%s", (user_id,))  # noqa: E501
            connection.execute("delete from workspace_private.organization_membership where organization_id=any(%s)", (organizations,))  # noqa: E501
            connection.execute("delete from workspace_private.organization where id=any(%s)", (organizations,))  # noqa: E501

# fmt: on


def test_workspace_admin_transitions_acl_down_and_reapply() -> None:
    database_dsn = os.environ.get("ETL_TEST_DATABASE_URL")
    if not database_dsn:
        pytest.skip("ETL_TEST_DATABASE_URL is required for workspace admin coverage")
    params = conninfo_to_dict(database_dsn)
    params["user"] = "postgres"
    params.pop("password", None)
    admin_dsn = make_conninfo(**{key: str(value) for key, value in params.items()})
    fixture_id = uuid.uuid4()
    actor = f"test:workspace-admin:{fixture_id}"
    slug = f"workspace-admin-{fixture_id.hex}"
    display_name = f"Workspace Admin {fixture_id.hex}"
    distrito_code = str(10 + fixture_id.int % 90)
    seccion_code = str((fixture_id.int // 100) % 1_000).zfill(3)
    user_id = uuid.uuid4()
    context_user_id = uuid.uuid4()
    context_ids, context_sessions = ((uuid.uuid4(), uuid.uuid4()) for _ in range(2))
    signatures = (
        "workspace_private.create_organization(text,text,text,text)",
        "workspace_private.disable_organization(uuid,text,text)",
        "workspace_private.grant_membership(uuid,uuid,text,text)",
        "workspace_private.revoke_membership(uuid,uuid,text,text)",
        "workspace_private.register_section_scope(text,text,text,text)",
        "workspace_private.grant_section_entitlement(uuid,text,text,text,text)",
        "workspace_private.revoke_section_entitlement(uuid,text,text,text,text)",
    )
    statements = {
        "create": "select workspace_private.create_organization(%s,%s,%s)",
        "disable": "select workspace_private.disable_organization(%s,%s)",
        "grant_membership": "select workspace_private.grant_membership(%s,%s,%s)",
        "revoke_membership": "select workspace_private.revoke_membership(%s,%s,%s)",
        "register_scope": "select workspace_private.register_section_scope(%s,%s,%s)",
        "grant_entitlement": ("select workspace_private.grant_section_entitlement(%s,%s,%s,%s)"),
        "revoke_entitlement": ("select workspace_private.revoke_section_entitlement(%s,%s,%s,%s)"),
    }
    organization_id: uuid.UUID | None = None

    try:
        with psycopg.connect(admin_dsn) as connection:
            connection.execute(
                "insert into public.jurisdiction(id,distrito_code,seccion_code) values(%s,%s,%s)",
                (fixture_id, distrito_code, seccion_code),
            )
            connection.execute("set role workspace_platform_admin")
            created = connection.execute(
                statements["create"], (slug, display_name, actor)
            ).fetchone()
            assert created is not None and created[0]["changed"] is True
            organization_id = uuid.UUID(created[0]["organization_id"])
            connection.execute("set role workspace_admin_owner")
            connection.execute(
                "insert into workspace_private.organization_membership(organization_id,user_id) "
                "values(%s,%s)",
                (organization_id, context_user_id),
            )
            connection.execute("set role workspace_context_owner")
            context_base = (context_user_id, organization_id, 1, 0, 1)
            connection.cursor().executemany(
                "insert into workspace_private.workspace_context(id,session_id,user_id,"
                "organization_id,membership_revision,entitlement_revision,context_revision,"
                "fixed_expires_at) values(%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    (context_ids[0], context_sessions[0], *context_base, "2100-01-01"),
                    (context_ids[1], context_sessions[1], *context_base, "2000-01-01"),
                ),
            )

        def claims(session_id, subject_id=context_user_id, exp=253402300798):
            return {"sub": str(subject_id), "session_id": str(session_id), "exp": exp}

        def invalidate(payload):
            encoded = payload if isinstance(payload, str) else json.dumps(payload)
            with psycopg.connect(admin_dsn) as rpc:
                rpc.execute("select set_config('request.jwt.claims',%s,false)", (encoded,))
                rpc.execute("set role authenticated")
                row = rpc.execute("select workspace_api.invalidate_workspace_context()").fetchone()
                assert row is not None
                return row[0]

        assert invalidate(claims(uuid.uuid4())) == {"invalidated": False}
        assert invalidate(claims(context_sessions[0])) == {"invalidated": True}
        with psycopg.connect(admin_dsn) as connection:
            assert connection.execute(
                "select (select revoked_at is not null "
                "from workspace_private.workspace_context where id=%s),"
                "(select revoked_at is null from workspace_private.workspace_context where id=%s),"
                "(select count(*) from workspace_private.workspace_audit_event where context_id=%s "
                "and session_id=%s and action='context_invalidated' and reason_code='logout')",
                (context_ids[0], context_ids[1], context_ids[0], context_sessions[0]),
            ).fetchone() == (True, True, 1)
        assert invalidate(claims(context_sessions[0])) == {"invalidated": False}
        failures = (
            (claims(context_sessions[1], uuid.uuid4()), "VOT03"),
            (claims(context_sessions[1], exp=1), "VOT02"),
            ('{"sub":', "VOT02"),
        )
        for payload, sqlstate in failures:
            with pytest.raises(psycopg.Error) as error:
                invalidate(payload)
            assert error.value.sqlstate == sqlstate
        assert invalidate(claims(context_sessions[1])) == {"invalidated": True}

        barrier = Barrier(2)

        def register_concurrently() -> bool:
            with psycopg.connect(admin_dsn) as connection:
                connection.execute("set role workspace_platform_admin")
                barrier.wait(timeout=10)
                row = connection.execute(
                    statements["register_scope"],
                    (distrito_code, seccion_code, actor),
                ).fetchone()
                assert row is not None
                return row[0]["changed"]

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(register_concurrently) for _ in range(2)]
            assert sorted(future.result() for future in futures) == [False, True]

        with psycopg.connect(admin_dsn) as connection:
            connection.execute("set role workspace_platform_admin")

            def call(name: str, *args: object) -> dict[str, object]:
                row = connection.execute(statements[name], args).fetchone()
                assert row is not None and isinstance(row[0], dict)
                return row[0]

            def audit_count() -> int:
                row = connection.execute(
                    "select count(*) from workspace_private.workspace_audit_event "
                    "where actor_ref=%s",
                    (actor,),
                ).fetchone()
                assert row is not None
                return row[0]

            def no_op(name: str, *args: object) -> dict[str, object]:
                connection.execute("reset role")
                before = audit_count()
                connection.execute("set role workspace_platform_admin")
                result = call(name, *args)
                connection.execute("reset role")
                after = audit_count()
                connection.execute("set role workspace_platform_admin")
                assert result["changed"] is False and after == before
                return result

            def denied(name: str, *args: object) -> None:
                with pytest.raises(psycopg.Error):
                    with connection.transaction():
                        call(name, *args)

            denied("create", slug, f"{display_name} duplicate", actor)
            denied("create", f"{slug}-duplicate", display_name, actor)
            denied("disable", uuid.uuid4(), actor)
            denied("revoke_membership", organization_id, uuid.uuid4(), actor)
            denied("register_scope", "8", seccion_code, actor)
            denied("register_scope", "99", "999", actor)
            denied("revoke_entitlement", organization_id, distrito_code, seccion_code, actor)

            membership = call("grant_membership", organization_id, user_id, actor)
            assert membership["membership_revision"] == 1
            assert no_op("grant_membership", organization_id, user_id, actor) == {
                **membership,
                "changed": False,
            }
            membership = call("revoke_membership", organization_id, user_id, actor)
            assert membership["membership_revision"] == 2
            assert no_op("revoke_membership", organization_id, user_id, actor) == {
                **membership,
                "changed": False,
            }
            entitlement = call(
                "grant_entitlement", organization_id, distrito_code, seccion_code, actor
            )
            assert entitlement["entitlement_revision"] == 1
            assert entitlement["organization_revision"] == 1
            assert no_op(
                "grant_entitlement", organization_id, distrito_code, seccion_code, actor
            ) == {**entitlement, "changed": False}
            entitlement = call(
                "revoke_entitlement", organization_id, distrito_code, seccion_code, actor
            )
            assert entitlement["entitlement_revision"] == 2
            assert entitlement["organization_revision"] == 2
            assert no_op(
                "revoke_entitlement", organization_id, distrito_code, seccion_code, actor
            ) == {**entitlement, "changed": False}
            disabled = call("disable", organization_id, actor)
            assert disabled["changed"] is True
            assert no_op("disable", organization_id, actor) == {
                **disabled,
                "changed": False,
                "status": "already_disabled",
            }
            denied("grant_membership", organization_id, uuid.uuid4(), actor)
            denied("grant_entitlement", organization_id, distrito_code, seccion_code, actor)
            connection.execute("reset role")
            audit = connection.execute(
                "select count(*),array_agg(action order by action),"
                "bool_and(actor_kind='platform_operator' and reason_code='operator_request') "
                "from workspace_private.workspace_audit_event where actor_ref=%s",
                (actor,),
            ).fetchone()
            assert audit == (
                7,
                [
                    "membership_granted",
                    "membership_revoked",
                    "organization_created",
                    "organization_disabled",
                    "section_entitlement_granted",
                    "section_entitlement_revoked",
                    "section_scope_registered",
                ],
                True,
            )
            assert connection.execute(
                "select count(*) from workspace_private.section_scope "
                "where distrito_code=%s and seccion_code=%s",
                (distrito_code, seccion_code),
            ).fetchone() == (1,)
            for signature in signatures:
                assert connection.execute(
                    "select has_function_privilege('workspace_platform_admin',%s,'EXECUTE'),"
                    "has_function_privilege('anon',%s,'EXECUTE')",
                    (signature, signature),
                ).fetchone() == (True, False)
            assert connection.execute(
                "select has_function_privilege('workspace_admin_owner',"
                "'workspace_private.append_audit_event(text,uuid,text,text,jsonb)','EXECUTE'),"
                "has_function_privilege('workspace_platform_admin',"
                "'workspace_private.append_audit_event(text,uuid,text,text,jsonb)','EXECUTE')"
            ).fetchone() == (True, False)
            facts_before = connection.execute(
                "select workspace_private.authorization_facts_status()"
            ).fetchone()

        for role in (
            "anon",
            "authenticated",
            "etl_writer",
            "workspace_bootstrap_caller",
            "workspace_query_owner",
            "workspace_platform_admin",
        ):
            with psycopg.connect(admin_dsn) as connection:
                with pytest.raises(psycopg.errors.InsufficientPrivilege):
                    with connection.transaction():
                        connection.execute(
                            sql.SQL("set local role {}").format(sql.Identifier(role))
                        )
                        connection.execute(
                            "insert into workspace_private.organization(slug,display_name) "
                            "values('direct-dml','Direct DML')"
                        )

        membership_sql = (
            "select granted.rolname,member.rolname,m.admin_option,m.inherit_option,m.set_option "
            "from pg_auth_members m join pg_roles granted on granted.oid=m.roleid "
            "join pg_roles member on member.oid=m.member "
            "where granted.rolname in ('workspace_admin_owner','workspace_audit_owner') "
            "and member.rolname=current_user order by granted.rolname"
        )
        with psycopg.connect(admin_dsn) as connection:
            role_edges_before = connection.execute(membership_sql).fetchall()
        assert [(row[0], *row[2:]) for row in role_edges_before] in (
            [],
            [
                ("workspace_admin_owner", True, False, False),
                ("workspace_audit_owner", True, False, False),
            ],
        )
        _apply_down_migration(admin_dsn, AUTHORIZED_OFFICIAL_FACETS_MIGRATION_VERSION)
        _apply_down_migration(admin_dsn, STRUCTURED_REVIEW_SCOPE_MIGRATION_VERSION)
        _apply_down_migration(admin_dsn, WORKSPACE_SELECTION_MIGRATION_VERSION)
        _apply_down_migration(admin_dsn, WORKSPACE_CONTEXT_MIGRATION_VERSION)
        with psycopg.connect(admin_dsn) as connection:
            assert connection.execute(
                "select to_regprocedure('workspace_api.invalidate_workspace_context()') is null,"
                "to_regclass('workspace_private.workspace_context') is null,"
                "to_regprocedure('workspace_private.create_organization"
                "(text,text,text,text)') is not null"
            ).fetchone() == (True, True, True)
            assert (
                connection.execute(
                    "select workspace_private.authorization_facts_status()"
                ).fetchone()
                == facts_before
            )
        _apply_down_migration(admin_dsn, WORKSPACE_ADMIN_MIGRATION_VERSION)
        with psycopg.connect(admin_dsn) as connection:
            policies = connection.execute(
                "select array_agg(policyname order by policyname) from pg_policies "
                "where schemaname='workspace_private'"
            ).fetchone()
            assert policies == (
                [
                    "workspace_admin_owner_entitlement_select",
                    "workspace_admin_owner_membership_select",
                    "workspace_admin_owner_organization_select",
                    "workspace_admin_owner_scope_select",
                ],
            )
            assert connection.execute(
                "select to_regprocedure('workspace_private.authorization_facts_status()') "
                "is not null,to_regprocedure('workspace_private.create_organization"
                "(text,text,text,text)') is null"
            ).fetchone() == (True, True)
            connection.execute("set role workspace_platform_admin")
            assert (
                connection.execute(
                    "select workspace_private.authorization_facts_status()"
                ).fetchone()
                == facts_before
            )
        _apply_migration(admin_dsn, WORKSPACE_ADMIN_MIGRATION_VERSION)
        _apply_migration(admin_dsn, WORKSPACE_CONTEXT_MIGRATION_VERSION)
        _apply_migration(admin_dsn, WORKSPACE_SELECTION_MIGRATION_VERSION)
        _apply_migration(admin_dsn, STRUCTURED_REVIEW_SCOPE_MIGRATION_VERSION)
        _apply_migration(admin_dsn, AUTHORIZED_OFFICIAL_FACETS_MIGRATION_VERSION)
        with psycopg.connect(admin_dsn) as connection:
            assert connection.execute(membership_sql).fetchall() == role_edges_before
            assert connection.execute(
                "select to_regprocedure('workspace_private.create_organization"
                "(text,text,text,text)') is not null,"
                "to_regprocedure('workspace_api.invalidate_workspace_context()') is not null"
            ).fetchone() == (True, True)
    finally:
        with psycopg.connect(admin_dsn) as connection:
            admin_installed, context_installed, selection_installed = connection.execute(
                "select to_regprocedure('workspace_private.create_organization"
                "(text,text,text,text)') is not null,"
                "to_regprocedure('workspace_api.invalidate_workspace_context()') is not null,"
                "to_regprocedure('workspace_api.current_workspace()') is not null"
            ).fetchone()
        if context_installed and not admin_installed:
            if selection_installed:
                _apply_down_migration(admin_dsn, WORKSPACE_SELECTION_MIGRATION_VERSION)
                selection_installed = False
            _apply_down_migration(admin_dsn, WORKSPACE_CONTEXT_MIGRATION_VERSION)
            context_installed = False
        if not admin_installed:
            _apply_migration(admin_dsn, WORKSPACE_ADMIN_MIGRATION_VERSION)
        if not context_installed:
            _apply_migration(admin_dsn, WORKSPACE_CONTEXT_MIGRATION_VERSION)
        if not selection_installed:
            _apply_migration(admin_dsn, WORKSPACE_SELECTION_MIGRATION_VERSION)
        with psycopg.connect(admin_dsn) as connection:
            connection.execute(
                "with removed as (delete from workspace_private.workspace_audit_event "
                "where user_id=%s and action='context_invalidated') "
                "delete from workspace_private.workspace_context where user_id=%s",
                (context_user_id, context_user_id),
            )
            connection.execute(
                "delete from workspace_private.workspace_audit_event where actor_ref=%s",
                (actor,),
            )
            if organization_id is not None:
                connection.execute(
                    "delete from workspace_private.organization_section_entitlement "
                    "where organization_id=%s",
                    (organization_id,),
                )
                connection.execute(
                    "delete from workspace_private.organization_membership "
                    "where organization_id=%s",
                    (organization_id,),
                )
                connection.execute(
                    "delete from workspace_private.organization where id=%s",
                    (organization_id,),
                )
            connection.execute(
                "delete from workspace_private.section_scope where distrito_code=%s "
                "and seccion_code=%s",
                (distrito_code, seccion_code),
            )
            connection.execute("delete from public.jurisdiction where id=%s", (fixture_id,))
