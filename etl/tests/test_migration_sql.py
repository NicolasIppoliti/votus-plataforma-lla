from __future__ import annotations

import hashlib
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
MIGRATIONS = REPO_ROOT / "supabase" / "migrations"


def _sql(name: str) -> str:
    return (MIGRATIONS / name).read_text(encoding="utf-8").lower()


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
