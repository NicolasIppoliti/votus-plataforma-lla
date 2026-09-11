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
SUPPORTED_MIGRATION_NUMBERS = frozenset(range(1, 39))
PBA_113_MIGRATION_VERSION = "20260824193650"
WORKSPACE_FOUNDATION_MIGRATION_VERSION = "20260825144358"
WORKSPACE_AUTHORITY_FACTS_MIGRATION_VERSION = "20260825165116"
WORKSPACE_ADMIN_MIGRATION_VERSION = "20260825180048"
WORKSPACE_CONTEXT_MIGRATION_VERSION = "20260826033130"
WORKSPACE_SELECTION_MIGRATION_VERSION = "20260826050000"
STRUCTURED_REVIEW_SCOPE_MIGRATION_VERSION = "20260826120000"
AUTHORIZED_OFFICIAL_FACETS_MIGRATION_VERSION = "20260826160000"
AUTHORIZED_OFFICIAL_OPERATIONS_MIGRATION_VERSION = "20260826200000"
AUTHORIZED_OFFICIAL_PROJECTIONS_MIGRATION_VERSION = "20260827000000"
AUTHORIZED_FISCAL_REVIEW_MIGRATION_VERSION = "20260827040000"
AUTHORIZED_FISCAL_COVERAGE_MIGRATION_VERSION = "20260827112658"
AUTHORIZED_FISCAL_RESULT_MIGRATION_VERSION = "20260827130000"
PLATFORM_REVIEW_OPERATOR_MIGRATION_VERSION = "20260827160000"
AUTHORIZED_FISCALIZACION_FACETS_MIGRATION_VERSION = "20260827170000"
AUTHORIZED_OFFICIAL_DRILLDOWN_FACETS_MIGRATION_VERSION = "20260827200000"
AUTHORIZED_SCHOOL_PARTY_LOOKUP_MIGRATION_VERSION = "20260827220000"
LEGACY_RESULTS_CUTOVER_MIGRATION_VERSION = "20260829032228"
BOUND_AUTHORIZED_RESULT_EVIDENCE_MIGRATION_VERSION = "20260829232200"
REVIEW_ITEM_CONTEXT_MIGRATION_VERSION = "20260830180653"
REVIEW_CONTEXT_CLASSIFICATION_MIGRATION_VERSION = "20260830203643"
RECORD_REVIEW_ITEM_V2_MIGRATION_VERSION = "20260831032044"
RECORD_REVIEW_ITEM_CONTEXTS_MIGRATION_VERSION = "20260831055357"
YEAR_LEVEL_REVIEW_CONTEXTS_MIGRATION_VERSION = "20260831150450"
PLATFORM_REVIEW_BREAKDOWN_MIGRATION_VERSION = "20260831160422"
OFFICIAL_CATEGORY_NAME_MIGRATION_VERSION = "20260904035355"
CANONICAL_AUTHORIZED_OFFICIAL_FACET_METADATA_MIGRATION_VERSION = "20260910212254"
LATEST_REVIEW_CONTEXT_MIGRATION_VERSIONS = (
    REVIEW_ITEM_CONTEXT_MIGRATION_VERSION,
    REVIEW_CONTEXT_CLASSIFICATION_MIGRATION_VERSION,
    RECORD_REVIEW_ITEM_V2_MIGRATION_VERSION,
    RECORD_REVIEW_ITEM_CONTEXTS_MIGRATION_VERSION,
    YEAR_LEVEL_REVIEW_CONTEXTS_MIGRATION_VERSION,
    PLATFORM_REVIEW_BREAKDOWN_MIGRATION_VERSION,
)
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
        AUTHORIZED_OFFICIAL_OPERATIONS_MIGRATION_VERSION,
        AUTHORIZED_OFFICIAL_PROJECTIONS_MIGRATION_VERSION,
        AUTHORIZED_FISCAL_REVIEW_MIGRATION_VERSION,
        AUTHORIZED_FISCAL_COVERAGE_MIGRATION_VERSION,
        AUTHORIZED_FISCAL_RESULT_MIGRATION_VERSION,
        PLATFORM_REVIEW_OPERATOR_MIGRATION_VERSION,
        AUTHORIZED_FISCALIZACION_FACETS_MIGRATION_VERSION,
        AUTHORIZED_OFFICIAL_DRILLDOWN_FACETS_MIGRATION_VERSION,
        AUTHORIZED_SCHOOL_PARTY_LOOKUP_MIGRATION_VERSION,
        LEGACY_RESULTS_CUTOVER_MIGRATION_VERSION,
        BOUND_AUTHORIZED_RESULT_EVIDENCE_MIGRATION_VERSION,
        REVIEW_ITEM_CONTEXT_MIGRATION_VERSION,
        REVIEW_CONTEXT_CLASSIFICATION_MIGRATION_VERSION,
        RECORD_REVIEW_ITEM_V2_MIGRATION_VERSION,
        RECORD_REVIEW_ITEM_CONTEXTS_MIGRATION_VERSION,
        YEAR_LEVEL_REVIEW_CONTEXTS_MIGRATION_VERSION,
        PLATFORM_REVIEW_BREAKDOWN_MIGRATION_VERSION,
        OFFICIAL_CATEGORY_NAME_MIGRATION_VERSION,
        CANONICAL_AUTHORIZED_OFFICIAL_FACET_METADATA_MIGRATION_VERSION,
    }
)
EXPECTED_MIGRATION_VERSIONS = tuple(
    [*(f"{number:04d}" for number in range(1, 39)), *sorted(SUPPORTED_TIMESTAMP_MIGRATION_VERSIONS)]
)
MIGRATION_FILE_PATTERN = re.compile(r"^(\d{4}|\d{14})_[^/]+\.sql$")


def _normalized_migration_version(version: int | str) -> str:
    if type(version) is int and version in SUPPORTED_MIGRATION_NUMBERS:
        return f"{version:04d}"
    if type(version) is str and version in SUPPORTED_TIMESTAMP_MIGRATION_VERSIONS:
        return version
    raise ValueError(
        "migration version must be an integer from 1 through 38 or one of the exact "
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


def _fetchone(connection, statement, parameters=()):
    return connection.execute(statement, parameters).fetchone()


def _review_context_migration_level(database_dsn: str) -> int:
    with psycopg.connect(database_dsn) as connection:
        installed = _fetchone(
            connection,
            "select to_regclass('workspace_private.review_item_context') is not null,"
            "exists(select from information_schema.columns where table_schema='workspace_private' "
            "and table_name='review_item_context' and column_name='context_role'),"
            "to_regprocedure('workspace_private.record_review_item_v2"
            "(text,text,text,text,text[],text[],text,text,text,integer,"
            "uuid,uuid,text)') is not null,"
            "to_regprocedure('workspace_private.record_review_item_v2"
            "(text,text,text,text,text[],text[],jsonb)') is not null,"
            "coalesce(position('source_archive_not_attributable' in pg_get_functiondef(to_regprocedure('workspace_private.record_review_item_v2(text,text,text,text,text[],text[],jsonb)')))>0,false),"  # noqa: E501
            "to_regprocedure('workspace_private.platform_review_breakdown(integer,integer)') is not null",  # noqa: E501
        )
    chronological_states = (
        (False, False, False, False, False, False),
        (True, False, False, False, False, False),
        (True, True, False, False, False, False),
        (True, True, True, False, False, False),
        (True, True, False, True, False, False),
        (True, True, False, True, True, False),
        (True, True, False, True, True, True),
    )
    if installed not in chronological_states:
        raise AssertionError(
            f"review context migrations are not at a recognized chronological level: {installed}"
        )
    return chronological_states.index(installed)


def _review_context_migration_plan(
    current_level: int, target_level: int
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    valid = range(len(LATEST_REVIEW_CONTEXT_MIGRATION_VERSIONS) + 1)
    if current_level not in valid or target_level not in valid:
        raise ValueError("review context migration level is out of range")
    if current_level > target_level:
        return tuple(
            reversed(LATEST_REVIEW_CONTEXT_MIGRATION_VERSIONS[target_level:current_level])
        ), ()  # noqa: E501
    return (), LATEST_REVIEW_CONTEXT_MIGRATION_VERSIONS[current_level:target_level]


def _set_latest_review_context_level(database_dsn: str, target_level: int) -> None:
    down, up = _review_context_migration_plan(
        _review_context_migration_level(database_dsn), target_level
    )
    for version in down:
        _apply_down_migration(database_dsn, version)
    for version in up:
        _apply_migration(database_dsn, version)


def test_review_context_migration_plan_covers_all_six_migrations() -> None:
    assert LATEST_REVIEW_CONTEXT_MIGRATION_VERSIONS == (
        REVIEW_ITEM_CONTEXT_MIGRATION_VERSION,
        REVIEW_CONTEXT_CLASSIFICATION_MIGRATION_VERSION,
        RECORD_REVIEW_ITEM_V2_MIGRATION_VERSION,
        RECORD_REVIEW_ITEM_CONTEXTS_MIGRATION_VERSION,
        YEAR_LEVEL_REVIEW_CONTEXTS_MIGRATION_VERSION,
        PLATFORM_REVIEW_BREAKDOWN_MIGRATION_VERSION,
    )
    assert _review_context_migration_plan(6, 0)[0] == tuple(
        reversed(LATEST_REVIEW_CONTEXT_MIGRATION_VERSIONS)
    )


def _relation_installed(database_dsn: str, relation: str) -> bool:
    with psycopg.connect(database_dsn) as connection:
        return connection.execute("select to_regclass(%s) is not null", (relation,)).fetchone() == (
            True,
        )


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
    assert SUPPORTED_MIGRATION_NUMBERS == frozenset(range(1, 39))
    assert len(EXPECTED_MIGRATION_VERSIONS) == 65
    assert _available_migration_versions() == list(EXPECTED_MIGRATION_VERSIONS)
    assert _available_migration_numbers() == list(range(1, 39))
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
    assert _validated_migration_path(AUTHORIZED_OFFICIAL_OPERATIONS_MIGRATION_VERSION).name == (
        "20260826200000_authorized_official_operations.sql"
    )
    operations_down = _validated_migration_path(
        AUTHORIZED_OFFICIAL_OPERATIONS_MIGRATION_VERSION, down=True
    )
    assert operations_down.name == "20260826200000_authorized_official_operations.down.sql"
    assert _validated_migration_path(AUTHORIZED_OFFICIAL_PROJECTIONS_MIGRATION_VERSION).name == (
        "20260827000000_authorized_official_projections.sql"
    )
    assert (
        _validated_migration_path(AUTHORIZED_OFFICIAL_PROJECTIONS_MIGRATION_VERSION, down=True).name
        == "20260827000000_authorized_official_projections.down.sql"
    )
    assert _validated_migration_path(AUTHORIZED_FISCAL_REVIEW_MIGRATION_VERSION).name == (
        "20260827040000_authorized_fiscal_review.sql"
    )
    assert _validated_migration_path(
        AUTHORIZED_FISCAL_REVIEW_MIGRATION_VERSION, down=True
    ).name == ("20260827040000_authorized_fiscal_review.down.sql")
    assert _validated_migration_path(AUTHORIZED_FISCAL_COVERAGE_MIGRATION_VERSION).name == (
        "20260827112658_authorized_fiscal_coverage.sql"
    )
    assert _validated_migration_path(
        AUTHORIZED_FISCAL_COVERAGE_MIGRATION_VERSION, down=True
    ).name == ("20260827112658_authorized_fiscal_coverage.down.sql")
    assert _validated_migration_path(AUTHORIZED_FISCAL_RESULT_MIGRATION_VERSION).name == (
        "20260827130000_authorized_fiscal_result.sql"
    )
    assert (
        _validated_migration_path(AUTHORIZED_FISCAL_RESULT_MIGRATION_VERSION, down=True).name
        == "20260827130000_authorized_fiscal_result.down.sql"
    )
    assert _validated_migration_path(PLATFORM_REVIEW_OPERATOR_MIGRATION_VERSION).name == (
        "20260827160000_platform_review_operator_access.sql"
    )
    assert (
        _validated_migration_path(PLATFORM_REVIEW_OPERATOR_MIGRATION_VERSION, down=True).name
        == "20260827160000_platform_review_operator_access.down.sql"
    )
    assert (
        _validated_migration_path(AUTHORIZED_FISCALIZACION_FACETS_MIGRATION_VERSION).name
        == "20260827170000_authorized_fiscalizacion_facets.sql"
    )
    assert (
        _validated_migration_path(AUTHORIZED_FISCALIZACION_FACETS_MIGRATION_VERSION, down=True).name
        == "20260827170000_authorized_fiscalizacion_facets.down.sql"
    )
    assert (
        _validated_migration_path(AUTHORIZED_OFFICIAL_DRILLDOWN_FACETS_MIGRATION_VERSION).name
        == "20260827200000_authorized_official_drilldown_facets.sql"
    )
    assert (
        _validated_migration_path(
            AUTHORIZED_OFFICIAL_DRILLDOWN_FACETS_MIGRATION_VERSION, down=True
        ).name
        == "20260827200000_authorized_official_drilldown_facets.down.sql"
    )
    assert _validated_migration_path(AUTHORIZED_SCHOOL_PARTY_LOOKUP_MIGRATION_VERSION).name == (
        "20260827220000_authorized_school_party_lookup.sql"
    )
    assert (
        _validated_migration_path(AUTHORIZED_SCHOOL_PARTY_LOOKUP_MIGRATION_VERSION, down=True).name
        == "20260827220000_authorized_school_party_lookup.down.sql"
    )
    assert _validated_migration_path(LEGACY_RESULTS_CUTOVER_MIGRATION_VERSION).name == (
        "20260829032228_revoke_legacy_results_public_contract.sql"
    )
    assert (
        _validated_migration_path(LEGACY_RESULTS_CUTOVER_MIGRATION_VERSION, down=True).name
        == "20260829032228_revoke_legacy_results_public_contract.down.sql"
    )
    assert _validated_migration_path(OFFICIAL_CATEGORY_NAME_MIGRATION_VERSION).name == (
        f"{OFFICIAL_CATEGORY_NAME_MIGRATION_VERSION}_add_official_category_name.sql"
    )
    assert _validated_migration_path(OFFICIAL_CATEGORY_NAME_MIGRATION_VERSION, down=True).name == (
        f"{OFFICIAL_CATEGORY_NAME_MIGRATION_VERSION}_add_official_category_name.down.sql"
    )
    assert _validated_migration_path(
        CANONICAL_AUTHORIZED_OFFICIAL_FACET_METADATA_MIGRATION_VERSION
    ).name == (
        f"{CANONICAL_AUTHORIZED_OFFICIAL_FACET_METADATA_MIGRATION_VERSION}_canonical_authorized_official_facet_metadata.sql"
    )
    assert _validated_migration_path(
        CANONICAL_AUTHORIZED_OFFICIAL_FACET_METADATA_MIGRATION_VERSION, down=True
    ).name == (
        f"{CANONICAL_AUTHORIZED_OFFICIAL_FACET_METADATA_MIGRATION_VERSION}_canonical_authorized_official_facet_metadata.down.sql"
    )
    for version, stem in (
        (REVIEW_ITEM_CONTEXT_MIGRATION_VERSION, "review_item_context_foundation"),
        (REVIEW_CONTEXT_CLASSIFICATION_MIGRATION_VERSION, "classify_historical_review_contexts"),
        (RECORD_REVIEW_ITEM_V2_MIGRATION_VERSION, "record_review_item_v2"),
        (RECORD_REVIEW_ITEM_CONTEXTS_MIGRATION_VERSION, "record_review_item_contexts"),
        (YEAR_LEVEL_REVIEW_CONTEXTS_MIGRATION_VERSION, "allow_year_level_review_contexts"),
        (PLATFORM_REVIEW_BREAKDOWN_MIGRATION_VERSION, "platform_review_breakdown"),
    ):  # noqa: E501
        for down, suffix in ((False, ".sql"), (True, ".down.sql")):
            assert _validated_migration_path(version, down=down).name == f"{version}_{stem}{suffix}"
    privilege_sql = [
        _validated_migration_path(REVIEW_CONTEXT_CLASSIFICATION_MIGRATION_VERSION, down=down)
        .read_text()
        .lower()
        for down in (False, True)
    ]
    privilege_sql.append(
        (REPO_ROOT / "supabase/tests/results_exploration_scale_cleanup.sql").read_text().lower()
    )
    # fmt: off
    ordered_tokens = "lock table public.review_item;set role workspace_review_ingest_owner;lock table workspace_private.review_item_context".split(";")  # noqa: E501
    bridge = "workspace_review_context_migrator"
    bridge_tokens = f"create role {bridge} nologin noinherit;grant workspace_review_ingest_owner to {bridge} with inherit false, set true;grant {bridge} to current_user with inherit false, set true;revoke {bridge} from current_user;revoke workspace_review_ingest_owner from {bridge};drop role {bridge}".split(";")  # noqa: E501
    # fmt: on
    forbidden_membership = r"(?:grant workspace_review_ingest_owner to|revoke workspace_review_ingest_owner from) (?:current_user|%i)"  # noqa: E501
    for migration_sql in privilege_sql:
        assert (positions := list(map(migration_sql.index, ordered_tokens))) == sorted(positions)
        assert all(token in migration_sql for token in bridge_tokens)
        assert migration_sql.count(f"to_regrole('{bridge}')") >= 2
        assert not re.search(forbidden_membership, migration_sql)
        assert "pg_has_role" not in migration_sql
    for migration_sql in privilege_sql[:2]:
        assert "set role postgres" in migration_sql and "reset role" not in migration_sql
    assert "reset role" in privilege_sql[2]
    assert "['election','category','archive_entry']" in privilege_sql[0]
    assert "references_'||relation_name" in privilege_sql[0]
    assert "grant references" in privilege_sql[0] and "revoke references" in privilege_sql[0]
    for unsupported in (
        39,
        "0039",
        "20260824193651",
        "20260825165117",
        "20260825180049",
        "20260826033131",
    ):
        with pytest.raises(ValueError, match="1 through 38"):
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


def test_0029_through_pba_mapping_forward_down_reapply_preserve_history_and_indexes() -> None:
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


# fmt: off
def test_authorized_official_operations_preserve_independent_section_scope_semantics() -> None:
    database_dsn = os.environ.get("ETL_TEST_DATABASE_URL")
    if not database_dsn:
        pytest.skip("ETL_TEST_DATABASE_URL is required for authorized operation coverage")
    params = conninfo_to_dict(database_dsn); params["user"] = "postgres"; params.pop("password", None)  # noqa: E501, E702
    admin_dsn = make_conninfo(**{key: str(value) for key, value in params.items()})
    user_id, election_id, category_id, exact_j, other_j, coarse_j, org_one, org_two, session_one, session_two = (uuid.uuid4() for _ in range(10))  # noqa: E501
    result_args = [election_id, category_id, "02", "027", None, None, None, "seccion"]
    comparison_args = [*result_args, election_id, category_id, "02", "028", None, None, None, "seccion"]  # noqa: E501
    created_scopes: list[tuple[str, str]] = []

    def rpc(session_id: uuid.UUID, name: str, args: list[object]) -> dict[str, object]:
        assert name in {"official_result", "official_comparison", "official_reference"}
        claims = json.dumps({"sub": str(user_id), "session_id": str(session_id), "exp": 253402300798})  # noqa: E501
        with psycopg.connect(admin_dsn) as connection:
            connection.execute("select set_config('request.jwt.claims',%s,false)", (claims,)); connection.execute("set role authenticated")  # noqa: E501, E702
            row = connection.execute(f"select workspace_api.{name}({','.join(['%s'] * len(args))})", args).fetchone()  # noqa: E501, S608
            assert row is not None and isinstance(row[0], dict); return row[0]  # noqa: E702

    try:
        with psycopg.connect(admin_dsn) as connection:
            connection.execute("insert into election(id,year,round) values(%s,2098,%s)", (election_id, f"operations-{election_id.hex}")); connection.execute("insert into category(id,name) values(%s,%s)", (category_id, f"operations-{category_id.hex}"))  # noqa: E501, E702
            connection.cursor().executemany("insert into jurisdiction(id,distrito_code,seccion_code,seccion_name) values(%s,%s,%s,%s)", [(exact_j,"02","027","Exact"),(other_j,"02","028","Other"),(coarse_j,"02",None,None)])  # noqa: E501
            connection.cursor().executemany("insert into result_row(election_id,jurisdiction_id,category_id,granularity,list_id,votes,source_kind,archive_entry_id,source_row_index) values(%s,%s,%s,%s,%s,%s,%s,%s,%s)", [(election_id,exact_j,category_id,"distrito","A",1,"official","pba/2098-distrito-027",1),(election_id,exact_j,category_id,"distrito","A2",2,"official","pba/2098-distrito-027",2),(election_id,exact_j,category_id,"distrito","A",100,"fiscalizacion","fixture-fiscal",3),(election_id,other_j,category_id,"seccion","B",4,"official","national/2098",4)])  # noqa: E501
            connection.execute("set role workspace_admin_owner"); connection.cursor().executemany("insert into workspace_private.organization(id,slug,display_name,entitlement_revision) values(%s,%s,%s,1)", [(org_one,f"operations-{org_one.hex}","Fixture One"),(org_two,f"operations-{org_two.hex}","Fixture Two")]); connection.cursor().executemany("insert into workspace_private.organization_membership(organization_id,user_id,membership_revision) values(%s,%s,1)", [(org_one,user_id),(org_two,user_id)])  # noqa: E501, E702
            for scope in (("02","027"),("02","028")):
                if connection.execute("insert into workspace_private.section_scope values(%s,%s) on conflict do nothing returning distrito_code", scope).fetchone(): created_scopes.append(scope)  # noqa: E501, E701
            connection.cursor().executemany("insert into workspace_private.organization_section_entitlement(organization_id,distrito_code,seccion_code) values(%s,%s,%s)", [(org_one,"02","027"),(org_two,"02","028")])  # noqa: E501
            connection.execute("set role workspace_context_owner"); connection.cursor().executemany("insert into workspace_private.workspace_context(session_id,user_id,organization_id,membership_revision,entitlement_revision,context_revision,fixed_expires_at) values(%s,%s,%s,1,1,1,'2100-01-01')", [(session_one,user_id,org_one),(session_two,user_id,org_two)])  # noqa: E501, E702
        exact = rpc(session_one, "official_result", result_args)
        assert exact["total_votes"] == 3 and exact["source_granularity"] == "seccion" and len(exact["parties"]) == 2 and sorted(p["votes"] for p in exact["parties"]) == [1, 2]  # noqa: E501
        assert rpc(session_one, "official_result", [*result_args[:3], "028", *result_args[4:]])["authorization_status"] == "scope_denied"  # noqa: E501
        reference = rpc(session_one, "official_reference", result_args[:4]); assert reference["source_exclusions"] == [{"kind":"fiscalizacion","reason":"non_official_source","rows":1}] and "votes" not in json.dumps(reference["source_exclusions"])  # noqa: E501, E702
        denied = rpc(session_one, "official_comparison", comparison_args); assert denied == {"status":"authorization_denied","side":"right","authorization_status":"scope_denied","truncated":False} and "left" not in denied  # noqa: E501, E702
        opposite = rpc(session_two, "official_comparison", comparison_args); assert opposite["side"] == "left" and not ({"left", "right"} & opposite.keys())  # noqa: E501, E702
        with psycopg.connect(admin_dsn) as connection:
            connection.execute("insert into result_row(election_id,jurisdiction_id,category_id,granularity,list_id,votes,source_kind,archive_entry_id,source_row_index) values(%s,%s,%s,'distrito','C',90,'official','national/2098-coarse',5)", (election_id,coarse_j,category_id))  # noqa: E501
        coarse = rpc(session_one, "official_result", result_args)
        assert coarse["status"] == "source_unavailable" and coarse["exclusions"] == [{"reason":"official_rows_without_section_identity"}] and coarse["truncated"] is False and not ({"total_votes", "parties", "rows", "votes"} & coarse.keys())  # noqa: E501
        unavailable = rpc(session_one, "official_comparison", [*result_args, *result_args]); assert unavailable == {"status":"operation_unavailable","side":"left","operation_status":"source_unavailable","truncated":False} and not ({"left", "right"} & unavailable.keys())  # noqa: E501, E702
    finally:
        with psycopg.connect(admin_dsn) as connection:
            connection.execute("delete from workspace_private.workspace_context where session_id=any(%s)", ([session_one,session_two],)); connection.execute("delete from workspace_private.organization_section_entitlement where organization_id=any(%s)", ([org_one,org_two],)); connection.execute("delete from workspace_private.organization_membership where organization_id=any(%s)", ([org_one,org_two],)); connection.execute("delete from workspace_private.organization where id=any(%s)", ([org_one,org_two],)); connection.execute("delete from result_row where election_id=%s", (election_id,)); connection.execute("delete from jurisdiction where id=any(%s)", ([exact_j,other_j,coarse_j],)); connection.execute("delete from category where id=%s", (category_id,)); connection.execute("delete from election where id=%s", (election_id,)); connection.cursor().executemany("delete from workspace_private.section_scope where distrito_code=%s and seccion_code=%s", created_scopes)  # noqa: E501, E702
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
    original_review_context_level = _review_context_migration_level(admin_dsn)
    rolled_back_workspace_versions: list[str] = []

    def roll_back_workspace(version: str) -> None:
        _apply_down_migration(admin_dsn, version)
        rolled_back_workspace_versions.append(version)

    def restore_workspace() -> None:
        while rolled_back_workspace_versions:
            _apply_migration(admin_dsn, rolled_back_workspace_versions[-1])
            rolled_back_workspace_versions.pop()

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
            "where granted.rolname in "
            "('workspace_admin_owner','workspace_audit_owner','workspace_query_owner') "
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
        _set_latest_review_context_level(admin_dsn, 0)
        roll_back_workspace(CANONICAL_AUTHORIZED_OFFICIAL_FACET_METADATA_MIGRATION_VERSION)
        roll_back_workspace(AUTHORIZED_SCHOOL_PARTY_LOOKUP_MIGRATION_VERSION)
        with psycopg.connect(admin_dsn) as connection:
            assert connection.execute(
                "select has_table_privilege("
                "'workspace_query_owner','public.party_mapping','SELECT'),"
                "has_table_privilege("
                "'workspace_query_owner','public.party_canonical','SELECT'),"
                "(select count(*) from pg_policies where schemaname='public' "
                "and tablename in ('party_mapping','party_canonical') "
                "and policyname like 'workspace_query_owner_party_%')"
            ).fetchone() == (False, False, 0)
        for version in (
            AUTHORIZED_OFFICIAL_DRILLDOWN_FACETS_MIGRATION_VERSION,
            AUTHORIZED_FISCALIZACION_FACETS_MIGRATION_VERSION,
            PLATFORM_REVIEW_OPERATOR_MIGRATION_VERSION,
            AUTHORIZED_FISCAL_RESULT_MIGRATION_VERSION,
            AUTHORIZED_FISCAL_COVERAGE_MIGRATION_VERSION,
            AUTHORIZED_FISCAL_REVIEW_MIGRATION_VERSION,
            AUTHORIZED_OFFICIAL_PROJECTIONS_MIGRATION_VERSION,
            AUTHORIZED_OFFICIAL_OPERATIONS_MIGRATION_VERSION,
            AUTHORIZED_OFFICIAL_FACETS_MIGRATION_VERSION,
            STRUCTURED_REVIEW_SCOPE_MIGRATION_VERSION,
            WORKSPACE_SELECTION_MIGRATION_VERSION,
            WORKSPACE_CONTEXT_MIGRATION_VERSION,
        ):
            roll_back_workspace(version)
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
        roll_back_workspace(WORKSPACE_ADMIN_MIGRATION_VERSION)
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
        restore_workspace()
        with psycopg.connect(admin_dsn) as connection:
            assert connection.execute(membership_sql).fetchall() == role_edges_before
            assert connection.execute(
                "select lower(pg_get_functiondef("
                "'workspace_api.official_facets(uuid,uuid,text,text,text,text)'::regprocedure)) "
                "like '%authorized_names as materialized%'"
            ).fetchone() == (True,)
            assert connection.execute(
                "select has_table_privilege("
                "'workspace_query_owner','public.party_mapping','SELECT'),"
                "has_table_privilege("
                "'workspace_query_owner','public.party_canonical','SELECT'),"
                "has_table_privilege('authenticated','public.party_mapping','SELECT'),"
                "has_table_privilege('authenticated','public.party_canonical','SELECT'),"
                "not exists(select from "
                "unnest(array['anon','service_role']) r,"
                "unnest(array['party_mapping','party_canonical']) t "
                "where to_regrole(r) is not null "
                "and has_table_privilege(r,'public.'||t,'SELECT')),(select count(*) "
                "from pg_policies where schemaname='public' "
                "and tablename in ('party_mapping','party_canonical') "
                "and cmd='SELECT' and roles=array['workspace_query_owner']::name[] "
                "and qual='true' and with_check is null)"
            ).fetchone() == (True, True, False, False, True, 2)
            assert connection.execute(
                "select to_regprocedure('workspace_private.create_organization"
                "(text,text,text,text)') is not null,"
                "to_regprocedure('workspace_api.invalidate_workspace_context()') is not null"
            ).fetchone() == (True, True)
    finally:
        restore_workspace()
        _set_latest_review_context_level(admin_dsn, original_review_context_level)
        with psycopg.connect(admin_dsn) as connection:
            admin_installed, context_installed, selection_installed, lookup_installed = (
                connection.execute(
                    "select to_regprocedure('workspace_private.create_organization"
                    "(text,text,text,text)') is not null,"
                    "to_regprocedure("
                    "'workspace_api.invalidate_workspace_context()') is not null,"
                    "to_regprocedure('workspace_api.current_workspace()') is not null,"
                    "has_table_privilege("
                    "'workspace_query_owner','public.party_mapping','SELECT')"
                ).fetchone()
            )
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
        if not lookup_installed:
            _apply_migration(admin_dsn, AUTHORIZED_SCHOOL_PARTY_LOOKUP_MIGRATION_VERSION)
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


def test_authorized_review_facade_filters_platform_and_other_section_rows() -> None:
    database_dsn = os.environ.get("ETL_TEST_DATABASE_URL")
    if not database_dsn:
        pytest.skip("ETL_TEST_DATABASE_URL is required for authorized review coverage")
    params = conninfo_to_dict(database_dsn)
    params["user"] = "postgres"
    params.pop("password", None)
    admin_dsn = make_conninfo(**{key: str(value) for key, value in params.items()})  # noqa: E501, E702
    user_id, org, empty_org, session, empty_session = (uuid.uuid4() for _ in range(5))
    prefix = f"review-{uuid.uuid4().hex}"
    created_scopes: list[tuple[str, str]] = []  # noqa: E501, E702

    def rpc(session_id: uuid.UUID, limit: int = 50, offset: int = 0) -> dict[str, object]:
        claims = json.dumps(
            {"sub": str(user_id), "session_id": str(session_id), "exp": 253402300798}
        )
        with psycopg.connect(admin_dsn) as connection:
            connection.execute("select set_config('request.jwt.claims',%s,true)", (claims,))
            connection.execute("set local role authenticated")
            row = connection.execute(
                "select workspace_api.review_items(%s::integer,%s::integer)", (limit, offset)
            ).fetchone()
            assert row is not None and isinstance(row[0], dict)
            return row[0]

    try:
        with psycopg.connect(admin_dsn) as connection:
            assert connection.info.server_version >= 170000
            connection.execute("set role workspace_admin_owner")
            connection.cursor().executemany(
                "insert into workspace_private.organization(id,slug,display_name,entitlement_revision) values(%s,%s,%s,1)",  # noqa: E501
                [
                    (org, f"review-{org.hex}", "Review"),
                    (empty_org, f"review-{empty_org.hex}", "Empty"),
                ],
            )
            connection.cursor().executemany(
                "insert into workspace_private.organization_membership(organization_id,user_id,membership_revision) values(%s,%s,1)",  # noqa: E501
                [(org, user_id), (empty_org, user_id)],
            )
            for scope in (("02", "027"), ("02", "028")):
                inserted = connection.execute(
                    "insert into workspace_private.section_scope values(%s,%s) on conflict do nothing returning distrito_code",  # noqa: E501
                    scope,
                ).fetchone()
                if inserted:
                    created_scopes.append(scope)
            connection.execute(
                "insert into workspace_private.organization_section_entitlement(organization_id,distrito_code,seccion_code) values(%s,'02','027')",  # noqa: E501
                (org,),
            )
            connection.execute("set role workspace_context_owner")
            connection.cursor().executemany(
                "insert into workspace_private.workspace_context(session_id,user_id,organization_id,membership_revision,entitlement_revision,context_revision,fixed_expires_at) values(%s,%s,%s,1,1,1,'2100-01-01')",  # noqa: E501
                [(session, user_id, org), (empty_session, user_id, empty_org)],
            )
            connection.execute("set role etl_writer")
            connection.execute(
                "select workspace_private.record_review_item('content_drift','warning',%s,null,array[]::text[],array[]::text[])",  # noqa: E501
                (prefix + "-platform",),
            )
            connection.execute(
                "select workspace_private.record_review_item('source_reexported','warning',%s,null,array['02'],array['027'])",  # noqa: E501
                (prefix + "-visible",),
            )
            connection.execute(
                "select workspace_private.record_review_item('duplicate_collapsed','warning',%s,null,array['02'],array['028'])",  # noqa: E501
                (prefix + "-other",),
            )
        # Platform-only and other-section rows are absent even from exclusions: reporting
        # their count would leak their existence across the authorization boundary.
        page = rpc(session, 0, 0)
        assert page == {
            "status": "ok",
            "authorization_status": "authorized",
            "items": [],
            "total": 1,
            "truncated": True,
            "exclusions": [{"reason": "pagination_bound", "rows": 1}],
        }
        listed = rpc(session)
        assert (
            [item["kind"] for item in listed["items"]] == ["source_reexported"]
            and "subject_ref" not in json.dumps(listed)
            and "note" not in json.dumps(listed)
        )  # noqa: E501, E702
        assert rpc(empty_session) == {
            "status": "ok",
            "authorization_status": "authorized_empty",
            "items": [],
            "total": 0,
            "truncated": False,
            "exclusions": [],
        }
        denied = rpc(uuid.uuid4())
        assert (
            denied["status"] == "authorization_denied"
            and denied["authorization_status"] == "context_missing"
            and denied["total"] == 0
        )  # noqa: E501, E702
    finally:
        with psycopg.connect(admin_dsn) as connection:
            connection.execute(
                "delete from workspace_private.workspace_context where session_id=any(%s)",
                ([session, empty_session],),
            )
            connection.execute(
                "delete from workspace_private.organization_section_entitlement where organization_id=%s",  # noqa: E501
                (org,),
            )
            connection.execute(
                "delete from workspace_private.organization_membership where organization_id=any(%s)",  # noqa: E501
                ([org, empty_org],),
            )
            connection.execute(
                "delete from workspace_private.organization where id=any(%s)",
                ([org, empty_org],),
            )
            connection.execute("delete from review_item where subject_ref like %s", (prefix + "%",))
            connection.cursor().executemany(
                "delete from workspace_private.section_scope where distrito_code=%s and seccion_code=%s",  # noqa: E501
                created_scopes,
            )


def test_review_item_context_foundation_runs_as_supabase_temporary_login() -> None:
    database_dsn = os.environ.get("ETL_TEST_DATABASE_URL")
    if not database_dsn:
        pytest.skip("ETL_TEST_DATABASE_URL is required for Supabase migration-runner coverage")
    params = conninfo_to_dict(database_dsn)
    params["user"] = "postgres"
    params.pop("password", None)
    admin_dsn = make_conninfo(**{key: str(value) for key, value in params.items()})
    runner_role = f"votus_supabase_cli_{uuid.uuid4().hex}"
    bridge_role = "workspace_review_context_foundation_migrator"
    original_review_context_level = _review_context_migration_level(admin_dsn)
    runner_created = False

    def authority_snapshot() -> tuple[str | None, list[tuple[object, ...]]]:
        with psycopg.connect(admin_dsn) as connection:
            schema_acl = connection.execute(
                "select nspacl::text from pg_namespace where nspname='workspace_private'"
            ).fetchone()
            assert schema_acl is not None
            memberships = connection.execute(
                "select granted.rolname,member.rolname,grantor.rolname,"
                "m.admin_option,m.inherit_option,m.set_option from pg_auth_members m "
                "join pg_roles granted on granted.oid=m.roleid "
                "join pg_roles member on member.oid=m.member "
                "join pg_roles grantor on grantor.oid=m.grantor "
                "order by 1,2,3,4,5,6"
            ).fetchall()
        return schema_acl[0], memberships

    def assert_no_foundation_state() -> None:
        with psycopg.connect(admin_dsn) as connection:
            assert connection.execute(
                "select to_regclass('workspace_private.review_item_context'),"
                "to_regprocedure('workspace_private.create_unknown_review_item_context()'),"
                "exists(select from pg_trigger where tgrelid='public.review_item'::regclass "
                "and tgname='review_item_context_after_insert'),to_regrole(%s)",
                (bridge_role,),
            ).fetchone() == (None, None, False, None)

    def apply_as_supabase_runner(*, down: bool = False) -> None:
        runner_params = conninfo_to_dict(admin_dsn)
        runner_params["user"] = runner_role
        runner_dsn = make_conninfo(**{key: str(value) for key, value in runner_params.items()})
        migration = _validated_migration_path(
            REVIEW_ITEM_CONTEXT_MIGRATION_VERSION, down=down
        ).read_bytes()
        with psycopg.connect(runner_dsn, autocommit=True) as connection:
            connection.execute("set role postgres")
            connection.execute(migration)

    try:
        _set_latest_review_context_level(admin_dsn, 0)
        with psycopg.connect(admin_dsn) as connection:
            assert connection.execute(
                "select pg_get_userbyid(nspowner),"
                "has_schema_privilege('workspace_review_ingest_owner',oid,'CREATE') "
                "from pg_namespace where nspname='workspace_private'"
            ).fetchone() == ("postgres", False)
            connection.execute(
                sql.SQL("create role {} login noinherit").format(sql.Identifier(runner_role))
            )
            connection.execute(
                sql.SQL("grant postgres to {} with inherit false, set true").format(
                    sql.Identifier(runner_role)
                )
            )
            assert connection.execute(
                "select r.rolcanlogin,r.rolinherit,m.admin_option,m.inherit_option,m.set_option "
                "from pg_roles r join pg_auth_members m on m.member=r.oid "
                "where r.rolname=%s and m.roleid='postgres'::regrole",
                (runner_role,),
            ).fetchone() == (True, False, False, False, True)
        runner_created = True
        baseline_authority = authority_snapshot()

        try:
            apply_as_supabase_runner()
        except psycopg.errors.InsufficientPrivilege:
            assert_no_foundation_state()
            assert authority_snapshot() == baseline_authority
            raise

        with psycopg.connect(admin_dsn) as connection:
            assert connection.execute(
                "select to_regclass('workspace_private.review_item_context') is not null,"
                "to_regrole(%s) is null",
                (bridge_role,),
            ).fetchone() == (True, True)
        assert authority_snapshot() == baseline_authority

        apply_as_supabase_runner(down=True)
        assert_no_foundation_state()
        assert authority_snapshot() == baseline_authority
    finally:
        try:
            if runner_created:
                with psycopg.connect(admin_dsn) as connection:
                    connection.execute(
                        sql.SQL("revoke postgres from {}").format(sql.Identifier(runner_role))
                    )
                    connection.execute(sql.SQL("drop role {}").format(sql.Identifier(runner_role)))
        finally:
            _set_latest_review_context_level(admin_dsn, original_review_context_level)


def test_remaining_review_context_migrations_run_as_supabase_temporary_login() -> None:
    database_dsn = os.environ.get("ETL_TEST_DATABASE_URL")
    if not database_dsn:
        pytest.skip("ETL_TEST_DATABASE_URL is required for Supabase migration-runner coverage")
    params = conninfo_to_dict(database_dsn)
    params["user"] = "postgres"
    params.pop("password", None)
    admin_dsn = make_conninfo(**{key: str(value) for key, value in params.items()})
    runner_role = f"votus_supabase_cli_{uuid.uuid4().hex}"
    remaining_versions = LATEST_REVIEW_CONTEXT_MIGRATION_VERSIONS[1:]
    context_policies = {
        "workspace_review_ingest_owner_context_archive_select",
        "workspace_review_ingest_owner_context_category_select",
        "workspace_review_ingest_owner_context_election_select",
    }
    breakdown_policies = {
        "workspace_review_ingest_owner_breakdown_category_select",
        "workspace_review_ingest_owner_breakdown_election_select",
    }
    all_policies = sorted(context_policies | breakdown_policies)
    original_review_context_level = _review_context_migration_level(admin_dsn)
    runner_created = False

    def stable_authority_snapshot() -> tuple[str | None, list[tuple[object, ...]]]:
        with psycopg.connect(admin_dsn) as connection:
            schema_acl = connection.execute(
                "select nspacl::text from pg_namespace where nspname='workspace_private'"
            ).fetchone()
            assert schema_acl is not None
            memberships = connection.execute(
                "select granted.rolname,member.rolname,grantor.rolname,"
                "m.admin_option,m.inherit_option,m.set_option from pg_auth_members m "
                "join pg_roles granted on granted.oid=m.roleid "
                "join pg_roles member on member.oid=m.member "
                "join pg_roles grantor on grantor.oid=m.grantor "
                "order by 1,2,3,4,5,6"
            ).fetchall()
        return schema_acl[0], memberships

    def table_acl_snapshot() -> list[tuple[str, str | None]]:
        with psycopg.connect(admin_dsn) as connection:
            return connection.execute(
                "select relname,relacl::text from pg_class "
                "where oid=any(array['public.election'::regclass,'public.category'::regclass,"
                "'public.archive_entry'::regclass]) order by relname"
            ).fetchall()

    def assert_level_state(level: int, stable_authority) -> None:
        expected_select_count = 3 if level >= 3 else 0
        expected_policies = set(context_policies) if level >= 3 else set()
        if level == 6:
            expected_policies |= breakdown_policies
        expected_functions = {
            1: (False, False, False),
            2: (False, False, False),
            3: (True, False, False),
            4: (False, True, False),
            5: (False, True, False),
            6: (False, True, True),
        }[level]
        with psycopg.connect(admin_dsn) as connection:
            authority = connection.execute(
                "select to_regrole('workspace_review_context_migrator'),"
                "to_regrole('workspace_review_breakdown_migrator'),"
                "has_schema_privilege('workspace_review_ingest_owner','workspace_private','CREATE'),"
                "has_table_privilege('workspace_review_ingest_owner','public.election','REFERENCES')::int+"
                "has_table_privilege('workspace_review_ingest_owner','public.category','REFERENCES')::int+"
                "has_table_privilege('workspace_review_ingest_owner','public.archive_entry','REFERENCES')::int,"
                "has_table_privilege('workspace_review_ingest_owner','public.election','SELECT')::int+"
                "has_table_privilege('workspace_review_ingest_owner','public.category','SELECT')::int+"
                "has_table_privilege('workspace_review_ingest_owner','public.archive_entry','SELECT')::int"
            ).fetchone()
            assert authority == (None, None, False, 0, expected_select_count)
            policies = connection.execute(
                "select policyname from pg_policies where schemaname='public' "
                "and policyname=any(%s) order by policyname",
                (all_policies,),
            ).fetchall()
            assert tuple(name for (name,) in policies) == tuple(sorted(expected_policies))
            functions = connection.execute(
                "select to_regprocedure('workspace_private.record_review_item_v2"
                "(text,text,text,text,text[],text[],text,text,text,integer,uuid,uuid,text)') "
                "is not null,to_regprocedure('workspace_private.record_review_item_v2"
                "(text,text,text,text,text[],text[],jsonb)') is not null,"
                "to_regprocedure('workspace_private.platform_review_breakdown(integer,integer)') "
                "is not null"
            ).fetchone()
            assert functions == expected_functions
        assert _review_context_migration_level(admin_dsn) == level
        assert stable_authority_snapshot() == stable_authority

    try:
        _set_latest_review_context_level(admin_dsn, 0)
        _apply_migration(admin_dsn, REVIEW_ITEM_CONTEXT_MIGRATION_VERSION)
        assert _review_context_migration_level(admin_dsn) == 1
        with psycopg.connect(admin_dsn) as connection:
            connection.execute(
                sql.SQL("create role {} login noinherit").format(sql.Identifier(runner_role))
            )
            connection.execute(
                sql.SQL("grant postgres to {} with inherit false, set true").format(
                    sql.Identifier(runner_role)
                )
            )
        runner_created = True
        stable_authority = stable_authority_snapshot()
        baseline_table_acls = table_acl_snapshot()
        assert_level_state(1, stable_authority)

        runner_params = conninfo_to_dict(admin_dsn)
        runner_params["user"] = runner_role
        runner_dsn = make_conninfo(**{key: str(value) for key, value in runner_params.items()})
        forward_levels: list[int] = []
        down_levels: list[int] = []
        with psycopg.connect(runner_dsn, autocommit=True) as connection:
            connection.execute("set role postgres")
            assert connection.execute("select session_user,current_user").fetchone() == (
                runner_role,
                "postgres",
            )
            for level, version in enumerate(remaining_versions, start=2):
                connection.execute(_validated_migration_path(version).read_bytes())
                assert connection.execute("select session_user,current_user").fetchone() == (
                    runner_role,
                    "postgres",
                )
                assert_level_state(level, stable_authority)
                forward_levels.append(level)
            for level, version in zip(range(5, 0, -1), reversed(remaining_versions), strict=True):
                connection.execute(_validated_migration_path(version, down=True).read_bytes())
                assert connection.execute("select session_user,current_user").fetchone() == (
                    runner_role,
                    "postgres",
                )
                assert_level_state(level, stable_authority)
                down_levels.append(level)

        assert forward_levels == [2, 3, 4, 5, 6]
        assert down_levels == [5, 4, 3, 2, 1]
        assert table_acl_snapshot() == baseline_table_acls
    finally:
        try:
            if runner_created:
                with psycopg.connect(admin_dsn) as connection:
                    connection.execute(
                        sql.SQL("revoke postgres from {}").format(sql.Identifier(runner_role))
                    )
                    connection.execute(sql.SQL("drop role {}").format(sql.Identifier(runner_role)))
        finally:
            _set_latest_review_context_level(admin_dsn, original_review_context_level)


def test_review_item_context_unknown_foundation_is_reachable_and_reversible() -> None:
    database_dsn = os.environ.get("ETL_TEST_DATABASE_URL")
    if not database_dsn:
        pytest.skip("ETL_TEST_DATABASE_URL is required for review context migration coverage")
    params = conninfo_to_dict(database_dsn)
    params["user"] = "postgres"
    params.pop("password", None)
    admin_dsn = make_conninfo(**{key: str(value) for key, value in params.items()})
    prefix = f"review-context-{uuid.uuid4().hex}"
    backfill_ids = [uuid.uuid4(), uuid.uuid4()]
    direct_id, cascade_id = uuid.uuid4(), uuid.uuid4()
    context_version = REVIEW_ITEM_CONTEXT_MIGRATION_VERSION
    original_review_context_level = _review_context_migration_level(admin_dsn)
    membership_sql = "select admin_option,inherit_option,set_option from pg_auth_members where roleid='workspace_review_ingest_owner'::regrole and member=(select oid from pg_roles where rolname=current_user)"  # noqa: E501
    record_signature = "workspace_private.record_review_item(text,text,text,text,text[],text[])"
    facade_signature = "workspace_api.review_items(integer,integer)"

    def protected_definitions(connection: psycopg.Connection) -> tuple[str, str]:
        row = connection.execute(
            "select pg_get_functiondef(%s::regprocedure),pg_get_functiondef(%s::regprocedure)",
            (record_signature, facade_signature),
        ).fetchone()
        assert row is not None
        return row

    context_insert_sql = (
        "insert into workspace_private.review_item_context"
        "(review_item_id,context_state,unknown_reason) values(%s,'unknown',"
        "'writer_context_not_provided')"
    )
    record_sql = (
        "select workspace_private.record_review_item('content_drift','warning',%s,null,"
        "array[]::text[],array[]::text[])"
    )
    with psycopg.connect(admin_dsn) as connection:
        original_membership = _fetchone(connection, membership_sql)
    try:
        _set_latest_review_context_level(admin_dsn, 0)
        with psycopg.connect(admin_dsn) as connection:
            connection.execute("grant workspace_review_ingest_owner to current_user with admin false,inherit true,set false")  # fmt: skip  # noqa: E501
            before_definitions = protected_definitions(connection)
            connection.cursor().executemany(
                "insert into public.review_item(id,kind,severity,subject_ref,tenant_scope_state) "
                "values(%s,%s,%s,%s,'platform_only')",
                [
                    (backfill_ids[0], "content_drift", "warning", prefix + "-backfill-a"),
                    (backfill_ids[1], "duplicate_collapsed", "warning", prefix + "-backfill-b"),
                ],
            )
            total_row = connection.execute("select count(*) from public.review_item").fetchone()
            assert total_row is not None
            total = total_row[0]
        _apply_migration(admin_dsn, REVIEW_ITEM_CONTEXT_MIGRATION_VERSION)
        with psycopg.connect(admin_dsn) as connection:
            assert _fetchone(connection, membership_sql) == (False, True, False)
            assert connection.execute(
                "select column_name,data_type from information_schema.columns "
                "where table_schema='workspace_private' and table_name='review_item_context' "
                "order by ordinal_position"
            ).fetchall() == [
                ("context_id", "uuid"),
                ("review_item_id", "uuid"),
                ("context_state", "text"),
                ("unknown_reason", "text"),
            ]
            assert connection.execute(
                "select count(*),count(distinct review_item_id),"
                "bool_and(context_state='unknown' and unknown_reason='historical_unclassified') "
                "from workspace_private.review_item_context"
            ).fetchone() == (total, total, True)
            for item_id, kind in zip(
                backfill_ids, ("content_drift", "duplicate_collapsed"), strict=True
            ):
                assert connection.execute(
                    "select r.kind,r.severity,c.unknown_reason from public.review_item r "
                    "join workspace_private.review_item_context c on c.review_item_id=r.id "
                    "where r.id=%s",
                    (item_id,),
                ).fetchone() == (kind, "warning", "historical_unclassified")
            assert connection.execute(
                "select relrowsecurity,relforcerowsecurity,"
                "(select count(*) from pg_policies where schemaname='workspace_private' "
                "and tablename='review_item_context' "
                "and roles=array['workspace_review_ingest_owner']::name[]),"
                "(select pg_get_triggerdef(oid) like "
                "'CREATE TRIGGER review_item_context_after_insert AFTER INSERT%' "
                "from pg_trigger where tgrelid='public.review_item'::regclass "
                "and tgname='review_item_context_after_insert') "
                "from pg_class where oid='workspace_private.review_item_context'::regclass"
            ).fetchone() == (True, True, 1, True)
            assert protected_definitions(connection) == before_definitions
            connection.cursor().executemany(
                "insert into public.review_item(id,kind,severity,subject_ref,tenant_scope_state) "
                "values(%s,'content_drift','warning',%s,'platform_only')",
                [(direct_id, prefix + "-direct"), (cascade_id, prefix + "-cascade")],
            )
            assert connection.execute(
                "select count(*) from workspace_private.review_item_context "
                "where review_item_id=any(%s) and context_state='unknown' "
                "and unknown_reason='writer_context_not_provided'",
                ([direct_id, cascade_id],),
            ).fetchone() == (2,)
            connection.execute("delete from public.review_item where id=%s", (cascade_id,))
            assert connection.execute(
                "select count(*) from workspace_private.review_item_context "
                "where review_item_id=%s",
                (cascade_id,),
            ).fetchone() == (0,)
            connection.execute("set role etl_writer")
            record_args = (prefix + "-record",)
            for expected in (True, False):
                assert connection.execute(record_sql, record_args).fetchone() == (expected,)
            connection.execute("reset role")
            assert connection.execute(
                "select count(*),count(c.context_id),min(c.unknown_reason) "
                "from public.review_item r join workspace_private.review_item_context c "
                "on c.review_item_id=r.id where r.subject_ref=%s",
                record_args,
            ).fetchone() == (1, 1, "writer_context_not_provided")
            for assignment in ("context_state='observed'", "unknown_reason='future_reason'"):
                with pytest.raises(psycopg.errors.CheckViolation):
                    with connection.transaction():
                        connection.execute(
                            f"update workspace_private.review_item_context set {assignment} "
                            "where review_item_id=%s",
                            (direct_id,),
                        )  # noqa: S608
            with pytest.raises(psycopg.errors.UniqueViolation):
                with connection.transaction():
                    connection.execute(context_insert_sql, (direct_id,))
        for role in (
            "anon authenticated service_role etl_writer workspace_query_owner "
            "workspace_admin_owner workspace_platform_admin"
        ).split():
            with psycopg.connect(admin_dsn) as connection:
                if connection.execute("select to_regrole(%s)", (role,)).fetchone() == (None,):
                    continue
                assert connection.execute(
                    "select not has_table_privilege(%s,'workspace_private.review_item_context',"
                    "'SELECT,INSERT,UPDATE,DELETE')",
                    (role,),
                ).fetchone() == (True,)
                with pytest.raises(psycopg.errors.InsufficientPrivilege):
                    with connection.transaction():
                        connection.execute(
                            sql.SQL("set local role {}").format(sql.Identifier(role))
                        )
                        connection.execute(context_insert_sql, (direct_id,))
        down_sql = _validated_migration_path(context_version, down=True).read_bytes()
        with psycopg.connect(admin_dsn) as connection:
            with pytest.raises(psycopg.errors.CheckViolation, match="unexpected state or reason"):
                with connection.transaction():
                    connection.execute(
                        "alter table workspace_private.review_item_context "
                        "drop constraint review_item_context_state_check, "
                        "drop constraint review_item_context_unknown_reason_check"
                    )
                    connection.execute(
                        "update workspace_private.review_item_context set context_state='observed',"
                        "unknown_reason='future_reason' where review_item_id=%s",
                        (direct_id,),
                    )
                    connection.execute(down_sql)
        _apply_down_migration(admin_dsn, REVIEW_ITEM_CONTEXT_MIGRATION_VERSION)
        with psycopg.connect(admin_dsn) as connection:
            assert _fetchone(connection, membership_sql) == (False, True, False)
            assert connection.execute(
                "select to_regclass('workspace_private.review_item_context'),"
                "to_regprocedure('workspace_private.create_unknown_review_item_context()')"
            ).fetchone() == (None, None)
            assert protected_definitions(connection) == before_definitions
            for item_id, kind in zip(
                [*backfill_ids, direct_id],
                ("content_drift", "duplicate_collapsed", "content_drift"),
                strict=True,
            ):
                assert connection.execute(
                    "select kind,severity from public.review_item where id=%s", (item_id,)
                ).fetchone() == (kind, "warning")
        _apply_migration(admin_dsn, REVIEW_ITEM_CONTEXT_MIGRATION_VERSION)
        with psycopg.connect(admin_dsn) as connection:
            assert connection.execute(
                "select count(*),count(distinct c.review_item_id) from public.review_item r "
                "join workspace_private.review_item_context c on c.review_item_id=r.id "
                "where r.subject_ref like %s",
                (prefix + "%",),
            ).fetchone() == (4, 4)
    finally:
        try:
            with psycopg.connect(admin_dsn) as connection:
                connection.execute(
                    "delete from public.review_item where subject_ref like %s", (prefix + "%",)
                )
                if original_membership is None:
                    connection.execute("revoke workspace_review_ingest_owner from current_user")
                else:
                    connection.execute("grant workspace_review_ingest_owner to current_user with admin {},inherit {},set {}".format(*map(str.lower, map(str, original_membership))))  # fmt: skip  # noqa: E501
        finally:
            _set_latest_review_context_level(admin_dsn, original_review_context_level)


def test_historical_review_contexts_are_classified_by_kind_without_parsing_subject_ref() -> None:
    database_dsn = os.environ.get("ETL_TEST_DATABASE_URL")
    if not database_dsn:
        pytest.skip("ETL_TEST_DATABASE_URL is required for review context migration coverage")
    params = conninfo_to_dict(database_dsn)
    params.update(user="postgres")
    params.pop("password", None)  # noqa: E501, E702
    admin_dsn = make_conninfo(**{key: str(value) for key, value in params.items()})
    version = REVIEW_CONTEXT_CLASSIFICATION_MIGRATION_VERSION
    prefix = f"classified-context-{uuid.uuid4().hex}"
    archive_id = prefix + "-archive"
    kinds = "blank_vote_cell duplicate_collapsed mesa_absent_from_official_import mesa_discontinuity mesa_tally_divergence content_drift".split()  # noqa: E501
    ids, direct_id = [uuid.uuid4() for _ in kinds], uuid.uuid4()
    membership_sql = "select admin_option,inherit_option,set_option from pg_auth_members where roleid='workspace_review_ingest_owner'::regrole and member=(select oid from pg_roles where rolname=current_user)"  # noqa: E501
    capability_sql = "select (select jsonb_build_array(admin_option,inherit_option,set_option) from pg_auth_members where roleid='workspace_review_ingest_owner'::regrole and member=(select oid from pg_roles where rolname=current_user)),has_table_privilege('workspace_review_ingest_owner','public.election','REFERENCES'),has_table_privilege('workspace_review_ingest_owner','public.category','REFERENCES'),has_table_privilege('workspace_review_ingest_owner','public.archive_entry','REFERENCES'),has_schema_privilege('workspace_review_ingest_owner','workspace_private','CREATE')"  # noqa: E501
    insert_reviews_sql = "insert into public.review_item(id,kind,severity,subject_ref,tenant_scope_state) values(%s,%s,'warning',%s,'platform_only')"  # noqa: E501
    snapshot_sql = "select coalesce(sum(n),0),jsonb_agg(jsonb_build_array(kind,severity,n) order by kind,severity) from(select kind,severity,count(*) n from public.review_item group by kind,severity)s"  # noqa: E501
    null_ids_sql = "select count(*) from workspace_private.review_item_context where review_item_id=any(%s) and (election_year is not null or election_id is not null or category_id is not null or archive_entry_id is not null)"  # noqa: E501
    counts_sql = "select count(*)=(select count(*)+(select count(*) from public.review_item where kind='mesa_tally_divergence') from public.review_item),count(distinct review_item_id)=(select count(*) from public.review_item) from workspace_private.review_item_context"  # noqa: E501
    future_sql = "insert into public.review_item(id,kind,severity,subject_ref,tenant_scope_state) values(%s,'content_drift','warning',%s,'platform_only')"  # noqa: E501
    future_context_sql = "select context_role,source_kind,archive_availability,unknown_reason,count(*) from workspace_private.review_item_context where review_item_id=%s group by 1,2,3,4"  # noqa: E501
    collapse_sql = "select count(*),count(distinct review_item_id),count(*) filter(where unknown_reason='writer_context_not_provided'),count(*) filter(where unknown_reason is null) from workspace_private.review_item_context"  # noqa: E501
    columns_sql = "select to_jsonb(array_agg(column_name order by ordinal_position)) from information_schema.columns where table_schema='workspace_private' and table_name='review_item_context'"  # noqa: E501
    nullability_sql = "select is_nullable from information_schema.columns where table_schema='workspace_private' and table_name='review_item_context' and column_name='unknown_reason'"  # noqa: E501
    contexts = (
        "select count(*)from workspace_private.review_item_context where review_item_id=any(%s)"  # noqa: E501
    )
    grant = "grant workspace_review_ingest_owner to current_user with admin {},inherit {},set {}"  # noqa: E501
    delete_sql = "delete from public.review_item where subject_ref like %s"
    foundation_columns = ["context_id", "review_item_id", "context_state", "unknown_reason"]

    def set_membership(connection, options):
        if options is None:
            connection.execute("revoke workspace_review_ingest_owner from current_user")
        else:
            connection.execute(grant.format(*map(str.lower, map(str, options))))

    original_review_context_level = _review_context_migration_level(admin_dsn)
    with psycopg.connect(admin_dsn) as connection:
        original_membership = connection.execute(membership_sql).fetchone()
    try:
        _set_latest_review_context_level(admin_dsn, 1)
        with psycopg.connect(admin_dsn) as connection:
            set_membership(connection, (False, True, False))
            connection.execute(
                "insert into public.archive_entry(id,capability,source,source_url,mime,fetched_at,status) values(%s,'review-context-test','fixture','https://example.invalid/review-context','application/json',now(),'ok')",  # noqa: E501
                (archive_id,),
            )
            fake_ref = f"{prefix}-year:2099/archive/private-list-"
            subjects = (fake_ref + str(index) for index in range(len(kinds)))
            cursor = connection.cursor()
            cursor.executemany(insert_reviews_sql, zip(ids, kinds, subjects, strict=True))
            before = _fetchone(connection, snapshot_sql)
            capabilities_before = _fetchone(connection, capability_sql)
            assert before is not None and capabilities_before is not None
            assert capabilities_before[0] == [False, True, False]
        _apply_migration(admin_dsn, version)
        with psycopg.connect(admin_dsn) as connection:
            assert connection.execute(snapshot_sql).fetchone() == before
            assert _fetchone(connection, capability_sql) == capabilities_before
            assert _fetchone(connection, nullability_sql) == ("YES",)
            mapping_sql = "select r.kind,c.context_role,c.source_kind,c.archive_availability,c.unknown_reason from public.review_item r join workspace_private.review_item_context c on c.review_item_id=r.id where r.id=any(%s) order by r.kind,c.context_role,c.source_kind"  # noqa: E501
            mapping_rows = "blank_vote_cell|observed|fiscalizacion|unknown|historical_archive_not_linked;content_drift|unknown|unknown|unknown|historical_unclassified;duplicate_collapsed|observed|fiscalizacion|unknown|historical_archive_not_linked;mesa_absent_from_official_import|observed|fiscalizacion|unknown|historical_archive_not_linked;mesa_discontinuity|observed|official|unknown|historical_archive_not_linked;mesa_tally_divergence|comparison|official|unknown|historical_archive_not_linked;mesa_tally_divergence|observed|fiscalizacion|unknown|historical_archive_not_linked"  # noqa: E501
            expected = [tuple(row.split("|")) for row in mapping_rows.split(";")]
            assert connection.execute(mapping_sql, (ids,)).fetchall() == expected
            assert _fetchone(connection, null_ids_sql, (ids,)) == (0,)
            assert _fetchone(connection, counts_sql) == (True, True)
            connection.execute(future_sql, (direct_id, prefix + "-future"))
            # fmt: off
            assert _fetchone(connection, future_context_sql, (direct_id,)) == ("unknown", "unknown", "unknown", "writer_context_not_provided", 1)  # noqa: E501
            connection.execute("insert into workspace_private.review_item_context(review_item_id,context_role,source_kind,archive_availability,archive_entry_id,unknown_reason) values(%s,'observed','official','available',%s,null)", (direct_id, archive_id))  # noqa: E501
            insert_duplicate = "insert into workspace_private.review_item_context(review_item_id,context_role,source_kind,archive_availability,unknown_reason) values(%s,'unknown','unknown','unknown','writer_context_not_provided')"  # noqa: E501
            for error, statement, parameters in (
                (psycopg.errors.UniqueViolation, insert_duplicate, (direct_id,)),
                (psycopg.errors.CheckViolation, "update workspace_private.review_item_context set unknown_reason=null where review_item_id=%s", (direct_id,)),  # noqa: E501
                (psycopg.errors.ForeignKeyViolation, "update workspace_private.review_item_context set election_id=%s where review_item_id=%s", (uuid.uuid4(), direct_id)),  # noqa: E501
            ):
                with pytest.raises(error), connection.transaction():
                    connection.execute(statement, parameters)
        down_sql = _validated_migration_path(version, down=True).read_bytes()
        # fmt: off
        with pytest.raises(psycopg.errors.CheckViolation, match="non_reconstructible_items=.*authoritative_identity_items="):  # noqa: E501
            _apply_down_migration(admin_dsn, version)
        with psycopg.connect(admin_dsn) as connection:
            assert _fetchone(connection, "select count(*) from workspace_private.review_item_context where review_item_id=%s", (direct_id,)) == (2,)  # noqa: E501
            connection.execute("delete from workspace_private.review_item_context where review_item_id=%s and archive_entry_id=%s", (direct_id, archive_id))  # noqa: E501
            # fmt: on
            connection.execute(down_sql)
            assert _fetchone(connection, collapse_sql) == (before[0] + 1, before[0] + 1, 1, 0)
            assert _fetchone(connection, columns_sql) == (foundation_columns,)
            assert _fetchone(connection, nullability_sql) == ("NO",)
            assert _fetchone(connection, capability_sql) == capabilities_before
        _apply_migration(admin_dsn, version)
        with psycopg.connect(admin_dsn) as connection:
            assert _fetchone(connection, capability_sql) == capabilities_before
            assert _fetchone(connection, nullability_sql) == ("YES",)
            assert _fetchone(connection, contexts, ([*ids, direct_id],)) == (8,)
    finally:
        try:
            with psycopg.connect(admin_dsn) as connection:
                connection.execute(delete_sql, (prefix + "%",))
                connection.execute("delete from public.archive_entry where id=%s", (archive_id,))
                set_membership(connection, original_membership)
        finally:
            _set_latest_review_context_level(admin_dsn, original_review_context_level)


# fmt: off
def test_record_review_item_v2_handles_replay_fallback_conflicts_and_rollback() -> None:
    if not (database_dsn := os.environ.get("ETL_TEST_DATABASE_URL")):
        pytest.skip("ETL_TEST_DATABASE_URL is required for review writer v2 coverage")
    admin_dsn = make_conninfo(**(conninfo_to_dict(database_dsn) | {"user": "postgres"}))
    original_review_context_level = _review_context_migration_level(admin_dsn)
    legacy, core, v2 = "workspace_private.record_review_item(text,text,text,text,text[],text[]);workspace_private.record_review_item_core(text,text,text,text,text[],text[]);workspace_private.record_review_item_v2(text,text,text,text,text[],text[],text,text,text,integer,uuid,uuid,text)".split(";")  # noqa: E501
    call, legacy_call, context_sql = "select workspace_private.record_review_item_v2('blank_vote_cell','info',%s,null,array[]::text[],array[]::text[],'observed','fiscalizacion','available',%s,%s,%s,%s);select workspace_private.record_review_item('blank_vote_cell','info',%s,null,array[]::text[],array[]::text[]);select context_role,source_kind,archive_availability,election_year,election_id,category_id,archive_entry_id,unknown_reason from workspace_private.review_item_context c join review_item r on r.id=c.review_item_id where r.subject_ref=%s".split(";")  # noqa: E501
    applied = False
    fixtures_committed = False
    try:
        _set_latest_review_context_level(admin_dsn, 2)
        with psycopg.connect(admin_dsn) as connection:
            before_context_count = _fetchone(connection, "select count(*) from workspace_private.review_item_context")[0]  # noqa: E501
        _apply_migration(admin_dsn, RECORD_REVIEW_ITEM_V2_MIGRATION_VERSION)
        applied = True
        with psycopg.connect(admin_dsn) as connection:
            assert _fetchone(connection, "select count(*) from pg_policies where policyname in ('workspace_review_ingest_owner_context_election_select','workspace_review_ingest_owner_context_category_select','workspace_review_ingest_owner_context_archive_select')") == (3,)  # noqa: E501
            election_id = _fetchone(connection, "insert into election(year,round) values(2097,%s) returning id", ((prefix := f"v2-{uuid.uuid4()}"),))[0]  # noqa: E501
            category_ids = [_fetchone(connection, "insert into category(name) values(%s) returning id", (name,))[0] for name in (prefix, prefix + "-other")]  # noqa: E501
            archive_ids = [prefix + suffix for suffix in ("-ok", "-status", "-source")]
            connection.cursor().executemany("insert into archive_entry(id,capability,source,source_url,mime,fetched_at,status,source_kind,notes) values(%s,'fiscalizacion','test','local://test','text/csv',now(),%s,%s,'test')", [(archive_ids[0], "ok", "fiscalizacion"), (archive_ids[1], "error", "fiscalizacion"), (archive_ids[2], "ok", "official")])  # noqa: E501
            connection.execute("set role etl_writer")

            def read_context(subject: str):
                connection.execute("reset role")
                try:
                    return _fetchone(connection, context_sql, (subject,))
                finally:
                    connection.execute("set role etl_writer")

            exact = (prefix, 2097, election_id, category_ids[0], archive_ids[0])
            explicit = ("observed", "fiscalizacion", "available", *exact[1:], None)
            assert (_fetchone(connection, call, exact), _fetchone(connection, call, exact)) == ((True,), (False,))  # noqa: E501
            assert read_context(prefix) == explicit
            legacy_subject = prefix + "-legacy"
            assert _fetchone(connection, legacy_call, (legacy_subject,)) == (True,)
            assert read_context(legacy_subject) == ("unknown", "unknown", "unknown", None, None, None, None, "writer_context_not_provided")  # noqa: E501
            assert _fetchone(connection, call, (legacy_subject, *exact[1:])) == (False,)
            assert read_context(legacy_subject) == explicit
            metadata_subject = prefix + "-metadata"
            assert _fetchone(connection, legacy_call, (metadata_subject,)) == (True,)
            connection.execute("reset role")
            connection.execute("update workspace_private.review_item_context set election_year=%s,election_id=%s,category_id=%s where review_item_id=(select id from review_item where subject_ref=%s)", (2097, election_id, category_ids[0], metadata_subject))  # noqa: E501
            connection.execute("set role etl_writer")
            with pytest.raises(psycopg.errors.CheckViolation), connection.transaction():
                connection.execute(call, (metadata_subject, *exact[1:]))
            assert read_context(metadata_subject) == ("unknown", "unknown", "unknown", 2097, election_id, category_ids[0], None, "writer_context_not_provided")  # noqa: E501
            ambiguous_subject = prefix + "-ambiguous"
            ambiguous_ids = [uuid.uuid4(), uuid.uuid4()]
            connection.execute("reset role")
            connection.cursor().executemany(
                "insert into public.review_item"
                "(id,kind,severity,subject_ref,note,tenant_scope_state) "
                "values(%s,'blank_vote_cell','info',%s,null,'platform_only')",
                [(item_id, ambiguous_subject) for item_id in ambiguous_ids],
            )
            ambiguity_context_sql = "select review_item_id,context_role,source_kind,archive_availability,election_year,election_id,category_id,archive_entry_id,unknown_reason from workspace_private.review_item_context where review_item_id=any(%s) order by review_item_id"  # noqa: E501
            ambiguity_before = connection.execute(
                ambiguity_context_sql, (ambiguous_ids,)
            ).fetchall()
            assert len(ambiguity_before) == 2
            connection.execute("set role etl_writer")
            for statement, parameters in (
                (call, (ambiguous_subject, *exact[1:])),
                (legacy_call, (ambiguous_subject,)),
            ):
                with pytest.raises(psycopg.errors.CheckViolation, match="active review identity is ambiguous"), connection.transaction():  # noqa: E501
                    connection.execute(statement, parameters)
            connection.execute("reset role")
            assert connection.execute(
                ambiguity_context_sql, (ambiguous_ids,)
            ).fetchall() == ambiguity_before
            assert _fetchone(connection, "select count(*) from public.review_item where subject_ref=%s", (ambiguous_subject,)) == (2,)  # noqa: E501
            connection.execute("set role etl_writer")
            failures = ((prefix + "-year", 2098, election_id, category_ids[0], archive_ids[0]), (prefix + "-status", 2097, election_id, category_ids[0], archive_ids[1]), (prefix + "-source", 2097, election_id, category_ids[0], archive_ids[2]), (prefix + "-category", 2097, election_id, uuid.uuid4(), archive_ids[0]), (prefix, 2097, election_id, category_ids[1], archive_ids[0]))  # noqa: E501
            for parameters in failures:
                with pytest.raises(psycopg.errors.CheckViolation), connection.transaction():
                    connection.execute(call, parameters)
            connection.commit()
            fixtures_committed = True
    finally:
        try:
            if applied:
                _apply_down_migration(admin_dsn, RECORD_REVIEW_ITEM_V2_MIGRATION_VERSION)
                with psycopg.connect(admin_dsn) as connection:
                    assert _fetchone(connection, "select to_regprocedure(%s) is null,to_regprocedure(%s) is null", (core, v2)) == (True, True)  # noqa: E501
                    if not fixtures_committed:
                        assert _fetchone(connection, "select count(*) from workspace_private.review_item_context") == (before_context_count,)  # noqa: E501
                    if fixtures_committed:
                        ambiguity_after_down = connection.execute(
                            ambiguity_context_sql, (ambiguous_ids,)
                        ).fetchall()
                        item_count_after_down = _fetchone(connection, "select count(*) from public.review_item where subject_ref=%s", (ambiguous_subject,))  # noqa: E501
                        assert ambiguity_after_down == ambiguity_before
                        assert item_count_after_down == (2,)
                        connection.execute("set role etl_writer")
                        with pytest.raises(psycopg.errors.CheckViolation, match="active review identity is ambiguous"), connection.transaction():  # noqa: E501
                            connection.execute(legacy_call, (ambiguous_subject,))
                        connection.execute("reset role")
                        assert connection.execute(
                            ambiguity_context_sql, (ambiguous_ids,)
                        ).fetchall() == ambiguity_after_down
                        assert _fetchone(connection, "select count(*) from public.review_item where subject_ref=%s", (ambiguous_subject,)) == item_count_after_down  # noqa: E501
        finally:
            try:
                if fixtures_committed:
                    with psycopg.connect(admin_dsn) as connection:
                        connection.execute("delete from public.review_item where subject_ref like %s", (prefix + "%",))  # noqa: E501
                        connection.execute("delete from public.archive_entry where id=any(%s)", (archive_ids,))  # noqa: E501
                        connection.execute("delete from public.category where id=any(%s)", (category_ids,))  # noqa: E501
                        connection.execute("delete from public.election where id=%s", (election_id,))  # noqa: E501
            finally:
                _set_latest_review_context_level(admin_dsn, original_review_context_level)
# fmt: on


# fmt: off
def test_record_review_item_v2_accepts_exact_context_sets_and_restores_pr3() -> None:
    if not (database_dsn := os.environ.get("ETL_TEST_DATABASE_URL")):
        pytest.skip("ETL_TEST_DATABASE_URL is required for review context-set coverage")
    admin_dsn = make_conninfo(**(conninfo_to_dict(database_dsn) | {"user": "postgres"}))
    scalar = "workspace_private.record_review_item_v2(text,text,text,text,text[],text[],text,text,text,integer,uuid,uuid,text" + ")"  # noqa: E501
    vector = "workspace_private.record_review_item_v2(text,text,text,text,text[],text[],jsonb)"
    original_review_context_level = _review_context_migration_level(admin_dsn)
    prefix, applied = f"contexts-{uuid.uuid4()}", False
    try:
        _set_latest_review_context_level(admin_dsn, 3)
        with psycopg.connect(admin_dsn) as connection:
            scalar_before = _fetchone(connection, "select pg_get_functiondef(%s::regprocedure)", (scalar,))[0]  # noqa: E501
        _apply_migration(admin_dsn, RECORD_REVIEW_ITEM_CONTEXTS_MIGRATION_VERSION)
        applied = True
        with psycopg.connect(admin_dsn) as connection:
            election_id = _fetchone(connection, "insert into election(year,round) values(2096,%s) returning id", (prefix,))[0]  # noqa: E501
            category_id = _fetchone(connection, "insert into category(name) values(%s) returning id", (prefix,))[0]  # noqa: E501
            fiscal, official = prefix + "-fiscal", prefix + "-official"
            archive_sql = "insert into archive_entry(id,capability,source,source_url,mime,fetched_at,status,source_kind,notes) values(%s,%s,'test','local://test','text/csv',now(),'ok',%s,'test')"  # noqa: E501
            connection.cursor().executemany(archive_sql, [(fiscal,"fiscalizacion","fiscalizacion"),(official,"national","official")])  # noqa: E501
            common = {"archive_availability":"available","election_year":2096,"election_id":str(election_id),"category_id":str(category_id)}  # noqa: E501
            observed = common | {"context_role":"observed","source_kind":"fiscalizacion","archive_entry_id":fiscal}  # noqa: E501
            comparison = common | {"context_role":"comparison","source_kind":"official","archive_entry_id":official}  # noqa: E501
            call = "select workspace_private.record_review_item_v2(%s,'info',%s,null,array[]::text[],array[]::text[],%s::jsonb)"  # noqa: E501
            connection.execute("set role etl_writer")
            assert _fetchone(connection,call,("blank_vote_cell",prefix+"-one",json.dumps([observed]))) == (True,)  # noqa: E501
            assert _fetchone(connection,call,("mesa_tally_divergence",prefix,json.dumps([observed,comparison]))) == (True,)  # noqa: E501
            assert _fetchone(connection,call,("mesa_tally_divergence",prefix,json.dumps([comparison,observed]))) == (False,)  # noqa: E501
            bad_sets = ([observed,observed],[observed | {"extra":1}],[observed | {"source_kind":"official","archive_entry_id":official}],[comparison | {"source_kind":"fiscalizacion","archive_entry_id":fiscal}],*([observed | {key:value}] for key,value in (("election_year","2096"),("archive_entry_id",2096))))  # noqa: E501
            for bad in bad_sets:
                with pytest.raises(psycopg.errors.CheckViolation), connection.transaction():
                    connection.execute(call,("mesa_tally_divergence",prefix+"-bad",json.dumps(bad)))  # noqa: E501
            with pytest.raises(psycopg.errors.CheckViolation), connection.transaction():
                connection.execute(call,("mesa_tally_divergence",prefix,json.dumps([observed])))  # noqa: E501
            context_count = "select count(*) from workspace_private.review_item_context c join review_item r on r.id=c.review_item_id where r.subject_ref=%s"  # noqa: E501
            connection.execute("reset role")
            assert _fetchone(connection, context_count, (prefix,)) == (2,)
            connection.execute("set role etl_writer")
            legacy = "select workspace_private.record_review_item('blank_vote_cell','info',%s,null,array[]::text[],array[]::text[])"  # noqa: E501
            assert _fetchone(connection, legacy, (prefix + "-fallback",)) == (True,)
            assert _fetchone(connection,call,("blank_vote_cell",prefix+"-fallback",json.dumps([observed,comparison]))) == (False,)  # noqa: E501
            connection.commit()
    finally:
        try:
            if applied:
                with pytest.raises(psycopg.errors.CheckViolation, match="multi_context_active_items="):  # noqa: E501
                    _apply_down_migration(admin_dsn, RECORD_REVIEW_ITEM_CONTEXTS_MIGRATION_VERSION)
                with psycopg.connect(admin_dsn) as connection:
                    assert _fetchone(connection, "select to_regprocedure(%s) is not null", (vector,)) == (True,)  # noqa: E501
                    connection.execute("update review_item set resolved_at=now() where starts_with(subject_ref,%s) and id in (select review_item_id from workspace_private.review_item_context group by review_item_id having count(*)>1)", (prefix,))  # noqa: E501
                _apply_down_migration(admin_dsn, RECORD_REVIEW_ITEM_CONTEXTS_MIGRATION_VERSION)
                with psycopg.connect(admin_dsn) as connection:
                    restored = _fetchone(connection,"select pg_get_functiondef(%s::regprocedure)",(scalar,))[0]  # noqa: E501
                    retained = _fetchone(connection,"select count(*) from workspace_private.review_item_context c join review_item r on r.id=c.review_item_id where starts_with(r.subject_ref,%s)",(prefix,))[0]  # noqa: E501
                    assert restored == scalar_before and retained >= 5
                    connection.execute("delete from review_item where starts_with(subject_ref,%s)",(prefix,))  # noqa: E501
                    connection.execute(
                        "delete from archive_entry where starts_with(id,%s)", (prefix,)
                    )
                    connection.execute("delete from category where name=%s", (prefix,))
                    connection.execute("delete from election where round=%s", (prefix,))
        finally:
            _set_latest_review_context_level(admin_dsn, original_review_context_level)
# fmt: on


# fmt: off
def test_year_level_review_contexts_insert_replay_reject_and_rollback_safely() -> None:
    if not (database_dsn := os.environ.get("ETL_TEST_DATABASE_URL")):
        pytest.skip("ETL_TEST_DATABASE_URL is required for year-level review context coverage")
    admin_dsn = make_conninfo(**(conninfo_to_dict(database_dsn) | {"user": "postgres"}))
    vector = "workspace_private.record_review_item_v2(text,text,text,text,text[],text[],jsonb)"
    reason, prefix = "source_archive_not_attributable", f"year-contexts-{uuid.uuid4()}"
    with psycopg.connect(admin_dsn) as connection:
        if not _fetchone(connection, "select to_regprocedure(%s) is not null", (vector,))[0]:
            pytest.skip("PR4 context-set writer is required")
        installed = reason in _fetchone(connection, "select pg_get_functiondef(%s::regprocedure)", (vector,))[0]  # noqa: E501
    if installed:
        _apply_down_migration(admin_dsn, YEAR_LEVEL_REVIEW_CONTEXTS_MIGRATION_VERSION)
    with psycopg.connect(admin_dsn) as connection:
        before_function = _fetchone(connection, "select pg_get_functiondef(%s::regprocedure)", (vector,))[0]  # noqa: E501
        before_constraint = _fetchone(connection, "select pg_get_constraintdef(oid) from pg_constraint where conrelid='workspace_private.review_item_context'::regclass and conname='review_item_context_unknown_reason_check'")[0]  # noqa: E501
    _apply_migration(admin_dsn, YEAR_LEVEL_REVIEW_CONTEXTS_MIGRATION_VERSION)
    base = {"context_role":"observed","source_kind":"official","archive_availability":"unknown","election_id":None,"category_id":None,"archive_entry_id":None,"unknown_reason":reason}  # noqa: E501
    contexts = [base | {"election_year": year} for year in (2023, 2025)]
    call = "select workspace_private.record_review_item_v2('mesa_discontinuity','warning',%s,null,array[]::text[],array[]::text[],%s::jsonb)"  # noqa: E501
    try:
        with psycopg.connect(admin_dsn) as connection:
            election_id = _fetchone(connection, "insert into election(year,round) values(2095,%s) returning id", (prefix,))[0]  # noqa: E501
            category_id = _fetchone(connection, "insert into category(name) values(%s) returning id", (prefix,))[0]  # noqa: E501
            fiscal, official = prefix + "-fiscal", prefix + "-official"
            archive_sql = "insert into archive_entry(id,capability,source,source_url,mime,fetched_at,status,source_kind,notes) values(%s,%s,'test','local://test','text/csv',now(),'ok',%s,'test')"  # noqa: E501
            connection.cursor().executemany(archive_sql, [(fiscal,"fiscalizacion","fiscalizacion"),(official,"national","official")])  # noqa: E501
            common = {"archive_availability":"available","election_year":2095,"election_id":str(election_id),"category_id":str(category_id)}  # noqa: E501
            available_observed = common | {"context_role":"observed","source_kind":"fiscalizacion","archive_entry_id":fiscal}  # noqa: E501
            available_comparison = common | {"context_role":"comparison","source_kind":"official","archive_entry_id":official}  # noqa: E501
            connection.execute("set role etl_writer")
            assert _fetchone(connection, call, (prefix + "-available-observed", json.dumps([available_observed]))) == (True,)  # noqa: E501
            assert _fetchone(connection, call, (prefix + "-available-comparison", json.dumps([available_comparison]))) == (True,)  # noqa: E501
            assert _fetchone(connection, call, (prefix, json.dumps(contexts))) == (True,)
            assert _fetchone(connection, call, (prefix, json.dumps(contexts))) == (False,)
            assert _fetchone(connection, call, (prefix, json.dumps(list(reversed(contexts))))) == (False,)  # noqa: E501
            with pytest.raises(psycopg.errors.CheckViolation), connection.transaction():
                connection.execute(call, (prefix, json.dumps(contexts[:1])))
            bad = [base | {"election_year":2023,"unknown_reason":"historical_archive_not_linked"}, dict(base), base | {"election_year":"2023"}, base | {"election_year":2023,"election_id":str(uuid.uuid4())}, base | {"election_year":2023,"category_id":str(uuid.uuid4())}, base | {"election_year":2023,"archive_entry_id":"invented"}, base | {"election_year":2023,"context_role":"comparison"}, base | {"election_year":2023,"source_kind":"fiscalizacion"}, base | {"election_year":2023,"archive_availability":"unavailable"}]  # noqa: E501
            for index, context in enumerate(bad):
                with pytest.raises(psycopg.errors.CheckViolation), connection.transaction():
                    connection.execute(call, (f"{prefix}-bad-{index}", json.dumps([context])))
            connection.execute("reset role")
            assert _fetchone(connection, "select array_agg(c.election_year order by c.election_year),bool_and(c.election_id is null and c.category_id is null and c.archive_entry_id is null) from workspace_private.review_item_context c join review_item r on r.id=c.review_item_id where r.subject_ref=%s", (prefix,)) == ([2023, 2025], True)  # noqa: E501
            connection.commit()
        with pytest.raises(psycopg.errors.CheckViolation, match="count=2.*categories="):
            _apply_down_migration(admin_dsn, YEAR_LEVEL_REVIEW_CONTEXTS_MIGRATION_VERSION)
        with psycopg.connect(admin_dsn) as connection:
            connection.execute("delete from review_item where starts_with(subject_ref,%s)", (prefix,))  # noqa: E501
        _apply_down_migration(admin_dsn, YEAR_LEVEL_REVIEW_CONTEXTS_MIGRATION_VERSION)
        with psycopg.connect(admin_dsn) as connection:
            assert _fetchone(connection, "select pg_get_functiondef(%s::regprocedure)", (vector,))[0] == before_function  # noqa: E501
            assert _fetchone(connection, "select pg_get_constraintdef(oid) from pg_constraint where conrelid='workspace_private.review_item_context'::regclass and conname='review_item_context_unknown_reason_check'")[0] == before_constraint  # noqa: E501
        _apply_migration(admin_dsn, YEAR_LEVEL_REVIEW_CONTEXTS_MIGRATION_VERSION)
    finally:
        with psycopg.connect(admin_dsn) as connection:
            connection.execute("delete from review_item where starts_with(subject_ref,%s)", (prefix,))  # noqa: E501
            connection.execute("delete from archive_entry where starts_with(id,%s)", (prefix,))
            connection.execute("delete from category where name=%s", (prefix,))
            connection.execute("delete from election where round=%s", (prefix,))
            currently_installed = reason in _fetchone(connection, "select pg_get_functiondef(%s::regprocedure)", (vector,))[0]  # noqa: E501
        if installed and not currently_installed:
            _apply_migration(admin_dsn, YEAR_LEVEL_REVIEW_CONTEXTS_MIGRATION_VERSION)
        elif not installed and currently_installed:
            _apply_down_migration(admin_dsn, YEAR_LEVEL_REVIEW_CONTEXTS_MIGRATION_VERSION)
    # fmt: on


# fmt: off
def test_platform_review_breakdown_preserves_nullable_context_on_forward_and_down() -> None:
    if not (database_dsn := os.environ.get("ETL_TEST_DATABASE_URL")):
        pytest.skip("ETL_TEST_DATABASE_URL is required for platform review breakdown coverage")
    admin_dsn = make_conninfo(**(conninfo_to_dict(database_dsn) | {"user": "postgres"}))
    signature = "workspace_private.platform_review_breakdown(integer,integer)"
    prefix = f"breakdown-migration-{uuid.uuid4()}"
    review_id = uuid.uuid4()
    archive_id = prefix + "-archive"
    state_sql = "select (select is_nullable from information_schema.columns where table_schema='workspace_private' and table_name='review_item_context' and column_name='unknown_reason'),to_regprocedure(%s) is not null,(select count(*) from pg_policies where schemaname='public' and policyname in ('workspace_review_ingest_owner_breakdown_election_select','workspace_review_ingest_owner_breakdown_category_select'))"  # noqa: E501
    row_sql = "select context_role,source_kind,archive_availability,unknown_reason from workspace_private.review_item_context where review_item_id=%s"  # noqa: E501
    with psycopg.connect(admin_dsn) as connection:
        if _review_context_migration_level(admin_dsn) < 2:
            pytest.skip("classified review context migration is required")
        originally_installed = _fetchone(connection, "select to_regprocedure(%s) is not null", (signature,))[0]  # noqa: E501
    try:
        if originally_installed:
            _apply_down_migration(admin_dsn, PLATFORM_REVIEW_BREAKDOWN_MIGRATION_VERSION)
        with psycopg.connect(admin_dsn) as connection:
            assert _fetchone(connection, state_sql, (signature,)) == ("YES", False, 0)
            election_id = _fetchone(connection, "insert into election(year,round) values(2096,%s) returning id", (prefix,))[0]  # noqa: E501
            category_id = _fetchone(connection, "insert into category(name) values(%s) returning id", (prefix,))[0]  # noqa: E501
            connection.execute("insert into archive_entry(id,capability,source,source_url,mime,fetched_at,status,source_kind,notes) values(%s,'fiscalizacion','test','local://test','text/csv',now(),'ok','fiscalizacion','test')", (archive_id,))  # noqa: E501
            connection.execute("insert into review_item(id,kind,severity,subject_ref,tenant_scope_state) values(%s,'content_drift','warning',%s,'platform_only')", (review_id, prefix))  # noqa: E501
            connection.execute("set role workspace_review_ingest_owner")
            connection.execute("update workspace_private.review_item_context set context_role='observed',source_kind='fiscalizacion',archive_availability='available',election_year=2096,election_id=%s,category_id=%s,archive_entry_id=%s,unknown_reason=null where review_item_id=%s", (election_id, category_id, archive_id, review_id))  # noqa: E501
            connection.execute("reset role")
            assert _fetchone(connection, row_sql, (review_id,)) == ("observed", "fiscalizacion", "available", None)  # noqa: E501
        _apply_migration(admin_dsn, PLATFORM_REVIEW_BREAKDOWN_MIGRATION_VERSION)
        with psycopg.connect(admin_dsn) as connection:
            assert _fetchone(connection, state_sql, (signature,)) == ("YES", True, 2)
            assert _fetchone(connection, row_sql, (review_id,)) == ("observed", "fiscalizacion", "available", None)  # noqa: E501
        _apply_down_migration(admin_dsn, PLATFORM_REVIEW_BREAKDOWN_MIGRATION_VERSION)
        with psycopg.connect(admin_dsn) as connection:
            assert _fetchone(connection, state_sql, (signature,)) == ("YES", False, 0)
            assert _fetchone(connection, row_sql, (review_id,)) == ("observed", "fiscalizacion", "available", None)  # noqa: E501
    finally:
        with psycopg.connect(admin_dsn) as connection:
            connection.execute("delete from review_item where id=%s", (review_id,))
            connection.execute("delete from archive_entry where starts_with(id,%s)", (prefix,))
            connection.execute("delete from category where name=%s", (prefix,))
            connection.execute("delete from election where round=%s", (prefix,))
            currently_installed = _fetchone(connection, "select to_regprocedure(%s) is not null", (signature,))[0]  # noqa: E501
        if originally_installed and not currently_installed:
            _apply_migration(admin_dsn, PLATFORM_REVIEW_BREAKDOWN_MIGRATION_VERSION)
        elif not originally_installed and currently_installed:
            _apply_down_migration(admin_dsn, PLATFORM_REVIEW_BREAKDOWN_MIGRATION_VERSION)
# fmt: on
