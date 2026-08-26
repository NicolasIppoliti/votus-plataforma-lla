from __future__ import annotations

import hashlib
import re
from pathlib import Path

import pytest

from etl.review_item import REVIEW_ITEM_KINDS

REPO_ROOT = Path(__file__).parent.parent.parent
MIGRATIONS = REPO_ROOT / "supabase" / "migrations"
SQL_TESTS = REPO_ROOT / "supabase" / "tests"


def _sql(name: str) -> str:
    return (MIGRATIONS / name).read_text(encoding="utf-8").lower()


_UUID_PATTERN = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", re.IGNORECASE)
_JURISDICTION_LIFETIME_EVENT = re.compile(
    r"(?P<insert>insert\s+into\s+jurisdiction\s*\([^;]*?\)\s*values\s*"
    r"(?P<values>.*?);)"
    r"|(?P<savepoint>\bsavepoint\s+(?P<savepoint_name>[a-z_][a-z0-9_]*)\s*;)"
    r"|(?P<rollback>\brollback\s+to(?:\s+savepoint)?\s+"
    r"(?P<rollback_name>[a-z_][a-z0-9_]*)\s*;)",
    flags=re.IGNORECASE | re.DOTALL,
)


def _assert_jurisdiction_fixture_ids_are_unique(sql: str) -> None:
    sql_without_comments = re.sub(r"--[^\n]*", "", sql)
    events = list(_JURISDICTION_LIFETIME_EVENT.finditer(sql_without_comments))
    expected_event_starts = sorted(
        match.start()
        for pattern in (
            r"\binsert\s+into\s+jurisdiction\b",
            r"(?m)^\s*savepoint\b",
            r"\brollback\s+to\b",
        )
        for match in re.finditer(pattern, sql_without_comments, flags=re.IGNORECASE)
    )
    assert [event.start() for event in events] == expected_event_starts, (
        "unsupported or ambiguous jurisdiction fixture/savepoint SQL structure"
    )
    assert not re.search(r"\brelease\s+savepoint\b", sql_without_comments, re.IGNORECASE), (
        "release savepoint is unsupported by jurisdiction fixture lifetime validation"
    )

    active_ids: set[str] = set()
    savepoints: list[tuple[str, set[str]]] = []
    saw_fixture_row = False
    for event in events:
        if event.group("savepoint"):
            name = event.group("savepoint_name").lower()
            assert name not in {saved_name for saved_name, _ in savepoints}, (
                f"ambiguous duplicate active savepoint: {name}"
            )
            savepoints.append((name, active_ids.copy()))
            continue

        if event.group("rollback"):
            name = event.group("rollback_name").lower()
            matching_indexes = [
                index for index, (saved_name, _) in enumerate(savepoints) if saved_name == name
            ]
            assert len(matching_indexes) == 1, f"rollback targets unknown savepoint: {name}"
            savepoint_index = matching_indexes[0]
            active_ids = savepoints[savepoint_index][1].copy()
            savepoints = savepoints[: savepoint_index + 1]
            continue

        values = event.group("values")
        row_starts = re.findall(r"(?:^|,)\s*\(", values)
        row_id_literals = re.findall(r"(?:^|,)\s*\(\s*'([^']+)'", values)
        assert row_starts and len(row_id_literals) == len(row_starts), (
            "every jurisdiction fixture row must start with a literal UUID"
        )
        invalid_ids = [
            row_id for row_id in row_id_literals if _UUID_PATTERN.fullmatch(row_id) is None
        ]
        assert not invalid_ids, "every jurisdiction fixture row must start with a literal UUID"
        saw_fixture_row = True
        for row_id in row_id_literals:
            fixture_id = row_id.lower()
            assert fixture_id not in active_ids, (
                "duplicate simultaneously-live jurisdiction fixture UUID suffix: "
                f"{fixture_id.rsplit('-', 1)[-1]}"
            )
            active_ids.add(fixture_id)

    assert saw_fixture_row, "jurisdiction fixture inserts are required"


def test_results_exploration_jurisdiction_fixture_ids_are_unique() -> None:
    sql = (SQL_TESTS / "results_exploration.sql").read_text(encoding="utf-8")

    _assert_jurisdiction_fixture_ids_are_unique(sql)


def test_jurisdiction_fixture_uniqueness_tracks_savepoint_lifetimes_and_fails_closed() -> None:
    fixture_id = "20000000-0000-0000-0000-000000000001"
    insert = f"insert into jurisdiction (id) values ('{fixture_id}');"

    with pytest.raises(AssertionError, match="simultaneously-live"):
        _assert_jurisdiction_fixture_ids_are_unique(f"{insert}\n{insert}")

    _assert_jurisdiction_fixture_ids_are_unique(
        f"savepoint fixture;\n{insert}\nrollback to savepoint fixture;\n{insert}"
    )

    with pytest.raises(AssertionError, match="unsupported or ambiguous"):
        _assert_jurisdiction_fixture_ids_are_unique(
            f"{insert}\ninsert into jurisdiction (id) select '{fixture_id}';"
        )


def _review_kind_allowlist(sql: str) -> set[str]:
    constraint = sql.split("add constraint review_item_kind_check check", 1)[1]
    constraint = constraint.split(");", 1)[0]
    return set(re.findall(r"'([a-z0-9_]+)'", constraint))


def test_0024_review_kind_allowlist_matches_the_declared_production_kinds() -> None:
    """The constraint and `REVIEW_ITEM_KINDS` must agree exactly, in both directions.

    This replaces an AST scan of the producers, which only recognized `kind=` keyword
    arguments holding a plain constant. Literals in any other shape were invisible to it,
    and because the old assertion was a subset check, an incomplete left-hand side always
    satisfied it: renaming a kind kept the suite green while the INSERT died in production
    on `review_item_kind_check`. The real `insert_review_items` boundary now refuses an
    undeclared kind regardless of the producer's object type or the syntax carrying its
    literal, so this file only has to keep the constraint and the constant aligned.

    Equality, not containment: a kind admitted by the constraint but no producer can emit
    is dead allowance, and a declared kind the constraint rejects is a failed insert.
    """
    sql = _sql("0024_expand_review_item_kinds.sql")

    assert len(REVIEW_ITEM_KINDS) == 18, "migration 0024 established an exact 18-kind union"
    assert set(REVIEW_ITEM_KINDS) == _review_kind_allowlist(sql)


def test_0024_uses_the_exact_review_kind_union_and_has_a_guarded_down_migration() -> None:
    expected = set(REVIEW_ITEM_KINDS)
    forward = _sql("0024_expand_review_item_kinds.sql")
    down_path = MIGRATIONS / "down" / "0024_expand_review_item_kinds.down.sql"

    assert forward.startswith("begin;") and forward.rstrip().endswith("commit;")
    assert _review_kind_allowlist(forward) == expected
    assert forward.count("drop constraint review_item_kind_check") == 1
    assert forward.count("add constraint review_item_kind_check") == 1
    assert down_path.exists()
    down = down_path.read_text(encoding="utf-8").lower()
    assert down.startswith("begin;") and down.rstrip().endswith("commit;")
    assert "select count(*)" in down
    assert "raise exception" in down
    assert "delete from review_item" not in down
    assert _review_kind_allowlist(down) == expected - {
        "ambiguous_official_mesa_identity",
        "pba_conflicting_duplicate_semantic_result",
        "pba_exact_duplicate_semantic_result",
        "pba_unreadable_vote_cell",
    }


def test_0012_matches_the_immutable_main_history() -> None:
    migration = (MIGRATIONS / "0012_reconcile_jurisdictions.sql").read_bytes()

    assert hashlib.sha256(migration).hexdigest() == (
        "7fd555d7f476369277542f472afd4ba8b835cbeb84781604d9b503ffb8a29ca9"
    )


def test_0017_recovers_only_registered_pba_result_provenance() -> None:
    sql = _sql("0017_repair_jurisdiction_reconciliation.sql")

    assert "^pba/[0-9]{4}-distrito-([0-9]+)$" in sql
    assert "rr.archive_entry_id ~ '^pba/[0-9]{4}-distrito-[0-9]+$'" in sql
    assert "substring(rr.archive_entry_id from" in sql
    assert "join archive_entry" not in sql
    assert "lock table archive_entry" not in sql
    assert "join jurisdiction_crosswalk" in sql
    assert "national_distrito_code" in sql
    assert "national_seccion_code" in sql
    assert "rr.archive_entry_id" in sql
    assert "j.distrito_code = '02'" not in sql


def test_0017_collision_checks_use_the_complete_result_natural_key() -> None:
    sql = _sql("0017_repair_jurisdiction_reconciliation.sql")
    required = (
        "archive_entry_id",
        "election_id",
        "category_id",
        "list_id",
        "source_kind",
    )

    provenance_checks = sql.split("-- provenance collision checks", 1)[1]
    provenance_checks = provenance_checks.split("update result_row rr", 1)[0]
    general_checks = sql.split("-- general collision checks", 1)[1]
    general_checks = general_checks.split("update result_row rr", 1)[0]
    for column in required:
        assert column in provenance_checks
        assert column in general_checks
    assert "raise exception" in provenance_checks
    assert "raise exception" in general_checks


def test_0017_translates_the_full_pair_and_preserves_over_width_codes() -> None:
    sql = _sql("0017_repair_jurisdiction_reconciliation.sql")

    assert "xw.national_distrito_code" in sql
    assert "xw.national_seccion_code" in sql
    ascii_whitespace = "e' \\t\\n\\r\\f\\v'"
    assert f"ltrim(btrim(j.distrito_code, {ascii_whitespace}), '0')" in sql
    assert f"ltrim(btrim(j.seccion_code, {ascii_whitespace}), '0')" in sql
    assert "length(canon_distrito.numeric_text) < 2" in sql
    assert "length(canon_seccion.numeric_text) < 3" in sql
    assert "else canon_distrito.numeric_text" in sql
    assert "else canon_seccion.numeric_text" in sql
    assert "lpad(j.distrito_code::int::text, 2, '0')" not in sql
    assert "lpad(j.seccion_code::int::text, 3, '0')" not in sql


def test_0017_pins_row_count_and_refuses_ambiguous_repairs() -> None:
    sql = _sql("0017_repair_jurisdiction_reconciliation.sql")

    assert "before_count" in sql and "after_count" in sql
    assert "result_row count changed" in sql
    assert "ambiguous" in sql
    assert "raise notice" in sql
    assert "not exists (select 1 from result_row" in sql


def test_0017_canonicalizes_codes_with_runtime_trim_parity() -> None:
    sql = (MIGRATIONS / "0017_repair_jurisdiction_reconciliation.sql").read_text(encoding="utf-8")
    canonical = sql.split("create temporary table jurisdiction_canonical", 1)[1]
    canonical = canonical.split("alter table jurisdiction_canonical", 1)[0]

    assert "as canonical_circuito" in canonical
    ascii_trim = "btrim(j.{code}, E' \\t\\n\\r\\f\\v')"
    assert f"{ascii_trim.format(code='distrito_code')} ~ '^[0-9]+$'" in canonical
    assert f"{ascii_trim.format(code='seccion_code')} ~ '^[0-9]+$'" in canonical
    assert f"{ascii_trim.format(code='circuito_code')} ~ '^[0-9]+$'" in canonical
    assert f"{ascii_trim.format(code='circuito_code')} ~ '^[0-9]+[A-Za-z]$'" in canonical
    assert f"ltrim({ascii_trim.format(code='distrito_code')}, '0')" in canonical
    assert f"ltrim({ascii_trim.format(code='seccion_code')}, '0')" in canonical
    assert f"ltrim({ascii_trim.format(code='circuito_code')}, '0')" in canonical
    assert "length(canon_circuito.numeric_text) < 5" in canonical
    assert "length(canon_circuito_suffix.numeric_text) < 4" in canonical
    assert f"upper(right({ascii_trim.format(code='circuito_code')}, 1))" in canonical
    assert "btrim(j.distrito_code)" not in canonical
    assert "btrim(j.seccion_code)" not in canonical
    assert "btrim(j.circuito_code)" not in canonical
    assert "else canon_circuito.numeric_text" in canonical
    assert "else canon_circuito_suffix.numeric_text" in canonical
    assert "else j.distrito_code" in canonical
    assert "else j.seccion_code" in canonical
    assert "else j.circuito_code" in canonical


def test_0017_refuses_conflicting_names_and_preserves_unique_metadata() -> None:
    sql = _sql("0017_repair_jurisdiction_reconciliation.sql")

    canonical = sql.split("create temporary table jurisdiction_canonical", 1)[1]
    canonical = canonical.split("create temporary table jurisdiction_merge_target", 1)[0]
    for field in (
        "distrito_name",
        "seccion_name",
        "circuito_name",
        "establecimiento_name",
    ):
        assert field in canonical
        assert f"count(distinct {field})" in sql
        assert f"{field} = target.{field}" in sql
    assert "metadata conflict" in sql
    assert "refusing to pick" in sql
    assert "min(xw.name)" not in sql


def test_0017_uses_typed_collision_proof_merge_keys() -> None:
    sql = _sql("0017_repair_jurisdiction_reconciliation.sql")

    merge_key_expression = (
        "jsonb_build_array( canonical_distrito, canonical_seccion, "
        "canonical_circuito, establecimiento_code, mesa_code )::text"
    )
    assert merge_key_expression in " ".join(sql.split())
    assert "concat_ws" not in sql
    assert "chr(1)" not in sql
    assert "chr(31)" not in sql


def test_0017_uses_canonical_circuito_for_merge_and_surviving_update() -> None:
    sql = _sql("0017_repair_jurisdiction_reconciliation.sql")

    assert "circuito_code = canonical.canonical_circuito" in sql
    changed = sql.split("update jurisdiction j", 1)[1]
    changed = changed.split("get diagnostics normalized_count", 1)[0]
    assert "j.circuito_code is distinct from canonical.canonical_circuito" in changed


def test_0017_down_explicitly_refuses_an_irreversible_data_merge() -> None:
    down = MIGRATIONS / "down" / "0017_repair_jurisdiction_reconciliation.down.sql"

    assert down.exists()
    sql = down.read_text(encoding="utf-8").lower()
    assert "not reversible" in sql
    assert "data merge" in sql
    assert "raise exception" in sql


def test_0018_matches_and_repoints_only_same_election_source_kinds() -> None:
    sql = _sql("0018_merge_fiscalizacion_mesas_into_official.sql")

    assert "fr.source_kind = 'fiscalizacion'" in sql
    assert "orr.source_kind = 'official'" in sql
    assert "orr.election_id = fr.election_id" in sql
    assert "r.election_id = m.election_id" in sql
    assert "r.source_kind = 'fiscalizacion'" in sql


def test_0018_review_items_use_runtime_source_election_lineage_identity() -> None:
    sql = _sql("0018_merge_fiscalizacion_mesas_into_official.sql")

    assert "join election e on e.id = fr.election_id" in sql
    assert "fr.archive_entry_id" in sql
    assert "e.year::text || '-' || e.round" in sql
    assert "fr.archive_entry_id || ' '" in sql
    assert "existing.kind = 'ambiguous_mesa_circuito'" in sql
    assert "existing.subject_ref = m.subject_ref" in sql
    assert "existing.kind = 'mesa_absent_from_official_import'" in sql
    assert sql.count("existing.subject_ref = m.subject_ref") == 2
    assert "right(existing.subject_ref" not in sql
    assert "group by f.id, fr.archive_entry_id, fr.election_id" in sql


def test_0018_only_active_review_items_suppress_current_observations() -> None:
    sql = _sql("0018_merge_fiscalizacion_mesas_into_official.sql")

    assert sql.count("existing.resolved_at is null") == 2


def test_0018_review_item_notes_match_runtime_wording_exactly() -> None:
    sql = " ".join(_sql("0018_merge_fiscalizacion_mesas_into_official.sql").split())

    assert (
        "'number does not identify it; a fiscalización tally cannot be ' "
        "|| 'attributed to one of them without guessing'"
    ) in sql
    assert "array_agg(distinct o.circuito_code order by o.circuito_code)" in sql
    assert (
        "'import has no jurisdiction for it in distrito ' || m.distrito_code "
        "|| ' seccion ' || coalesce(m.seccion_code, '(sin seccion)') "
        "|| ', so it cannot be placed without inventing one'"
    ) in sql


def test_0016_rebuilds_mesa_crosswalk_with_circuito_identity_and_notices() -> None:
    sql = _sql("0016_add_circuito_to_mesa_crosswalk.sql")

    assert sql.startswith("-- 0016")
    assert "begin;" in sql and "commit;" in sql
    assert "select count(*)" in sql
    assert "raise notice" in sql
    assert "delete from mesa_crosswalk" in sql
    assert "add column circuito_code text not null" in sql
    assert "unique (distrito_code, seccion_code, circuito_code, mesa_code)" in sql
    assert "0003_jurisdiction_crosswalk.sql" not in sql


def test_0016_down_explicitly_discards_projection_and_restores_old_identity() -> None:
    down = (
        REPO_ROOT
        / "supabase"
        / "migrations"
        / "down"
        / "0016_add_circuito_to_mesa_crosswalk.down.sql"
    )

    assert down.exists()
    sql = down.read_text(encoding="utf-8").lower()
    assert "select count(*)" in sql
    assert "raise notice" in sql
    assert "delete from mesa_crosswalk" in sql
    assert "drop column circuito_code" in sql
    assert "unique (distrito_code, seccion_code, mesa_code)" in sql


def test_0018_preserves_the_existing_unreadable_vote_review_kind() -> None:
    sql = _sql("0018_merge_fiscalizacion_mesas_into_official.sql")

    assert "'unreadable_vote_cell'" in sql


def test_0018_has_an_explicit_non_reversible_down_artifact() -> None:
    down = MIGRATIONS / "down" / "0018_merge_fiscalizacion_mesas_into_official.down.sql"

    assert down.exists()
    sql = down.read_text(encoding="utf-8").lower()
    assert "not reversible" in sql
    assert "raise exception" in sql


def test_0017_drops_0012_session_scoped_temp_tables_before_recreating_them() -> None:
    """A cold single-session apply must survive 0012's leftover temp tables.

    `apply_migrations` opens a fresh connection per file, so 0012's three
    temp tables -- created without `on commit drop` and therefore scoped to
    the session, not the transaction -- never outlive their own migration.
    A single-session applier such as `supabase db push` keeps one connection
    for the whole run, so they DO survive 0012's commit and collide with the
    identically named tables 0017 creates. 0012 is pinned immutable by
    `test_0012_matches_the_immutable_main_history`, so the guard lives here.
    """
    sql = _sql("0017_repair_jurisdiction_reconciliation.sql")

    guard = "drop table if exists"
    assert guard in sql
    for leftover in ("jurisdiction_canonical", "jurisdiction_merge_target", "jurisdiction_remap"):
        assert leftover in sql.split(guard, 1)[1].split(";", 1)[0]
        assert sql.index(guard) < sql.index(f"create temporary table {leftover}")


def test_0020_results_exploration_rpcs_are_authenticated_security_invokers() -> None:
    sql = _sql("0020_results_exploration.sql")

    for function in (
        "results_exploration_facets",
        "results_exploration_official",
    ):
        definition = sql.split(f"create or replace function {function}", 1)[1]
        definition = definition.split("$$;", 1)[0]
        assert "security invoker" in definition
        assert f"revoke all on function {function}" in sql
        assert f"grant execute on function {function}" in sql
    assert " to authenticated" in sql
    assert " to anon" not in sql


def test_0020_official_results_preserve_identity_and_source_isolation() -> None:
    sql = _sql("0020_results_exploration.sql")
    official = sql.split("create or replace function results_exploration_official", 1)[1]
    official = official.split("revoke all on function", 1)[0]

    assert "rr.source_kind = 'official'" in official
    assert "'source_kind', 'official'" in official
    assert "'source_audit'" in official
    assert "source_kind" in official and "count(*)" in official and "sum(votes)" in official
    assert "pm.canonical_party_id" in official
    assert "unmapped" in official
    assert "sum(rr.votes)" in official
    assert "total_votes" in official
    assert "vote_share" in official
    assert "count(distinct" in official and "mesa" in official
    assert "archive_entry_id" in official
    assert "e.round" in official
    assert "source_granularity" in official
    assert "mesa_count" in official and "then null" in official


def test_0020_official_rpc_requires_complete_selector_parent_chains() -> None:
    sql = _sql("0020_results_exploration.sql")
    official = sql.split("create or replace function results_exploration_official", 1)[1]

    for guard in (
        "missing_parent_selector",
        "p_circuito_code is not null and p_seccion_code is null",
        "p_establecimiento_code is not null and p_circuito_code is null",
        "p_mesa_code is not null and p_establecimiento_code is null",
    ):
        assert guard in official


def test_0020_derives_pba_reporting_level_from_normalized_lineage_and_provenance() -> None:
    sql = _sql("0020_results_exploration.sql")
    boundary = sql.split("create or replace function results_exploration_reporting_level", 1)[1]
    boundary = boundary.split("$$;", 1)[0]
    official = sql.split("create or replace function results_exploration_official", 1)[1]

    assert "pba/[0-9]{4}-distrito-" in boundary and "then 'seccion'" in boundary
    assert "p_distrito_code" in boundary and "p_seccion_code" in boundary
    assert "results_exploration_reporting_level(" in official and "effective_level" in official


def test_0020_is_official_only_and_exposes_source_backed_facets() -> None:
    sql = _sql("0020_results_exploration.sql")
    facets = sql.split("create or replace function results_exploration_facets", 1)[1]
    facets = facets.split("create or replace function results_exploration_official", 1)[0]

    assert "results_exploration_coverage" not in sql
    assert "fiscalizacion" not in sql
    assert "rr.source_kind = 'official'" in facets
    for selector in (
        "elections",
        "categories",
        "distritos",
        "secciones",
        "circuitos",
        "establecimientos",
        "mesas",
        "available_levels",
    ):
        assert f"'{selector}'" in facets


def test_0020_official_sql_validates_selectors_counts_levels_and_mapping_shapes() -> None:
    sql = _sql("0020_results_exploration.sql")
    official = sql.split("create or replace function results_exploration_official", 1)[1]
    official = official.split("revoke all on function", 1)[0]

    assert "selection_invalid" in official
    assert "missing_selector" in official
    assert "granularity_counts" in official
    assert "actual_level" in official
    assert "'distrito'" in official
    mapping = sql.split("create or replace function results_exploration_party_jurisdiction", 1)[1]
    mapping = mapping.split("$$;", 1)[0]
    for evidence in ("p_year", "p_round", "p_category", "p_distrito_code", "p_seccion_code"):
        assert evidence in mapping
    assert "coronel_rosales_municipal" in mapping
    assert "p_category = 'concejales'" in mapping
    assert "p_distrito_code = '02'" in mapping and "p_seccion_code = '027'" in mapping


def test_0020_indexes_match_the_exploration_predicates_and_down_is_complete() -> None:
    sql = _sql("0020_results_exploration.sql")
    down = MIGRATIONS / "down" / "0020_results_exploration.down.sql"

    assert "(election_id, category_id, source_kind, jurisdiction_id)" in sql
    assert down.exists()
    rollback = down.read_text(encoding="utf-8").lower()
    assert "drop function if exists results_exploration_official" in rollback
    assert "drop function if exists results_exploration_facets" in rollback
    assert "drop index if exists result_row_exploration_scope_idx" in rollback


def test_0025_replaces_facets_with_progressive_selection_aware_queries() -> None:
    forward_path = MIGRATIONS / "0025_optimize_results_exploration_facets.sql"
    down_path = MIGRATIONS / "down" / "0025_optimize_results_exploration_facets.down.sql"

    assert forward_path.exists(), "0025 facets optimization migration is required"
    assert down_path.exists(), "0025 facets optimization down migration is required"

    forward = forward_path.read_text(encoding="utf-8").lower()
    normalized = " ".join(forward.split())
    signature = (
        "create or replace function results_exploration_facets( "
        "p_election_id uuid default null, p_category_id uuid default null, "
        "p_distrito_code text default null, p_seccion_code text default null, "
        "p_circuito_code text default null ) returns jsonb"
    )
    assert signature in normalized
    definition = normalized.split(signature, 1)[1].split("$$;", 1)[0]
    assert "language sql stable security invoker" in definition
    assert "set search_path = public, pg_temp" in definition
    assert "with official as" not in definition
    assert not re.search(
        r"from result_row\s+rr\s+join election\s+e\s+on\s+e\.id\s*=\s*rr\.election_id\s+"
        r"join category\s+c\s+on\s+c\.id\s*=\s*rr\.category_id\s+"
        r"join jurisdiction\s+j\s+on\s+j\.id\s*=\s*rr\.jurisdiction_id",
        definition,
    )

    expected_keys = (
        "status",
        "elections",
        "categories",
        "distritos",
        "secciones",
        "circuitos",
        "establecimientos",
        "mesas",
        "available_levels",
    )
    for key in expected_keys:
        assert f"'{key}'" in definition
    assert "'status', 'ok'" in definition
    assert definition.count("'[]'::jsonb") >= 8

    named_facets = (
        ("distritos", "secciones", "distrito_name"),
        ("secciones", "circuitos", "seccion_name"),
        ("circuitos", "establecimientos", "circuito_name"),
        ("establecimientos", "mesas", "establecimiento_name"),
    )
    for key, next_key, name_column in named_facets:
        facet = definition.split(f"'{key}'", 1)[1].split(f"'{next_key}'", 1)[0]
        assert "'name_status'" in facet
        assert "'name_variant_count'" in facet
        distinct_names = f"count(distinct j.{name_column})"
        unique_name = (
            f"case when {distinct_names} = 1 then max(j.{name_column}) else null end as name"
        )
        assert unique_name in facet
        assert (
            f"case {distinct_names} when 0 then 'missing' when 1 then 'present' "
            "else 'conflict' end as name_status"
        ) in facet
        assert f"{distinct_names} as name_variant_count" in facet

    establecimientos = definition.split("'establecimientos'", 1)[1].split("'mesas'", 1)[0]
    assert "p_circuito_code is not null" in establecimientos
    available_levels = definition.split("'available_levels'", 1)[1]
    establecimiento_level = available_levels.split("select 'establecimiento', 4", 1)[1]
    establecimiento_level = establecimiento_level.split("union all", 1)[0]
    assert "p_circuito_code is not null" in establecimiento_level

    rollback = down_path.read_text(encoding="utf-8").lower()
    normalized_rollback = " ".join(rollback.split())
    assert rollback.startswith("begin;") and rollback.rstrip().endswith("commit;")
    assert signature in normalized_rollback
    rollback_definition = normalized_rollback.split(signature, 1)[1].split("$$;", 1)[0]
    assert "with official as" in rollback_definition
    assert "join category c on c.id = rr.category_id" in rollback_definition
    assert "join jurisdiction j on j.id = rr.jurisdiction_id" in rollback_definition
    assert "results_exploration_official" not in rollback
    for data_mutation in ("insert into", "update result_row", "delete from", "truncate"):
        assert data_mutation not in rollback


def _assert_0026_signature_guard(
    migration_sql: str, *, absent_signature: str, present_signature: str
) -> None:
    guard_blocks = re.findall(
        r"do\s+\$\$\s*begin(?P<body>.*?)end\s+\$\$;",
        migration_sql,
        flags=re.IGNORECASE | re.DOTALL,
    )
    assert len(guard_blocks) == 1, "0026 must contain exactly one signature assertion block"
    guard = guard_blocks[0]
    assert "public.results_exploration_facets" not in guard.lower()

    checks = re.findall(
        r"to_regprocedure\(\s*format\(\s*'%I\.(?P<signature>"
        r"results_exploration_facets\([^']+\))'\s*,\s*current_schema\(\)\s*\)\s*\)"
        r"\s+is\s+(?P<state>not\s+)?null",
        guard,
        flags=re.IGNORECASE,
    )
    assert guard.lower().count("to_regprocedure(") == 2
    assert [(signature.lower(), bool(state)) for signature, state in checks] == [
        (absent_signature, True),
        (present_signature, False),
    ]


def test_0026_scopes_mesa_facets_to_the_complete_establishment_lineage() -> None:
    forward_path = MIGRATIONS / "0026_scope_mesa_facets_to_establishment.sql"
    down_path = MIGRATIONS / "down" / "0026_scope_mesa_facets_to_establishment.down.sql"

    assert forward_path.exists(), "0026 mesa-lineage migration is required"
    assert down_path.exists(), "0026 mesa-lineage down migration is required"

    forward = " ".join(forward_path.read_text(encoding="utf-8").lower().split())
    old_signature = "results_exploration_facets(uuid,uuid,text,text,text)"
    new_signature = "results_exploration_facets(uuid,uuid,text,text,text,text)"
    declaration = (
        "create function results_exploration_facets( "
        "p_election_id uuid default null, p_category_id uuid default null, "
        "p_distrito_code text default null, p_seccion_code text default null, "
        "p_circuito_code text default null, p_establecimiento_code text default null "
        ") returns jsonb"
    )
    assert f"drop function {old_signature}" in forward
    assert declaration in forward
    assert "j.circuito_code = p_circuito_code" in forward
    assert "j.establecimiento_code = p_establecimiento_code" in forward
    mesas = forward.split("'mesas'", 1)[1].split("'available_levels'", 1)[0]
    for parent in (
        "p_circuito_code is not null",
        "p_establecimiento_code is not null",
        "j.circuito_code = p_circuito_code",
        "j.establecimiento_code = p_establecimiento_code",
    ):
        assert parent in mesas
    mesa_level = forward.split("select 'mesa', 5", 1)[1].split(") levels", 1)[0]
    for parent in (
        "p_circuito_code is not null",
        "p_establecimiento_code is not null",
        "j.circuito_code = p_circuito_code",
        "j.establecimiento_code = p_establecimiento_code",
    ):
        assert parent in mesa_level
    for role in ("public", "anon"):
        assert f"revoke execute on function {new_signature} from {role}" in forward
    assert f"grant execute on function {new_signature} to authenticated" in forward
    _assert_0026_signature_guard(
        forward,
        absent_signature=old_signature,
        present_signature=new_signature,
    )

    rollback = " ".join(down_path.read_text(encoding="utf-8").lower().split())
    assert f"drop function {new_signature}" in rollback
    assert "create function results_exploration_facets(" in rollback
    optimized_0025 = " ".join(
        (MIGRATIONS / "0025_optimize_results_exploration_facets.sql")
        .read_text(encoding="utf-8")
        .lower()
        .split()
    )
    optimized_body = optimized_0025.split(") returns jsonb", 1)[1].split("$$;", 1)[0]
    restored_body = rollback.split(") returns jsonb", 1)[1].split("$$;", 1)[0]
    assert restored_body == optimized_body
    assert f"grant execute on function {old_signature} to authenticated" in rollback
    for role in ("public", "anon"):
        assert f"revoke execute on function {old_signature} from {role}" in rollback
    _assert_0026_signature_guard(
        rollback,
        absent_signature=new_signature,
        present_signature=old_signature,
    )


def test_0025_facets_only_introduces_joins_when_the_selection_needs_them() -> None:
    forward = MIGRATIONS / "0025_optimize_results_exploration_facets.sql"
    assert forward.exists(), "0025 facets optimization migration is required"
    sql = _sql(forward.name)
    facets = sql.split("create or replace function results_exploration_facets", 1)[1]
    facets = facets.split("$$;", 1)[0]

    elections = facets.split("'elections'", 1)[1].split("'categories'", 1)[0]
    assert "from result_row rr" in elections
    assert "join election e on e.id = rr.election_id" in elections
    assert "rr.source_kind = 'official'" in elections
    assert "join category" not in elections
    assert "join jurisdiction" not in elections

    categories = facets.split("'categories'", 1)[1].split("'distritos'", 1)[0]
    assert "from result_row rr" in categories
    assert "join category c on c.id = rr.category_id" in categories
    assert "rr.election_id = p_election_id" in categories
    assert "join jurisdiction" not in categories

    district_and_lower = facets.split("'distritos'", 1)[1]
    assert "join jurisdiction j on j.id = rr.jurisdiction_id" in district_and_lower
    for selector in (
        "p_category_id",
        "p_distrito_code",
        "p_seccion_code",
        "p_circuito_code",
    ):
        assert selector in district_and_lower


def test_0021_coverage_rpc_is_authenticated_and_source_isolated() -> None:
    sql = _sql("0021_results_coverage.sql")
    coverage = sql.split("create or replace function results_exploration_coverage", 1)[1]

    assert "security invoker" in coverage.split("$$;", 1)[0]
    assert "rr.source_kind = 'official'" in coverage
    assert "rr.source_kind = 'fiscalizacion'" in coverage
    assert "'source_kind', 'fiscalizacion'" in coverage
    assert "'is_random_sample', false" in coverage
    assert "grant execute on function results_exploration_coverage" in sql
    assert " to authenticated" in sql
    assert " to anon" not in sql


def test_0021_coverage_derives_denominator_and_reports_every_exclusion() -> None:
    sql = _sql("0021_results_coverage.sql")

    for evidence in (
        "official_mesas",
        "covered_mesas",
        "denominator_unavailable",
        "denominator_audit",
        "source_audit",
        "official_mesas_without_establecimiento_identity",
        "unmatched_fiscalizacion_mesas",
        "official_archive_entry_ids",
        "fiscalizacion_archive_entry_ids",
    ):
        assert evidence in sql
    assert "93" not in sql and "153" not in sql


def test_0021_school_identity_includes_circuit_in_conflicts_groups_and_output() -> None:
    sql = " ".join(_sql("0021_results_coverage.sql").split())

    expected_group = (
        "group by j.circuito_code, j.establecimiento_code "
        "having count(distinct j.establecimiento_name) > 1"
    )
    assert expected_group in sql
    assert "group by circuito_code, establecimiento_code" in sql
    assert "'circuito_code', circuito_code" in sql
    assert "order by circuito_code, code" in sql


def test_0021_coverage_down_drops_only_coverage_objects() -> None:
    down = MIGRATIONS / "down" / "0021_results_coverage.down.sql"

    assert down.exists()
    rollback = down.read_text(encoding="utf-8").lower()
    assert "drop function if exists results_exploration_coverage" in rollback
    assert "results_exploration_official" not in rollback
    assert "results_exploration_facets" not in rollback


def test_results_exploration_scale_proofs_split_semantics_from_real_plans() -> None:
    setup_sql = (
        (SQL_TESTS / "results_exploration_scale_setup.sql").read_text(encoding="utf-8").lower()
    )
    semantic_sql = (SQL_TESTS / "results_exploration_scale.sql").read_text(encoding="utf-8").lower()
    plan_sql = (
        (SQL_TESTS / "results_exploration_scale_plans.sql").read_text(encoding="utf-8").lower()
    )
    cleanup_sql = (
        (SQL_TESTS / "results_exploration_scale_cleanup.sql").read_text(encoding="utf-8").lower()
    )

    assert setup_sql.startswith("\\set on_error_stop on\nset statement_timeout='540s';")
    for phase_sql in (semantic_sql, plan_sql):
        assert phase_sql.startswith("\\set on_error_stop on\nset statement_timeout='120s';")
    assert cleanup_sql.startswith("\\set on_error_stop on\nset statement_timeout='300s';")
    production_migration_sql = "\n".join(
        path.read_text(encoding="utf-8").lower() for path in MIGRATIONS.rglob("*.sql")
    )
    assert "statement_timeout" not in production_migration_sql
    assert "discard plans;" in setup_sql
    assert "select id as category_id from category" in setup_sql
    assert "where name like 'scale %'" not in setup_sql
    phase_plans = [
        int(count)
        for sql in (semantic_sql, plan_sql)
        for count in re.findall(r"select\s+plan\((\d+)\);", sql)
    ]
    assert phase_plans == [16, 15]
    assert sum(phase_plans) == 31

    for required in (
        "results_exploration_facets",
        "results_exploration_official",
        "results_exploration_coverage",
        "results_exploration_schools",
        "->>'status',",
        "results_exploration_official_0035(",
        "results_exploration_official_0034(",
        "results_exploration_official_wrapper_0034(",
        "500, 'scale payload retains exactly 500 complete schools'",
        "12000::bigint",
        "create temporary table production_district_evidence",
        "array[15,15,15,15]",
        "four election scopes with fifteen categories each",
    ):
        assert required in semantic_sql
    assert "explain (analyze, buffers, format json)" not in semantic_sql
    assert "scale_plan_evidence" not in semantic_sql
    assert "district_scan_evidence" not in semantic_sql
    assert "delete from" not in semantic_sql

    for required in (
        "explain (analyze, buffers, format json)",
        "representative_result_rows",
        "execution time",
        "shared hit blocks",
        "shared read blocks",
        "results_exploration_facets",
        "facets_cold_start",
        "facets_cold_start', 122360",
        "results_exploration_facets(null, null, null, null, null, null)",
        "shared read blocks')::bigint, 0)) <= 500",
        "when label = 'facets_cold_start' then 7000",
        "result_row_non_official_scope_idx",
        "official_core_scope",
        "district_scope_access",
        "district_core_rpc",
        "district_rpc",
        "index_scans between 1 and 4",
        "unstable nested-function block totals",
        "result_row_official_district_scope_idx",
        "j.seccion_code = '001'",
        "create temporary table scale_plan_evidence",
        "create temporary table district_scan_evidence",
    ):
        assert required in plan_sql
    assert "production_district_evidence" not in plan_sql
    encapsulated_contracts = plan_sql.split(
        "'production-shaped coverage rpc stays within its time and shared-block budgets'", 1
    )[1].split("select ok((select label = 'coverage_unsupported_source_audit'", 1)[0]
    assert "shared hit blocks" not in encapsulated_contracts
    assert "shared read blocks" not in encapsulated_contracts
    assert "core.label='district_core_rpc'" not in plan_sql

    for phase_sql in (semantic_sql, plan_sql):
        assert phase_sql.count("select * from finish();") == 1
        assert phase_sql.count("rollback;") == 1
    assert plan_sql.rstrip().endswith("rollback;")
    assert "select * from finish();" not in cleanup_sql
    assert "rollback;" not in cleanup_sql
    assert cleanup_sql.count("select 'scale fixture cleanup complete' as cleanup_status;") == 1
    assert cleanup_sql.rstrip().endswith(
        "select 'scale fixture cleanup complete' as cleanup_status;"
    )
    assert "scale cleanup refused non-fixture rows" in cleanup_sql
    assert "truncate table result_row, jurisdiction, category, election," in cleanup_sql
    assert "party_mapping, party_canonical" in cleanup_sql
    assert "delete from" not in cleanup_sql
    assert "truncate table" not in plan_sql
    # Setup relaxes the 0002 source-kind contract to exercise unknown-source auditing.
    # Only the owned post-pgTAP cleanup phase may restore it after deleting the committed fixture.
    assert "drop constraint result_row_source_kind_check" in setup_sql
    assert "alter column source_kind drop not null" in setup_sql
    assert "alter column source_kind set not null" not in semantic_sql
    assert "add constraint result_row_source_kind_check" not in semantic_sql
    assert "alter column source_kind set not null" not in plan_sql
    assert "add constraint result_row_source_kind_check" not in plan_sql
    assert cleanup_sql.count("alter column source_kind set not null") == 1
    assert cleanup_sql.count("add constraint result_row_source_kind_check") == 1
    assert "check (source_kind in ('official', 'fiscalizacion'))" in cleanup_sql
    assert cleanup_sql.index("truncate table result_row") < cleanup_sql.index(
        "alter column source_kind set not null"
    )
    assert cleanup_sql.index("alter column source_kind set not null") < cleanup_sql.index("commit;")


def test_results_exploration_coverage_scale_proof_matches_production_shape() -> None:
    setup_sql = (
        (SQL_TESTS / "results_exploration_scale_setup.sql").read_text(encoding="utf-8").lower()
    )
    semantic_sql = (SQL_TESTS / "results_exploration_scale.sql").read_text(encoding="utf-8").lower()
    plan_sql = (
        (SQL_TESTS / "results_exploration_scale_plans.sql").read_text(encoding="utf-8").lower()
    )
    coverage_semantics = " ".join(semantic_sql.split())
    coverage_plans = " ".join(plan_sql.split())
    marker = "-- issue #54 production-shaped coverage proof"
    assert marker in setup_sql
    coverage_setup = " ".join(setup_sql.split(marker, 1)[1].split())

    for required in (
        "2025, 'legislativas'",
        "'diputado nacional'",
        "'02', '027'",
        "generate_series(1, 153) official_mesa",
        "generate_series(1, 93) covered_mesa",
        "generate_series(1, 15) result_position",
    ):
        assert required in coverage_setup
    for required in (
        "2295::bigint",
        "1395::bigint",
        "results_exploration_coverage(",
        "'status', payload->'status'",
        "'is_random_sample', payload->'is_random_sample'",
        "'observed_units', payload->'mesas_coverage'->'observed_units'",
        "'denominator_units', payload->'mesas_coverage'->'denominator_units'",
        "'source_rows', payload->'source_audit'->0->'rows'",
        "'source_mesas', payload->'source_audit'->0->'mesas'",
        "'denominator_rows', payload->'denominator_audit'->0->'rows'",
        "'denominator_mesas', payload->'denominator_audit'->0->'mesas'",
    ):
        assert required in semantic_sql
    for required in (
        "'coverage_production_rpc'",
        "'coverage_unsupported_source_audit'",
        "result_row_non_official_scope_idx",
        "shared hit blocks",
        "shared read blocks",
    ):
        assert required in plan_sql

    assert "'is_random_sample', false" in coverage_semantics
    assert re.search(r"coverage_production_rpc[^;]+<=\s*15000", coverage_plans)
    assert re.search(r"coverage_production_rpc[^;]+shared[^;]+<=\s*30000", coverage_plans)
    assert re.search(
        r"coverage_unsupported_source_audit[^;]+shared[^;]+<=\s*2500",
        coverage_plans,
    )


def test_results_exploration_release_proof_rolls_back_then_reapplies_in_order() -> None:
    sql = (SQL_TESTS / "results_exploration_release.sql").read_text(encoding="utf-8").lower()
    sequence = (
        "\\ir ../migrations/down/20260826200000_authorized_official_operations.down.sql",
        "\\ir ../migrations/down/20260826160000_authorized_official_facets.down.sql",
        "\\ir ../migrations/down/20260826120000_structured_review_scope.down.sql",
        "\\ir ../migrations/down/20260826050000_workspace_context_selection.down.sql",
        "\\ir ../migrations/down/20260826033130_session_bound_context_invalidation.down.sql",
        "\\ir ../migrations/down/"
        "20260825180048_organization_workspace_authorization_admin.down.sql",
        "\\ir ../migrations/down/"
        "20260825165116_organization_workspace_authorization_facts.down.sql",
        "\\ir ../migrations/down/20260825144358_organization_workspace_expand.down.sql",
        "\\ir ../migrations/down/20260824193650_map_pba_113_party_jurisdictions.down.sql",
        "\\ir ../migrations/down/0037_add_selector_name_canonical_fallback.down.sql",
        "\\ir ../migrations/down/0036_map_pba_party_jurisdictions.down.sql",
        "\\ir ../migrations/down/0035_reject_partial_pba_district_totals.down.sql",
        "\\ir ../migrations/down/0034_optimize_results_exploration_shape_identity.down.sql",
        "\\ir ../migrations/down/0033_optimize_results_exploration_district_metadata.down.sql",
        "\\ir ../migrations/down/0032_preaggregate_results_exploration_district.down.sql",
        "\\ir ../migrations/down/0031_replace_district_covering_index.down.sql",
        "\\ir ../migrations/down/0030_optimize_results_exploration_district.down.sql",
        "\\ir ../migrations/down/0029_optimize_results_exploration_official.down.sql",
        "\\ir ../migrations/down/0028_bound_results_exploration_cold_start.down.sql",
        "\\ir ../migrations/down/0027_optimize_non_official_source_audit.down.sql",
        "\\ir ../migrations/down/0022_results_exploration_scale.down.sql",
        "\\ir ../migrations/down/0021_results_coverage.down.sql",
        "\\ir ../migrations/down/0020_results_exploration.down.sql",
        "\\ir ../migrations/0020_results_exploration.sql",
        "\\ir ../migrations/0021_results_coverage.sql",
        "\\ir ../migrations/0022_results_exploration_scale.sql",
        "\\ir ../migrations/0027_optimize_non_official_source_audit.sql",
        "\\ir ../migrations/0028_bound_results_exploration_cold_start.sql",
        "\\ir ../migrations/0029_optimize_results_exploration_official.sql",
        "\\ir ../migrations/0030_optimize_results_exploration_district.sql",
        "\\ir ../migrations/0031_replace_district_covering_index.sql",
        "\\ir ../migrations/0032_preaggregate_results_exploration_district.sql",
        "\\ir ../migrations/0033_optimize_results_exploration_district_metadata.sql",
        "\\ir ../migrations/0034_optimize_results_exploration_shape_identity.sql",
        "\\ir ../migrations/0035_reject_partial_pba_district_totals.sql",
        "\\ir ../migrations/0036_map_pba_party_jurisdictions.sql",
        "\\ir ../migrations/0037_add_selector_name_canonical_fallback.sql",
        "\\ir ../migrations/20260824193650_map_pba_113_party_jurisdictions.sql",
        "\\ir ../migrations/20260825144358_organization_workspace_expand.sql",
        "\\ir ../migrations/20260825165116_organization_workspace_authorization_facts.sql",
        "\\ir ../migrations/20260825180048_organization_workspace_authorization_admin.sql",
        "\\ir ../migrations/20260826033130_session_bound_context_invalidation.sql",
        "\\ir ../migrations/20260826050000_workspace_context_selection.sql",
        "\\ir ../migrations/20260826120000_structured_review_scope.sql",
        "\\ir ../migrations/20260826160000_authorized_official_facets.sql",
        "\\ir ../migrations/20260826200000_authorized_official_operations.sql",
    )
    assert [sql.index(step) for step in sequence] == sorted(sql.index(step) for step in sequence)
    for required in (
        "has_function_privilege('authenticated'",
        "has_function_privilege('anon'",
        "set local role authenticated",
        "set local role anon",
        "permission denied for function results_exploration_coverage",
        "permission denied for function results_exploration_official_0020",
        "permission denied for function results_exploration_schools",
        "result_row_exploration_scope_idx",
        "result_row_non_official_scope_idx",
        "result_row_official_district_geography_idx",
        "result_row_official_district_scope_idx",
        "46 as migration_inventory_count",
        "0037 internal facets base remained directly executable",
        "dropping only its index",
    ):
        assert required in sql


def test_0028_bounds_source_backed_dimension_discovery_and_restores_0026() -> None:
    forward_path = MIGRATIONS / "0028_bound_results_exploration_cold_start.sql"
    down_path = MIGRATIONS / "down" / "0028_bound_results_exploration_cold_start.down.sql"

    assert forward_path.exists()
    assert down_path.exists()
    forward = " ".join(forward_path.read_text(encoding="utf-8").lower().split())
    for required in (
        "create or replace function results_exploration_facets(",
        "from election e where exists",
        "rr.source_kind = 'official' and rr.election_id = e.id",
        "from category c where exists",
        "rr.election_id = p_election_id and rr.category_id = c.id",
    ):
        assert required in forward
    assert "select distinct rr.election_id" not in forward
    assert "select distinct rr.category_id" not in forward
    assert "create index" not in forward

    down = " ".join(down_path.read_text(encoding="utf-8").lower().split())
    assert down.endswith("\\ir ../0026_scope_mesa_facets_to_establishment.sql")


def test_0029_scopes_official_exploration_before_row_functions() -> None:
    forward_path = MIGRATIONS / "0029_optimize_results_exploration_official.sql"
    down_path = MIGRATIONS / "down" / "0029_optimize_results_exploration_official.down.sql"

    assert forward_path.exists(), "0029 official-exploration optimization is required"
    assert down_path.exists(), "0029 official-exploration down migration is required"
    forward = " ".join(forward_path.read_text(encoding="utf-8").lower().split())
    assert "create index" not in forward
    assert "result_row_official_geography_scope_idx" not in forward
    assert "create function results_exploration_official_0029(" in forward
    core = forward.split("create function results_exploration_official_0029(", 1)[1]
    core = core.split("create or replace function results_exploration_official(", 1)[0]
    assert core.index("scoped_geography as materialized") < core.index(
        "results_exploration_reporting_level("
    )
    assert "results_exploration_official_0020" not in core
    assert "count(distinct mesa_code)" not in core
    assert "count(distinct jurisdiction_id)" in core
    assert "jurisdiction.id is the canonical normalized full-lineage mesa identity" in core
    mesa_count = core.split("'mesa_count'", 1)[1].split("'parties'", 1)[0]
    assert "where mesa_code is not null" in mesa_count
    assert "drop function results_exploration_official_0020" not in forward
    assert "alter function results_exploration_official_0020" not in forward
    assert "rename to results_exploration_official_0022" in forward
    wrapper = forward.split("create or replace function results_exploration_official(", 1)[1]
    assert "results_exploration_official_0029(" in wrapper
    assert wrapper.index("scoped_geography as materialized") < wrapper.index(
        "results_exploration_reporting_level("
    )
    assert "rr.source_kind is distinct from 'official'" in wrapper
    assert "'source_exclusions'" in wrapper
    grant_create = "grant create on schema public to results_exploration_executor"
    revoke_create = "revoke create on schema public from results_exploration_executor"
    owner_change = "owner to results_exploration_executor"
    assert forward.count(grant_create) == forward.count(revoke_create) == 1
    assert forward.count(owner_change) == 2
    assert forward.index(grant_create) < forward.index(owner_change)
    assert forward.rindex(owner_change) < forward.index(revoke_create)
    assert "statement_timeout" not in forward

    down = " ".join(down_path.read_text(encoding="utf-8").lower().split())
    assert "alter function results_exploration_official_0022(" in down
    assert "rename to results_exploration_official" in down
    assert "drop function results_exploration_official_0029(" in down
    assert "drop index" not in down
    assert "drop function results_exploration_official_0020" not in down
    assert len(down_path.read_text(encoding="utf-8").splitlines()) <= 15


def test_0027_adds_only_the_reversible_unknown_preserving_partial_index() -> None:
    forward_path = MIGRATIONS / "0027_optimize_non_official_source_audit.sql"
    down_path = MIGRATIONS / "down" / "0027_optimize_non_official_source_audit.down.sql"

    assert forward_path.exists()
    assert down_path.exists()
    forward = " ".join(forward_path.read_text(encoding="utf-8").lower().split())
    assert "create index if not exists result_row_non_official_scope_idx" in forward
    assert "on result_row (election_id, category_id, jurisdiction_id)" in forward
    assert "where source_kind is distinct from 'official'" in forward
    assert "source_kind <> 'official'" not in forward
    assert forward.count("create index") == 1
    for mutation in ("alter table", "update ", "delete from", "insert into"):
        assert mutation not in forward

    down = " ".join(down_path.read_text(encoding="utf-8").lower().split())
    assert down == "drop index if exists result_row_non_official_scope_idx;"


def test_0022_adds_a_separately_droppable_lineage_index_for_scale() -> None:
    sql = _sql("0022_results_exploration_scale.sql")
    down = MIGRATIONS / "down" / "0022_results_exploration_scale.down.sql"
    coverage = sql.split("create or replace function results_exploration_coverage", 1)[1]
    coverage = coverage.split("revoke all on function results_exploration_coverage", 1)[0]
    assert "jurisdiction_exploration_lineage_idx" in sql
    assert "distrito_code, seccion_code, circuito_code, establecimiento_code, id" in " ".join(
        sql.split()
    )
    assert all(required in sql for required in ("school_sources", "join school_sources"))
    assert all(
        forbidden not in sql
        for forbidden in ("left join school_sources", "from official_rows row_source")
    )
    assert "where circuito_code is not null and establecimiento_code is not null" in coverage
    classified = coverage.split("), fiscalizacion_classified as materialized (", 1)[1]
    classified = classified.split("), fiscalizacion_rows as materialized (", 1)[0]
    for required in (
        "rr.granularity <> 'mesa'",
        "j.circuito_code is null",
        "j.establecimiento_code is null",
        "j.mesa_code is null",
        "mesa.jurisdiction_id is null",
    ):
        assert required in classified
    assert "where exclusion_reason is null" in coverage
    assert "is not distinct from" not in coverage
    assert all(
        reason in coverage
        for reason in (
            "official_rows_without_circuito_code",
            "official_rows_without_establecimiento_code",
            "official_rows_without_circuito_and_establecimiento_code",
        )
    )
    rollback = down.read_text(encoding="utf-8").lower()
    assert "drop index if exists jurisdiction_exploration_lineage_idx" in rollback
    assert "\\ir ../0021_results_coverage.sql" in rollback


def test_0022_adds_bounded_official_section_school_breakdown_and_safe_rollback() -> None:
    sql = " ".join(_sql("0022_results_exploration_scale.sql").split())
    rollback = (
        (MIGRATIONS / "down" / "0022_results_exploration_scale.down.sql")
        .read_text(encoding="utf-8")
        .lower()
    )
    for required in (
        "results_exploration_schools",
        "rr.source_kind = 'official'",
        "group by 1",
        "order by source_kind",
        "source_exclusions",
        "group by circuito_code, establecimiento_code",
        "ambiguous_establecimiento_name",
        "exclusion_groups",
        "official_rows_without_circuito_code",
        "official_rows_without_establecimiento_code",
        "official_rows_without_circuito_and_establecimiento_code",
        "official_rows_without_mesa_code",
        "j.mesa_code",
        "payload_school_limit",
        "grant execute on function results_exploration_schools",
    ):
        assert required in sql
    assert "rr.source_kind" in sql.split("with scoped as materialized", 1)[1].split(")", 1)[0]
    assert "from scoped where source_kind = 'official'" in sql
    assert all(
        required in rollback
        for required in (
            "drop function if exists results_exploration_schools",
            "alter function results_exploration_official_0020",
        )
    )


def test_0022_official_wrapper_audits_excluded_source_kinds() -> None:
    sql = " ".join(_sql("0022_results_exploration_scale.sql").split())
    assert all(
        required in sql
        for required in (
            "alter function results_exploration_official",
            "results_exploration_official_0020",
            "'source_exclusions'",
            "rr.source_kind is distinct from 'official'",
            "when source_kind = 'fiscalizacion' then source_kind else 'unknown'",
            "group by 1",
            "order by source_kind",
        )
    )
    assert "source_kind <> 'official'" not in sql
    assert "if payload->>'status' <> 'ok' then return payload; end if" not in sql
    assert all(
        required in sql
        for required in (
            "security definer",
            "nologin",
            "nobypassrls",
            "grant authenticated to results_exploration_executor",
            "revoke all on function results_exploration_official_0020",
            "to results_exploration_executor",
        )
    )


def test_0022_coverage_and_schools_report_every_filtered_source_row() -> None:
    sql = _sql("0022_results_exploration_scale.sql")
    assert all(
        reason in sql
        for reason in (
            "official_rows_without_mesa_granularity",
            "official_rows_without_mesa_identity",
            "fiscalizacion_rows_without_mesa_granularity",
            "fiscalizacion_rows_without_mesa_identity",
            "fiscalizacion_rows_without_official_mesa_mapping",
        )
    )
    schools = sql.split("create or replace function results_exploration_schools", 1)[1]
    broad_scope = schools.split("with scoped as materialized", 1)[1].split("), official_scoped", 1)[
        0
    ]
    assert "rr.source_kind = 'official'" not in broad_scope
    assert "rr.granularity = 'mesa'" not in broad_scope
    for refusal in ("complete_school_count > payload_school_limit", "conflicting_names > 0"):
        branch = schools.split(f"if {refusal} then", 1)[1].split("end if", 1)[0]
        assert "'exclusions', exclusion_audit" in branch
        assert "'source_exclusions', source_exclusion_audit" in branch
    no_denominator = sql.split("if official_mesa_count = 0 then", 1)[1].split("end if", 1)[0]
    assert "'exclusions'" in no_denominator
    refusal_classification = sql.split("if official_mesa_count = 0 then", 1)[0]
    assert all(
        reason in refusal_classification
        for reason in (
            "official_rows_without_mesa_granularity",
            "official_rows_without_mesa_identity",
        )
    )
    assert all(
        reason in sql.split("create or replace function results_exploration_coverage", 1)[1]
        for reason in (
            "fiscalizacion_rows_without_mesa_granularity",
            "fiscalizacion_rows_without_mesa_identity",
            "fiscalizacion_rows_without_official_mesa_mapping",
        )
    )
    assert "'source_exclusions'" in schools


def test_0030_adds_geography_first_district_fast_path_and_safe_rollback() -> None:
    forward = " ".join(_sql("0030_optimize_results_exploration_district.sql").split())
    required = (
        "on result_row (jurisdiction_id, election_id, category_id)",
        "where source_kind = 'official'",
        "include (archive_entry_id, granularity, list_id, votes)",
        "create function results_exploration_official_0030(",
    )
    assert all(item in forward for item in required)
    core, wrapper = forward.split("create or replace function results_exploration_official(", 1)
    core = core.split("create function results_exploration_official_0030(", 1)[1]
    stages = tuple(
        core.index(stage)
        for stage in (
            "target_jurisdictions as materialized",
            "raw_rows as materialized",
            "source_shapes as materialized",
            "normalized_shapes as materialized",
            "classified_rows as materialized",
        )
    )
    selectors = (
        core.index("p_election_id is null"),
        core.index("select exists(select 1 from election"),
        core.index("exists(select 1 from category"),
        core.index("p_requested_level is distinct from 'distrito'"),
        stages[0],
    )
    assert list(stages) == sorted(stages) and list(selectors) == sorted(selectors)
    assert all(
        item in core
        for item in (
            "cross join lateral",
            "offset 0",
            "select distinct archive_entry_id,granularity",
            "pba_partido_rows_not_province_aggregate",
            "official_rows_without_mesa_code",
            "exclusion_groups as",
            "group by exclusion_reason",
            "'exclusions'",
            "unknown_election_id",
            "unknown_category_id",
            "jsonb_strip_nulls",
            "official rows excluded from distrito aggregation",
        )
    )
    shapes = core.split("normalized_shapes as materialized", 1)[1].split("), classified_rows", 1)[0]
    for boundary in (
        "results_exploration_reporting_level(",
        "results_exploration_party_jurisdiction(",
    ):
        assert shapes.count(boundary) == 1
    mesa_count = core.split("'mesa_count'", 1)[1].split("'parties'", 1)[0]
    assert "count(distinct jurisdiction_id)" in mesa_count
    assert "where mesa_code is not null" not in mesa_count
    assert "archive_entry_id~" not in forward
    assert "r.granularity='distrito' and s.effective_level='seccion'" in core
    assert "s.effective_level='mesa' and r.mesa_code is null" in core
    assert core.index("preaggregated as") < core.index("left join party_mapping")
    assert all(
        item in wrapper
        for item in (
            "results_exploration_official_0030(",
            "rr.source_kind is distinct from 'official'",
            "scoped_rows as materialized",
            "source_shapes as materialized",
            "normalized_shapes as materialized",
            "else 'unknown' end source_kind",
        )
    )
    assert (
        forward.index("grant create on schema public")
        < forward.index("owner to results_exploration_executor")
        < forward.index("revoke create on schema public")
    )
    down = " ".join(
        (MIGRATIONS / "down" / "0030_optimize_results_exploration_district.down.sql")
        .read_text(encoding="utf-8")
        .lower()
        .split()
    )
    assert all(
        item in down
        for item in (
            "rename to results_exploration_official",
            "drop function results_exploration_official_0030(",
            "drop index if exists result_row_official_district_geography_idx",
        )
    )
    assert not any(word in down for word in ("delete from", "update result_row", "truncate"))
    semantic_proof = " ".join(
        (SQL_TESTS / "results_exploration_scale.sql").read_text(encoding="utf-8").lower().split()
    )
    plan_proof = " ".join(
        (SQL_TESTS / "results_exploration_scale_plans.sql")
        .read_text(encoding="utf-8")
        .lower()
        .split()
    )
    shape_plan = plan_proof.split("'official_core_scope'", 1)[0].rsplit(
        "explain (analyze, buffers, format json)", 1
    )[1]
    assert all(
        item in shape_plan
        for item in (
            "cross join lateral",
            "offset 0",
            "source_shapes as materialized",
            "normalized_shapes as materialized",
            "results_exploration_reporting_level(",
        )
    )
    assert "select plan(15)" in plan_proof
    assert "selected_shapes<>1" in semantic_proof


def test_0031_replaces_only_the_district_index_with_scope_first_order() -> None:
    forward_path = MIGRATIONS / "0031_replace_district_covering_index.sql"
    down_path = MIGRATIONS / "down" / "0031_replace_district_covering_index.down.sql"

    assert forward_path.exists(), "0031 district covering-index correction is required"
    assert down_path.exists(), "0031 district covering-index down migration is required"

    forward = " ".join(forward_path.read_text(encoding="utf-8").lower().split())
    assert forward.startswith("-- 0031") and forward.endswith("commit;")
    header, statements = forward.split("begin;", 1)
    # The header must name the access path the reorder serves and the measured evidence,
    # so a later reader can tell why the 0030 column order was reversed.
    for required in (
        "election_id and category_id",
        "shared blocks",
        "seq scan",
        "no planner hints",
    ):
        assert required in header
    assert "drop index if exists result_row_official_district_geography_idx" in statements
    assert "create index if not exists result_row_official_district_scope_idx" in statements
    assert "on result_row (election_id, category_id, jurisdiction_id)" in statements
    assert "include (archive_entry_id, granularity, list_id, votes)" in statements
    assert "where source_kind = 'official'" in statements
    assert statements.count("drop index") == statements.count("create index") == 1
    for forbidden in ("alter function", "create function", "update ", "delete from", "truncate"):
        assert forbidden not in statements

    down = " ".join(down_path.read_text(encoding="utf-8").lower().split())
    assert down.startswith("begin;") and down.endswith("commit;")
    assert "drop index if exists result_row_official_district_scope_idx" in down
    assert "create index if not exists result_row_official_district_geography_idx" in down
    assert "on result_row (jurisdiction_id, election_id, category_id)" in down
    assert "include (archive_entry_id, granularity, list_id, votes)" in down
    assert "where source_kind = 'official'" in down
    assert down.count("drop index") == down.count("create index") == 1
    for forbidden in ("alter function", "create function", "update ", "delete from", "truncate"):
        assert forbidden not in down

    plan_proof = " ".join(
        (SQL_TESTS / "results_exploration_scale_plans.sql")
        .read_text(encoding="utf-8")
        .lower()
        .split()
    )
    district_contract = plan_proof.split("select ok((select label = 'official_core_scope'", 1)[1]
    district_contract = district_contract.split(
        "select ok((select label = 'coverage_production_rpc'", 1
    )[0]
    assert (
        district_contract.count("plan::text like '%result_row_official_district_scope_idx%'") == 2
    )
    assert (
        district_contract.count(
            "plan::text not like '%result_row_official_district_geography_idx%'"
        )
        == 2
    )
    assert '"node type" == "seq scan" && @."relation name" == "result_row"' in district_contract
    assert "execution time')::numeric<=2000" in district_contract
    assert "shared read blocks')::bigint,0)<=8500" in district_contract
    assert (
        "distrito 05 adds 581,400 entries to this same election/category partial index"
        in plan_proof
    )
    assert "larger b-tree increases its page depth and page access" in plan_proof
    assert "enable_seqscan" not in plan_proof and "enable_nestloop" not in plan_proof


def test_0032_preaggregates_district_classification_and_metadata_with_safe_rollback() -> None:
    forward_path = MIGRATIONS / "0032_preaggregate_results_exploration_district.sql"
    down_path = MIGRATIONS / "down" / "0032_preaggregate_results_exploration_district.down.sql"
    forward = " ".join(forward_path.read_text(encoding="utf-8").lower().split())
    down = " ".join(down_path.read_text(encoding="utf-8").lower().split())

    assert forward.startswith("-- 0032") and forward.endswith("commit;")
    assert "create function results_exploration_official_0032(" in forward
    assert "rename to results_exploration_official_wrapper_0031" in forward
    core = forward.split("create function results_exploration_official_0032(", 1)[1]
    core = core.split("create or replace function results_exploration_official(", 1)[0]
    stages = tuple(
        core.index(stage)
        for stage in (
            "target_jurisdictions as materialized",
            "raw_rows as materialized",
            "source_summaries as materialized",
            "normalized_shapes as materialized",
            "exclusion_groups as materialized",
            "levels as materialized",
            "state as materialized",
            "selected_by_archive_party as materialized",
        )
    )
    assert list(stages) == sorted(stages)
    for invariant in (
        "pba_partido_rows_not_province_aggregate",
        "official_rows_without_mesa_code",
        "row_count-missing_mesa_rows",
        "array_agg(distinct r.jurisdiction_id)",
        "count(distinct jurisdiction_id)",
        "source_audit",
        "archive_entry_ids",
        "results_exploration_official_0029(",
        "jsonb_build_array(n.archive_entry_id,n.granularity,n.seccion_code)",
        "jsonb_build_array(r.archive_entry_id,r.granularity,r.seccion_code)",
    ):
        assert invariant in core
    assert "coalesce(n.seccion_code,chr(1))" not in core
    assert core.count("results_exploration_reporting_level(") == 1
    assert core.count("results_exploration_party_jurisdiction(") == 1
    assert "classified_rows as materialized" not in core
    assert "selected as materialized" not in core
    assert "statement_timeout" not in forward
    assert "create index" not in forward
    assert "drop index" not in forward
    assert (
        forward.index("grant create on schema public")
        < forward.index("owner to results_exploration_executor")
        < forward.index("revoke create on schema public")
    )
    wrapper = forward.split("create or replace function results_exploration_official(", 1)[1]
    assert "results_exploration_official_0032(" in wrapper
    assert "rr.source_kind is distinct from 'official'" in wrapper
    assert "'source_exclusions'" in wrapper

    assert down.startswith("begin;") and down.endswith("commit;")
    assert "rename to results_exploration_official" in down
    assert "drop function results_exploration_official_0032(" in down
    assert "results_exploration_official_0030" not in down
    assert not any(word in down for word in ("delete from", "update result_row", "truncate"))

    scale_setup = " ".join(
        (SQL_TESTS / "results_exploration_scale_setup.sql")
        .read_text(encoding="utf-8")
        .lower()
        .split()
    )
    scale_proof = " ".join(
        (SQL_TESTS / "results_exploration_scale.sql").read_text(encoding="utf-8").lower().split()
    )
    scale_plans = " ".join(
        (SQL_TESTS / "results_exploration_scale_plans.sql")
        .read_text(encoding="utf-8")
        .lower()
        .split()
    )
    for evidence in (
        "from generate_series(1,78962) unit",
        "from generate_series(1,581400) row_number",
        "fiscalizacion/production-district-shape",
    ):
        assert evidence in scale_setup
    for evidence in (
        "source_shapes',count(distinct",
        "sections',count(distinct",
        "canonical_party_id='scale-canonical' and verified",
        "results_exploration_official(",
        "results_exploration_official_0035(",
        "results_exploration_official_0034(",
        "results_exploration_official_wrapper_0034(",
        "p_requested_level=>'distrito'",
        "public_elapsed_ms<=3000",
        "new public district wrapper exactly preserves the real 0034 public wrapper jsonb payload",
        "0035 district core exactly preserves the full realistic 0034 jsonb payload",
        "null and literal chr(1) sections preserve the full reference core jsonb payload",
        "null and literal chr(1) sections preserve the full reference public jsonb payload",
        "null and literal chr(1) sections retain explicit two-row and 24-vote diagnostics",
    ):
        assert evidence in scale_proof
    for evidence in (
        "production district core stays within 3000ms",
        "public district wrapper stays within 3000ms",
    ):
        assert evidence in scale_plans


def test_0033_materializes_narrow_selected_rows_for_party_and_metadata_aggregation() -> None:
    forward_path = MIGRATIONS / "0033_optimize_results_exploration_district_metadata.sql"
    down_path = MIGRATIONS / "down" / "0033_optimize_results_exploration_district_metadata.down.sql"
    assert forward_path.exists(), "0033 district metadata optimization migration is required"
    assert down_path.exists(), "0033 district metadata optimization down migration is required"

    forward = " ".join(forward_path.read_text(encoding="utf-8").lower().split())
    down = " ".join(down_path.read_text(encoding="utf-8").lower().split())
    assert forward.startswith("-- 0033") and forward.endswith("commit;")
    assert "rename to results_exploration_official_wrapper_0032" in forward
    assert "create function results_exploration_official_0033(" in forward
    core = forward.split("create function results_exploration_official_0033(", 1)[1]
    core = core.split("create or replace function results_exploration_official(", 1)[0]
    assert core.count("selected_rows as materialized") == 1
    selected_rows = core.split("selected_rows as materialized", 1)[1].split(
        "), selected_by_archive_party", 1
    )[0]
    assert (
        "select r.archive_entry_id,n.mapping_jurisdiction,r.list_id,r.votes,r.jurisdiction_id "
        "from raw_rows r"
    ) in selected_rows
    selected_party = core.split("selected_by_archive_party as materialized", 1)[1].split(
        "), preaggregated", 1
    )[0]
    assert "from selected_rows" in selected_party
    selected_metadata = core.split("selected_metadata as", 1)[1].split("), archive_entries", 1)[0]
    assert "count(*)::bigint rows" in selected_metadata
    assert "coalesce(sum(votes),0)::bigint votes" in selected_metadata
    assert "count(distinct jurisdiction_id)::bigint mesa_count" in selected_metadata
    assert "from selected_rows" in selected_metadata
    archive_entries = core.split("archive_entries as", 1)[1].split("select case", 1)[0]
    assert "from selected_rows" in archive_entries
    assert "array_agg(distinct" not in core
    assert "jurisdiction_ids" not in core
    assert "statement_timeout" not in forward
    assert "work_mem" not in forward
    assert "create index" not in forward
    assert not any(token in forward for token in ("delete from", "update result_row", "truncate"))
    wrapper = forward.split("create or replace function results_exploration_official(", 1)[1]
    assert "results_exploration_official_0033(" in wrapper
    assert "rr.source_kind is distinct from 'official'" in wrapper
    for preserved in (
        "results_exploration_official_0033",
        "results_exploration_official_wrapper_0032",
    ):
        signature = f"{preserved}(uuid,uuid,text,text,text,text,integer,text)"
        assert f"revoke all on function {signature} from public,anon,authenticated" in forward
    assert forward.count("owner to results_exploration_executor") == 2

    assert down.startswith("begin;") and down.endswith("commit;")
    assert "rename to results_exploration_official" in down
    assert "drop function results_exploration_official_0033(" in down
    assert "drop function results_exploration_official_0032(" not in down
    assert not any(token in down for token in ("delete from", "update result_row", "truncate"))


def test_0034_uses_one_null_safe_text_array_shape_identity_per_raw_row() -> None:
    forward_path = MIGRATIONS / "0034_optimize_results_exploration_shape_identity.sql"
    down_path = MIGRATIONS / "down" / "0034_optimize_results_exploration_shape_identity.down.sql"
    assert forward_path.exists(), "0034 shape-identity optimization migration is required"
    assert down_path.exists(), "0034 shape-identity optimization down migration is required"

    forward = " ".join(forward_path.read_text(encoding="utf-8").lower().split())
    down = " ".join(down_path.read_text(encoding="utf-8").lower().split())
    assert forward.startswith("-- 0034") and forward.endswith("commit;")
    assert "rename to results_exploration_official_wrapper_0033" in forward
    assert "create function results_exploration_official_0034(" in forward
    core = forward.split("create function results_exploration_official_0034(", 1)[1]
    core = core.split("create or replace function results_exploration_official(", 1)[0]
    raw_rows = core.split("raw_rows as materialized", 1)[1].split(
        "), source_summaries as materialized", 1
    )[0]
    assert (
        "array[fact.archive_entry_id,fact.granularity,j.seccion_code]::text[] shape_key" in raw_rows
    )
    assert core.count("::text[] shape_key") == 1
    source_summaries = core.split("source_summaries as materialized", 1)[1].split(
        "), normalized_shapes as materialized", 1
    )[0]
    assert "select shape_key,archive_entry_id,granularity,seccion_code" in source_summaries
    assert "group by shape_key,archive_entry_id,granularity,seccion_code" in source_summaries
    selected_rows = core.split("selected_rows as materialized", 1)[1].split(
        "), selected_by_archive_party", 1
    )[0]
    assert "on n.shape_key=r.shape_key" in selected_rows
    assert "jsonb_build_array(n.archive_entry_id,n.granularity,n.seccion_code)" not in core
    assert "jsonb_build_array(r.archive_entry_id,r.granularity,r.seccion_code)" not in core
    assert "chr(" not in core
    assert "statement_timeout" not in forward
    assert "work_mem" not in forward
    assert "create index" not in forward
    wrapper = forward.split("create or replace function results_exploration_official(", 1)[1]
    assert "results_exploration_official_0034(" in wrapper
    for internal in (
        "results_exploration_official_0034",
        "results_exploration_official_wrapper_0033",
    ):
        signature = f"{internal}(uuid,uuid,text,text,text,text,integer,text)"
        assert f"revoke all on function {signature} from public,anon,authenticated" in forward
        assert f"grant execute on function {signature} to results_exploration_executor" in forward
    assert forward.count("owner to results_exploration_executor") == 2

    assert down.startswith("begin;") and down.endswith("commit;")
    assert "alter function results_exploration_official_wrapper_0033(" in down
    assert "rename to results_exploration_official" in down
    assert "drop function results_exploration_official_0034(" in down
    assert "drop function results_exploration_official_0033(" not in down


def test_0037_adds_conflict_checked_selector_name_fallback_without_mutating_data() -> None:
    forward_path = MIGRATIONS / "0037_add_selector_name_canonical_fallback.sql"
    down_path = MIGRATIONS / "down" / "0037_add_selector_name_canonical_fallback.down.sql"

    assert forward_path.exists(), "0037 selector-name fallback migration is required"
    assert down_path.exists(), "0037 selector-name fallback down migration is required"

    forward = " ".join(forward_path.read_text(encoding="utf-8").lower().split())
    down = " ".join(down_path.read_text(encoding="utf-8").lower().split())
    signature = "results_exploration_facets(uuid,uuid,text,text,text,text)"
    internal_signature = "results_exploration_facets_0036(uuid,uuid,text,text,text,text)"

    assert f"alter function {signature} rename to results_exploration_facets_0036" in forward
    assert "create function results_exploration_facets(" in forward
    assert "language sql stable security invoker" in forward
    assert "set search_path = public, pg_temp" in forward
    assert "lower(btrim(name))" in forward
    assert "selected_variant_count > 0" in forward
    assert "selected_variant_count = 0" in forward
    assert "j.distrito_code = o.code" in forward
    assert "j.distrito_code = p_distrito_code" in forward
    assert "j.seccion_code = o.code" in forward
    assert "btrim(name) = upper(btrim(name))" in forward
    blank_name_filter = "filter (where name is not null and btrim(name) <> '')"
    assert forward.count(blank_name_filter) == 8
    assert "lower(trim(name))" not in forward
    assert "select results_exploration_facets_0036(" not in forward
    assert "jsonb_build_object" in forward
    assert "'distritos'" in forward and "'secciones'" in forward
    assert "update jurisdiction" not in forward
    assert "insert into jurisdiction" not in forward
    for role in ("public", "anon", "authenticated"):
        assert f"revoke all on function {internal_signature} from {role}" in forward
    assert f"drop function {signature}" in down
    assert f"alter function {internal_signature} rename to results_exploration_facets" in down
    assert "grant execute on function results_exploration_facets" in down


def test_0036_maps_pba_party_jurisdictions_and_restores_the_previous_boundary() -> None:
    forward_path = MIGRATIONS / "0036_map_pba_party_jurisdictions.sql"
    down_path = MIGRATIONS / "down" / "0036_map_pba_party_jurisdictions.down.sql"
    assert forward_path.exists(), "0036 PBA party-jurisdiction migration is required"
    assert down_path.exists(), "0036 PBA party-jurisdiction down migration is required"

    forward = " ".join(forward_path.read_text(encoding="utf-8").lower().split())
    down = " ".join(down_path.read_text(encoding="utf-8").lower().split())
    signature = "results_exploration_party_jurisdiction(text,integer,text,text,text,text)"
    for sql in (forward, down):
        assert sql.startswith("begin;") and sql.endswith("commit;")
        assert "create or replace function results_exploration_party_jurisdiction(" in sql
        assert "language sql immutable strict security invoker" in sql
        assert "set search_path = public, pg_temp" in sql
        assert f"revoke all on function {signature} from public,anon" in sql
        assert f"grant execute on function {signature} to authenticated" in sql

    pba_mapping_branches = [
        predicate
        for predicate in re.findall(
            r"when (.*?) then '(?:coronel_rosales_municipal|pba_provincial)'", forward
        )
        if "p_round = 'provinciales'" in predicate
    ]
    assert len(pba_mapping_branches) == 2
    for predicate in pba_mapping_branches:
        assert "p_archive_entry_id = 'pba/2025-distrito-027'" in predicate
        assert "p_archive_entry_id ~" not in predicate
        assert "p_year = 2025" in predicate
        assert "p_round = 'provinciales'" in predicate
        assert "p_distrito_code = '02'" in predicate
        assert "p_seccion_code = '027'" in predicate
    assert "p_category = 'concejales'" in forward
    assert "then 'coronel_rosales_municipal'" in forward
    assert "p_category = 'diputados provinciales'" in forward
    for preserved in (
        "p_archive_entry_id ~ '^national/2023-'",
        "p_category = 'concejales'",
        "then 'coronel_rosales_municipal'",
        "p_archive_entry_id ~ '^national/' then 'national'",
    ):
        assert preserved in forward
        assert preserved in down
    assert "pba_provincial" not in down
    assert "p_round = 'provinciales'" not in down


def test_timestamped_migration_maps_only_pba_113_party_jurisdictions_and_restores_0037() -> None:
    migration_version = "20260824193650"
    forward_path = MIGRATIONS / f"{migration_version}_map_pba_113_party_jurisdictions.sql"
    down_path = (
        MIGRATIONS / "down" / f"{migration_version}_map_pba_113_party_jurisdictions.down.sql"
    )
    assert forward_path.exists(), "timestamped PBA 113 reachability migration is required"
    assert down_path.exists(), "timestamped PBA 113 reachability down migration is required"

    forward = " ".join(forward_path.read_text(encoding="utf-8").lower().split())
    down = " ".join(down_path.read_text(encoding="utf-8").lower().split())
    signature = "results_exploration_party_jurisdiction(text,integer,text,text,text,text)"
    for migration in (forward, down):
        assert migration.startswith("begin;") and migration.endswith("commit;")
        assert "create or replace function results_exploration_party_jurisdiction(" in migration
        assert "language sql immutable strict security invoker" in migration
        assert "set search_path = public, pg_temp" in migration
        assert f"revoke all on function {signature} from public,anon" in migration
        assert f"grant execute on function {signature} to authenticated" in migration
        assert "alter function results_exploration_official" not in migration

    pba_113_branches = [
        predicate
        for predicate in re.findall(
            r"when (.*?) then '(?:tigre_municipal|pba_provincial)'", forward
        )
        if "p_archive_entry_id = 'pba/2025-distrito-113'" in predicate
    ]
    assert len(pba_113_branches) == 2
    for predicate in pba_113_branches:
        assert "p_year = 2025" in predicate
        assert "p_round = 'provinciales'" in predicate
        assert "p_distrito_code = '02'" in predicate
        assert "p_seccion_code = '113'" in predicate
        assert "p_archive_entry_id ~" not in predicate
    assert "p_category = 'senadores provinciales'" in forward
    assert "p_category = 'concejales'" in forward
    assert "then 'tigre_municipal'" in forward
    assert "pba/2025-distrito-113" not in down
    assert "tigre_municipal" not in down
    for preserved in (
        "p_archive_entry_id = 'pba/2025-distrito-027'",
        "then 'coronel_rosales_municipal'",
        "p_category = 'diputados provinciales'",
        "p_archive_entry_id ~ '^national/' then 'national'",
    ):
        assert preserved in forward
        assert preserved in down


def test_0035_rejects_pba_section_sources_for_district_requests_by_provenance() -> None:
    forward_path = MIGRATIONS / "0035_reject_partial_pba_district_totals.sql"
    down_path = MIGRATIONS / "down" / "0035_reject_partial_pba_district_totals.down.sql"
    assert forward_path.exists(), "0035 PBA district-total safety migration is required"
    assert down_path.exists(), "0035 PBA district-total safety down migration is required"

    forward = " ".join(forward_path.read_text(encoding="utf-8").lower().split())
    down = " ".join(down_path.read_text(encoding="utf-8").lower().split())
    assert forward.startswith("-- 0035") and forward.endswith("commit;")
    assert "rename to results_exploration_official_wrapper_0034" in forward
    assert "create function results_exploration_official_0035(" in forward
    core = forward.split("create function results_exploration_official_0035(", 1)[1]
    core = core.split("create or replace function results_exploration_official(", 1)[0]
    exclusion = core.split("'pba_partido_rows_not_province_aggregate'::text", 1)[1].split(
        "union all", 1
    )[0]
    assert "archive_entry_id~'^pba/[0-9]{4}-distrito-[0-9]+$'" in exclusion
    assert "effective_level='seccion'" in exclusion
    assert "granularity='distrito'" not in exclusion
    selected_rows = core.split("selected_rows as materialized", 1)[1].split(
        "), selected_by_archive_party", 1
    )[0]
    assert "archive_entry_id~'^pba/[0-9]{4}-distrito-[0-9]+$'" in selected_rows
    assert "effective_level='seccion'" in selected_rows
    assert "granularity='distrito'" not in selected_rows
    assert "results_exploration_official_0034(" in core
    assert "create index" not in forward
    for forbidden in (
        "statement_timeout",
        "work_mem",
        "delete from",
        "update result_row",
        "truncate",
    ):
        assert forbidden not in forward
    wrapper = forward.split("create or replace function results_exploration_official(", 1)[1]
    assert "results_exploration_official_0035(" in wrapper
    assert "archive_entry_id~'^pba/[0-9]{4}-distrito-[0-9]+$'" not in wrapper
    for required_audit_scope in (
        "rr.source_kind is distinct from 'official'",
        "payload->>'status'<>'ok' or effective_level=payload->>'source_granularity'",
        "p_seccion_code is null or seccion_code=p_seccion_code or effective_level='distrito'",
        "p_circuito_code is null or circuito_code=p_circuito_code or "
        "effective_level in ('distrito','seccion')",
        "p_establecimiento_code is null or establecimiento_code=p_establecimiento_code",
        "p_mesa_code is null or mesa_code=p_mesa_code or effective_level<>'mesa'",
    ):
        assert required_audit_scope in wrapper
    assert "granularity='distrito' and effective_level='seccion'" not in wrapper
    for internal in (
        "results_exploration_official_0035",
        "results_exploration_official_wrapper_0034",
    ):
        signature = f"{internal}(uuid,uuid,text,text,text,text,integer,text)"
        assert f"revoke all on function {signature} from public,anon,authenticated" in forward
        assert f"grant execute on function {signature} to results_exploration_executor" in forward
    assert forward.count("owner to results_exploration_executor") == 2

    assert down.startswith("begin;") and down.endswith("commit;")
    assert "alter function results_exploration_official_wrapper_0034(" in down
    assert "rename to results_exploration_official" in down
    assert "drop function results_exploration_official_0035(" in down
    assert "drop function results_exploration_official_0034(" not in down

    functional = " ".join(
        (SQL_TESTS / "results_exploration.sql").read_text(encoding="utf-8").lower().split()
    )
    for evidence in (
        "'seccion', '78', 29, 'official', 'pba/2025-distrito-027'",
        "'seccion', null, 43, 'fiscalizacion', 'pba/2025-distrito-027'",
        '"source_exclusions":[{"kind":"fiscalizacion","rows":1,"votes":43}]',
        "province refusal audits nonofficial pba section rows without admitting them "
        "to official figures",
        "legacy stored-distrito pba partido rows remain excluded",
        "national mesa-backed source remains eligible for district aggregation",
        "normalized 02/027 pba total is reachable as a section result",
    ):
        assert evidence in functional


def test_scale_proof_binds_the_district_index_contract_to_the_production_rpc() -> None:
    """The index contract must hold on the entry point, not only on hand-written replicas.

    EXPLAIN of a SQL function call reports a bare Result node and no nested plans, so index
    identity and sequential-scan absence cannot be read from the district_rpc plan. They are
    proven instead from pg_stat counter deltas taken around a real RPC call.
    """
    raw = (SQL_TESTS / "results_exploration_scale_plans.sql").read_text(encoding="utf-8").lower()
    scale = " ".join(raw.split())
    # Statements only: the surrounding prose explains why replicas are insufficient, so it
    # names the very constructs the measured block must not execute.
    statements = " ".join(re.sub(r"--[^\n]*", "", raw).split())

    block = statements.split("do $$ declare district_seq_before", 1)[1].split("end $$;", 1)[0]

    # pg_stat_get_xact_numscans is transaction-scoped and needs no flush, so concurrent
    # backends cannot inflate the readings and the measurement lives beside its assertions.
    # The cluster-wide views must not be used for this contract.
    for cluster_wide in ("pg_stat_user_indexes", "pg_stat_user_tables", "pg_stat_force_next_flush"):
        assert cluster_wide not in statements

    # A missing index must abort loudly. Reading a counter for an index that is not there
    # would otherwise let both readings agree and render absence of evidence as proof.
    assert "to_regclass('public.result_row_official_district_scope_idx')" in block
    assert "if district_index is null then raise exception" in block

    # Ordering is the whole contract: both before-readings precede the call and both
    # after-readings follow it, or the deltas measure nothing.
    call = block.index("results_exploration_official(")
    for before in ("district_seq_before :=", "district_idx_before :="):
        assert block.index(before) < call, f"{before} must be read before the RPC call"
    for after in ("district_seq_after :=", "district_idx_after :="):
        assert block.index(after) > call, f"{after} must be read after the RPC call"
    assert block.count("results_exploration_official(") == 1
    assert "p_requested_level=>'distrito'" in block
    for replica in ("explain", "as materialized", "cross join lateral"):
        assert replica not in block

    assert "select plan(15);" in scale
    # One public wrapper invocation dispatches once to the batched core. The small physical-scan
    # allowance accommodates planner/parallel shape while still rejecting both no access and the
    # old scan-per-jurisdiction algorithm.
    assert "index_scans between 1 and 4" in scale
    assert "index_scans >= jurisdiction_count" not in scale
    assert "table_scans = 0" in scale


_WORKSPACE_ROLES = (
    "workspace_bootstrap_owner workspace_bootstrap_caller workspace_context_owner "
    "workspace_query_owner workspace_admin_owner workspace_review_ingest_owner "
    "workspace_audit_owner workspace_platform_admin"
).split()


def _workspace_foundation_migrations() -> tuple[str, Path, str]:
    matches = list(MIGRATIONS.glob("*_organization_workspace_expand.sql"))
    assert len(matches) == 1
    forward_path = matches[0]
    version = forward_path.name.removesuffix("_organization_workspace_expand.sql")
    assert version.isdigit() and len(version) == 14
    down_path = MIGRATIONS / "down" / f"{version}_organization_workspace_expand.down.sql"
    forward = forward_path.read_text(encoding="utf-8").lower()
    assert forward.strip(), "the generated workspace migration must be implemented"
    assert down_path.exists(), "the matching generated down migration is required"
    return forward, down_path, down_path.read_text(encoding="utf-8").lower()


def test_organization_workspace_foundation_is_additive_and_closed_by_default() -> None:
    forward, _, _ = _workspace_foundation_migrations()
    sql = " ".join(forward.split())
    assert forward.startswith("begin;") and forward.rstrip().endswith("commit;")
    for schema in ("workspace_private", "workspace_api"):
        assert f"create schema {schema}" in sql
        assert f"revoke all on schema {schema} from public" in sql
    assert "foreach client_role in array array['anon', 'authenticated', 'service_role']" in sql
    assert "if to_regrole(client_role) is not null" in sql
    assert "revoke all on schema workspace_private from %i" in sql
    assert "revoke all on schema workspace_api from %i" in sql
    for role in _WORKSPACE_ROLES:
        assert f"'{role}'" in sql
    role_flags = "nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls"
    assert role_flags in sql
    api_usage = (
        "grant usage on schema workspace_api to workspace_context_owner, workspace_query_owner"
    )
    assert api_usage in sql
    assert "grant create on schema workspace" not in sql
    assert "revoke create on schema public" in sql
    assert "acldefault" in sql and "acl.grantee = 0" in sql
    forbidden = (
        "create table",
        "create sequence",
        "create function",
        "security definer",
        "enable row level security",
        "create policy",
        "auth.",
        "password",
        "revoke temp",
    )
    assert not any(token in sql for token in forbidden)


def test_organization_workspace_defaults_and_down_are_bounded_and_fail_closed() -> None:
    forward, down_path, down = _workspace_foundation_migrations()
    sql = " ".join(forward.split())
    rollback = " ".join(down.split())
    global_function_revoke = (
        "alter default privileges for role %i revoke execute on functions from public"
    )
    assert sql.count(global_function_revoke) == 1
    assert "foreach owner_role in array workspace_roles" in sql
    assert "default_owners" not in sql
    assert "alter default privileges for role %i in schema" not in sql
    assert "on tables" not in sql and "on sequences" not in sql
    assert "foreach" in sql and "execute format" in sql and "pg_auth_members" in sql
    assert "edge.admin_option and not edge.inherit_option and not edge.set_option" in sql

    assert down_path.name == "20260825144358_organization_workspace_expand.down.sql"
    assert down.startswith("begin;") and down.rstrip().endswith("commit;")
    assert "migration_creator" not in rollback and "default_owners" not in rollback
    assert "pg_depend" in rollback and "pg_describe_object" in rollback
    default_acl_guard = rollback.split("select string_agg( pg_describe_object", 1)[0]
    for required in (
        "pg_default_acl",
        "defaults.defaclnamespace = 0",
        "owner.rolname = any(workspace_roles)",
        "defaults.defaclobjtype <> 'f'",
        "count(*)",
        "count(distinct defaults.defaclrole)",
        "cardinality(workspace_roles)",
        "aclexplode",
        "acl.grantor = defaults.defaclrole",
        "acl.grantee = defaults.defaclrole",
        "acl.privilege_type = 'execute'",
        "not acl.is_grantable",
        "unexpected schema-scoped entries",
    ):
        assert required in default_acl_guard
    schema_default_guard = "namespace.nspname = any(array['workspace_private', 'workspace_api'])"
    assert schema_default_guard in default_acl_guard
    assert "raise exception" in rollback
    assert rollback.count("for role %i grant execute on functions to public") == 1
    assert "foreach owner_role in array workspace_roles" in rollback
    assert "in schema %i revoke execute on functions from public" not in rollback
    assert rollback.index("workspace rollback refused default acls") < rollback.index(
        "select string_agg( pg_describe_object"
    )
    for schema in ("workspace_api", "workspace_private"):
        assert f"drop schema {schema}" in rollback
    for role in _WORKSPACE_ROLES:
        assert f"drop role {role}" in rollback
    assert not any(
        token in rollback for token in ("cascade", "drop owned", "drop table", "drop function")
    )


def test_organization_workspace_authority_facts_are_closed_and_reversible() -> None:
    version = "20260825165116"
    forward_path = MIGRATIONS / f"{version}_organization_workspace_authorization_facts.sql"
    down_path = (
        MIGRATIONS / "down" / f"{version}_organization_workspace_authorization_facts.down.sql"
    )
    assert forward_path.read_text(encoding="utf-8").strip(), "authority-facts migration is empty"
    assert down_path.exists(), "authority-facts down migration is required"
    forward = " ".join(forward_path.read_text(encoding="utf-8").lower().split())
    down = " ".join(down_path.read_text(encoding="utf-8").lower().split())

    tables = (
        "organization organization_membership section_scope "
        "organization_section_entitlement workspace_audit_event"
    ).split()
    for table in tables:
        assert f"create table workspace_private.{table}" in forward
        assert f"alter table workspace_private.{table} enable row level security" in forward
        assert f"alter table workspace_private.{table} force row level security" in forward
        assert f"revoke all on table workspace_private.{table} from public" in forward
        assert f"drop table workspace_private.{table}" in down
    assert forward.count("owner to workspace_admin_owner") == 5
    assert forward.count("owner to workspace_audit_owner") == 1
    assert forward.count("create policy workspace_admin_owner_") == 4
    assert "function workspace_private.authorization_facts_status()" in forward
    assert "security definer" in forward
    assert "references auth." not in forward
    assert "on delete restrict" in forward
    assert "where revoked_at is null" in forward
    assert "organization_section_entitlement_scope_idx" in forward
    assert (
        "workspace_private.organization_section_entitlement (distrito_code, seccion_code)"
        in forward
    )
    assert "actor_ref is null or" in forward
    assert "jsonb_typeof(detail) = 'object'" in forward
    assert "create table public." not in forward
    for value in (
        "platform_operator",
        "organization_user",
        "system",
        "etl",
        "organization_created",
        "organization_disabled",
        "membership_granted",
        "membership_revoked",
        "section_scope_registered",
        "section_entitlement_granted",
        "section_entitlement_revoked",
        "context_bootstrapped",
        "context_switched",
        "context_invalidated",
        "context_revoked",
        "authorization_denied",
        "review_scope_recorded",
        "review_visibility_denied",
        "succeeded",
        "denied",
        "no_op",
        "operator_request",
        "same_state",
        "scope_invalid",
        "claims_mismatch",
        "context_conflict",
        "bearer_invalid",
        "platform_only_review",
        "organization_switched",
    ):
        assert f"'{value}'" in forward
    for forbidden in ("email", "token", "password", "dsn", "cascade"):
        assert forbidden not in forward
    assert "raise exception 'authority-facts rollback refused" in down
    assert "cascade" not in down
    assert down.index("drop table workspace_private.workspace_audit_event") < down.index(
        "drop table workspace_private.organization"
    )


def test_organization_workspace_section_scope_requires_canonical_national_codes() -> None:
    migration = _sql("20260825165116_organization_workspace_authorization_facts.sql")
    sql = " ".join(migration.split())
    section_scope_codes = (
        "constraint section_scope_codes_check check "
        "(distrito_code = btrim(distrito_code) and distrito_code <> '' "
        "and distrito_code ~ '^[0-9]{2}$' and seccion_code = btrim(seccion_code) "
        "and seccion_code <> '' and seccion_code ~ '^[0-9]{3}$')"
    )

    assert section_scope_codes in sql


def test_workspace_admin_boundary_is_private_rls_backed_and_reversible() -> None:
    version = "20260825180048"
    forward_path = MIGRATIONS / f"{version}_organization_workspace_authorization_admin.sql"
    down_path = (
        MIGRATIONS / "down" / f"{version}_organization_workspace_authorization_admin.down.sql"
    )
    assert forward_path.read_text(encoding="utf-8").strip(), "workspace admin migration is empty"
    assert down_path.exists(), "workspace admin down migration is required"
    forward = " ".join(forward_path.read_text(encoding="utf-8").lower().split())
    down = " ".join(down_path.read_text(encoding="utf-8").lower().split())
    functions = (
        "append_audit_event create_organization disable_organization grant_membership "
        "revoke_membership register_section_scope grant_section_entitlement "
        "revoke_section_entitlement"
    ).split()
    for function in functions:
        assert f"function workspace_private.{function}" in forward
        assert "security definer set search_path=pg_catalog,workspace_private,pg_temp" in forward
        assert f"revoke all on function workspace_private.{function}" in forward
        assert f"drop function workspace_private.{function}" in down
        assert "grant execute on function workspace_private.append_audit_event" in forward
    assert "to workspace_admin_owner" in forward
    assert forward.count("to workspace_platform_admin") == 7
    for table in (
        "organization organization_membership section_scope "
        "organization_section_entitlement workspace_audit_event"
    ).split():
        assert "create policy workspace_" in forward
        assert f"on workspace_private.{table}" in forward
    assert "for delete" not in forward
    assert "execute format" not in forward and "execute immediate" not in forward
    assert "public.jurisdiction" in forward
    assert "raise exception 'workspace-admin rollback refused" in down
    assert "cascade" not in down
    for forbidden in ("email", "token", "password", "dsn", "auth."):
        assert forbidden not in forward


def test_authority_facts_migrations_preserve_runner_owner_set_authority() -> None:
    version = "20260825165116"
    migrations = (
        _sql(f"{version}_organization_workspace_authorization_facts.sql"),
        (MIGRATIONS / "down" / f"{version}_organization_workspace_authorization_facts.down.sql")
        .read_text(encoding="utf-8")
        .lower(),
    )

    set_authority_capture = (
        "select pg_has_role(current_user,'workspace_admin_owner','set'), "
        "pg_has_role(current_user,'workspace_audit_owner','set') "
        "into admin_could_set, audit_could_set;"
    )
    set_authority_variables = {
        "workspace_admin_owner": "admin_could_set",
        "workspace_audit_owner": "audit_could_set",
    }

    for migration in migrations:
        sql = " ".join(migration.split())
        assert set_authority_capture in sql
        for role, authority_variable in set_authority_variables.items():
            setting = f"votus_pr3a.{role}_could_set"
            capture = f"set_config('{setting}', {authority_variable}::text, true)"
            conditional_grant = (
                f"if current_setting('{setting}', true) = 'false' then "
                f"grant {role} to current_user; end if;"
            )
            conditional_revoke = (
                f"if current_setting('{setting}', true) = 'false' then "
                f"revoke {role} from current_user; end if;"
            )
            assert capture in sql
            assert conditional_grant in sql
            assert conditional_revoke in sql
            assert sql.index(set_authority_capture) < sql.index(capture)
            assert sql.index(capture) < sql.index(conditional_grant)
            assert sql.index(conditional_grant) < sql.index(conditional_revoke)
            assert sql.count(f"grant {role} to current_user;") == 1
            assert sql.count(f"revoke {role} from current_user;") == 1


def test_structured_review_scope_is_closed_typed_and_reversible() -> None:
    version = "20260826120000"
    forward_path = MIGRATIONS / f"{version}_structured_review_scope.sql"
    down_path = MIGRATIONS / "down" / f"{version}_structured_review_scope.down.sql"

    forward = " ".join(forward_path.read_text(encoding="utf-8").lower().split())
    down = " ".join(down_path.read_text(encoding="utf-8").lower().split())
    for required in (
        "tenant_scope_state",
        "platform_only",
        "section_scoped",
        "workspace_private.review_item_section_scope",
        "foreign key (distrito_code, seccion_code)",
        "workspace_private.record_review_item",
        "p_distrito_codes text[]",
        "p_seccion_codes text[]",
        "to etl_writer",
    ):
        assert required in forward
    assert "subject_ref" in forward and "regexp_matches" not in forward
    assert "grant insert on workspace_private" not in forward
    assert "workspace_private.section_scope" not in forward.split("insert into", 1)[1]
    assert down.startswith("begin;") and down.endswith("commit;")
    assert "drop table workspace_private.review_item_section_scope" in down
    assert "drop column tenant_scope_state" in down


def test_authorized_official_facets_are_claims_bound_bounded_and_reversible() -> None:
    version = "20260826160000"
    forward = _sql(f"{version}_authorized_official_facets.sql")
    down = (
        (MIGRATIONS / "down" / f"{version}_authorized_official_facets.down.sql")
        .read_text(encoding="utf-8")
        .lower()
    )
    normalized = " ".join(forward.split())
    assert "rr.granularity<>'distrito'" not in normalized
    for required in (
        "workspace_private.authorized_section_scopes()",
        "workspace_api.official_facets()",
        "trusted_workspace_claims()",
        "ctx.fixed_expires_at<=statement_timestamp()",
        "org.entitlement_revision<>ctx.entitlement_revision",
        "member.membership_revision<>ctx.membership_revision",
        "rr.source_kind='official'",
        "j.seccion_code is not null",
        "result_row_authorized_official_facets_idx",
        "limit 200",
        "facet_total>200",
    ):
        assert required in normalized
    assert normalized.index("trusted_workspace_claims()") < normalized.index(
        "from workspace_private.workspace_context"
    )
    assert "service_role" in normalized and "to authenticated" in normalized
    assert "alter table public.result_row" not in normalized
    assert down.startswith("begin;") and down.rstrip().endswith("commit;")
    assert "create " not in down and "drop function workspace_api.official_facets()" in down
    assert "drop index public.result_row_authorized_official_facets_idx" in down


def test_authorized_official_operations_are_independent_bounded_and_reversible() -> None:
    version = "20260826200000"
    forward = _sql(f"{version}_authorized_official_operations.sql")
    down_path = MIGRATIONS / "down" / f"{version}_authorized_official_operations.down.sql"
    down = down_path.read_text(encoding="utf-8").lower()
    normalized = " ".join(forward.split())
    for required in (
        "workspace_private.authorized_section_scopes()",
        "workspace_api.official_result(",
        "workspace_api.official_comparison(",
        "public.results_exploration_official(",
        "j.seccion_code is null",
        "official_rows_without_section_identity",
        "octet_length(payload::text)>120000",
        "left_payload:=workspace_api.official_result",
        "right_payload:=workspace_api.official_result",
        "operation_unavailable",
        "from public,anon,authenticated",
        "to authenticated",
        "to_regrole('service_role')",
    ):
        assert required in normalized
    assert "source_kind='official'" in normalized and "update result_row" not in normalized
    assert "'rows'" not in normalized and "'votes'" not in normalized
    assert "set_config('votus_operations.'||r" in normalized and ",true)" in normalized
    assert down.startswith("begin;") and down.rstrip().endswith("commit;")
    assert "drop function workspace_api.official_comparison" in down
    assert "drop function workspace_api.official_result" in down
    proof_path = SQL_TESTS / "workspace_authorized_operations.sql"
    proof = " ".join(proof_path.read_text(encoding="utf-8").lower().split())
    for evidence in (
        "select plan(10)",
        "from pg_proc",
        "prosecdef",
        "proconfig",
        "authorized_section_scopes",
        "results_exploration_reporting_level",
        "octet_length",
        "result_row_authorized_official_facets_idx",
    ):
        assert evidence in proof
    for semantic_fixture in ("insert into", "set local role", "request.jwt.claims"):
        assert semantic_fixture not in proof
