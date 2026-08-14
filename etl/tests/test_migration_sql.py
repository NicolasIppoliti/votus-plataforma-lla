from __future__ import annotations

import ast
import hashlib
import re
from pathlib import Path

import pytest

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


def _production_review_kind_literals() -> set[str]:
    production_root = REPO_ROOT / "etl" / "etl"
    kinds: set[str] = set()
    for source_path in production_root.rglob("*.py"):
        tree = ast.parse(source_path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            for keyword in node.keywords:
                if (
                    keyword.arg == "kind"
                    and isinstance(keyword.value, ast.Constant)
                    and isinstance(keyword.value.value, str)
                ):
                    kinds.add(keyword.value.value)

    pba_tree = ast.parse((production_root / "ingest" / "pba.py").read_text(encoding="utf-8"))
    duplicate_kinds: set[str] = set()
    pba_reasons: set[str] = set()
    for node in ast.walk(pba_tree):
        if not isinstance(node, ast.Assign) or not any(
            isinstance(target, ast.Name) for target in node.targets
        ):
            continue
        target_names = {target.id for target in node.targets if isinstance(target, ast.Name)}
        if "kind" in target_names and isinstance(node.value, ast.IfExp):
            duplicate_kinds.update(
                value.value
                for value in (node.value.body, node.value.orelse)
                if isinstance(value, ast.Constant) and isinstance(value.value, str)
            )
        if "reason" not in target_names:
            continue
        if isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            pba_reasons.add(node.value.value)
        elif isinstance(node.value, ast.JoinedStr):
            suffix = "".join(
                value.value
                for value in node.value.values
                if isinstance(value, ast.Constant) and isinstance(value.value, str)
            )
            pba_reasons.update(f"{kind}{suffix}" for kind in duplicate_kinds)

    cli_source = (production_root / "__main__.py").read_text(encoding="utf-8")
    assert 'kind=f"pba_{quarantined.reason}"' in cli_source
    kinds.update(f"pba_{reason}" for reason in pba_reasons)
    return kinds


def test_0024_review_kind_allowlist_covers_every_production_kind_literal() -> None:
    sql = _sql("0024_expand_review_item_kinds.sql")

    production_kinds = _production_review_kind_literals()
    assert production_kinds
    assert production_kinds <= _review_kind_allowlist(sql)


def test_0024_uses_the_exact_review_kind_union_and_has_a_guarded_down_migration() -> None:
    expected = {
        "content_drift",
        "fetch_failure",
        "unmapped_party",
        "unmapped_jurisdiction",
        "mesa_discontinuity",
        "source_reexported",
        "duplicate_collapsed",
        "duplicate_conflict",
        "unmergeable_row",
        "blank_vote_cell",
        "mesa_tally_divergence",
        "ambiguous_mesa_circuito",
        "mesa_absent_from_official_import",
        "unreadable_vote_cell",
        "ambiguous_official_mesa_identity",
        "pba_conflicting_duplicate_semantic_result",
        "pba_exact_duplicate_semantic_result",
        "pba_unreadable_vote_cell",
    }
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


def test_results_exploration_scale_proof_is_bounded_and_reports_real_plans() -> None:
    sql = (SQL_TESTS / "results_exploration_scale.sql").read_text(encoding="utf-8").lower()
    for required in (
        "explain (analyze, buffers, format json)",
        "representative_result_rows",
        "execution time",
        "shared hit blocks",
        "shared read blocks",
        "results_exploration_facets",
        "facets_cold_start",
        "7000",
        "results_exploration_official",
        "results_exploration_coverage",
        "results_exploration_schools",
        "->>'status',",
        "500, 'scale payload retains exactly 500 complete schools'",
        "12000::bigint",
        "rollback;",
    ):
        assert required in sql


def test_results_exploration_release_proof_rolls_back_then_reapplies_in_order() -> None:
    sql = (SQL_TESTS / "results_exploration_release.sql").read_text(encoding="utf-8").lower()
    sequence = (
        "\\ir ../migrations/down/0022_results_exploration_scale.down.sql",
        "\\ir ../migrations/down/0021_results_coverage.down.sql",
        "\\ir ../migrations/down/0020_results_exploration.down.sql",
        "\\ir ../migrations/0020_results_exploration.sql",
        "\\ir ../migrations/0021_results_coverage.sql",
        "\\ir ../migrations/0022_results_exploration_scale.sql",
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
    ):
        assert required in sql


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
