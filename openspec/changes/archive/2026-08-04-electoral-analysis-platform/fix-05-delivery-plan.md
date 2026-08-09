# Fix-05 delivery plan: feature-branch chain

> **Decision:** Chained PRs are mandatory. The product owner accepted a `size:exception` for existing commit `eebb314` / unit 00 only. Use a feature-branch chain. Every new unit below is an exact cumulative-snapshot delta of **≤800 additions + deletions**. Do not create commits, branches, pushes, or PRs until delivery is explicitly authorized.

## Delivery boundary

This plan follows the corrected cumulative snapshot map:

- Base: `eebb3146de3f9cf0614505c2a86e71a8ed00ec1e`.
- Corrected mapped candidate tree before this document edit: `4bdc6c24cbed1da5d1842fba920a4680cc90169b`; the parent must refreeze the candidate after this edit.
- Mapping scope: 42 frozen paths, comprising 35 whole paths and seven split paths.
- Construction authority: complete-file cumulative `splitSnapshots`; individual `splitHunks` are audit-only ownership evidence.
- Delivery scope: 23 new units (`01`–`12`, `12A`, `13`–`15`, `15A`, `16A`, `16B`, `17A`, `17B`, `18`, `19`) after existing unit `00`.
- The native 40-path implementation target excludes the three paths already committed in `eebb314` and the two closure documents created after target capture. Neither closure document is receipt-covered.

The corrected map changes only delivery ownership. Workspace implementation bytes are unchanged. Unit 02 lands storage path/capability policing before unit 03 archive behavior that delegates final path validation to `LocalArchiveStore.path_for`. Unit 08 now lands migration `0016` before unit 09 writes `mesa_crosswalk.circuito_code`, correcting the observed `UndefinedColumn` failure in the prior loader-first order.

## Recorded delivery exception and guards

The product owner explicitly accepted a **`size:exception` for existing commit `eebb314` / unit 00 only**: **4,023 additions + 752 deletions = 4,775 changed lines**. Preserving that commit avoids rewriting accepted history and invalidating its evidence.

This exception does not authorize a commit, branch, push, PR, or other delivery action. Every new unit must match its exact cumulative snapshot delta and remain at or below 800 changed lines. A mismatch blocks delivery and requires a corrected map or a separate explicit decision.

Never use the protected 18M-row database for migration rehearsal or verification. Migration runtime work must use a disposable sibling database with guaranteed cleanup.

## Chain strategy and order

Use a feature-branch chain with a draft/no-merge tracker branch. Each child targets its immediate parent.

```text
main
└── fix-05-tracker (draft/no-merge integration branch)
    └── fix-05-00-existing-head 📍  [eebb314; size:exception accepted for unit 00 only]
        └── 01 ─ 02 storage safety ─ 03 archive digest ─ 04 ─ 05 ─ 06 ─ 07
            └── 08 schema ─ 09 crosswalk ─ 10 idempotency ─ 11 ─ 12 ─ 12A ─ 13 ─ 14 ─ 15
                └── 16A ─ 16B ─ 17A ─ 17B ─ 18 ─ 19
```

Review and integrate in this exact order:

`00 → 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11 → 12 → 12A → 13 → 14 → 15 → 16A → 16B → 17A → 17B → 18 → 19`

Never retarget a child directly to `main` while preserving this strategy. The tracker remains draft/no-merge until every child has been reviewed and integrated.

## Exact unit summary

| Unit | Exact additions + deletions | Proposed commit |
|---|---:|---|
| 01 | 58 | `chore(repo): align verification tools and review guidance` |
| 02 | 359 | `fix(archive): reject unsafe and colliding extraction targets` |
| 03 | 737 | `fix(archive): verify immutable captures by content digest` |
| 04 | 319 | `fix(etl): canonicalize source identities without permissive parsing` |
| 05 | 778 | `fix(etl): enforce measured national election row shapes` |
| 06 | 356 | `fix(etl): refuse unverifiable PBA cache and schema drift` |
| 07 | 487 | `fix(etl): refuse ambiguous fiscalizacion mesa attribution` |
| 08 | 58 | `fix(db): add circuito to mesa crosswalk identity` |
| 09 | 579 | `fix(etl): key mesa crosswalks by circuito and replace stale rows` |
| 10 | 567 | `fix(etl): preserve idempotency across loader replacements` |
| 11 | 484 | `fix(db): repair jurisdiction reconciliation without rewriting history` |
| 12 | 537 | `fix(db): reconcile fiscalizacion mesas with official identities` |
| 12A | 425 | `test(db): prove jurisdiction repairs on disposable history` |
| 13 | 214 | `fix(cli): report malformed source and manifest records` |
| 14 | 572 | `fix(cli): route fetches through verified archive records` |
| 15 | 238 | `fix(cli): keep ingest source identity and review outcomes exact` |
| 15A | 215 | `test(cli): cover curated validation failure surfaces` |
| 16A | 670 | `fix(cli): validate and replace curated electoral projections` |
| 16B | 467 | `fix(cli): backfill curated mesa type projections` |
| 17A | 680 | `fix(cli): refuse incomplete fiscalizacion comparison baselines` |
| 17B | 197 | `fix(cli): enforce circuito-aware official comparison vectors` |
| 18 | 397 | `test(cli): prove fiscalizacion validation scope bindings` |
| 19 | 513 | `docs(openspec): record fix-05 verification and delivery chain` |

Unit 19 is the post-edit plan line count plus the fixed 125-line verification addendum. All values are exact deltas, not estimates.

## Work units

### 00 — Existing web/database prerequisite

- **Commit:** existing `eebb314` — `fix(web): read every identity and every row from the database`.
- **Purpose:** Preserve the already-committed web reachability/pagination correction and migrations `0013`–`0015` as the chain prerequisite.
- **Dependency:** `main`.
- **Exact size:** 4,775 changed lines under the accepted unit-00-only `size:exception`.
- **Focused evidence:** Evidence belongs to `eebb314`; current ETL verification did not rerun web gates.
- **Rollback:** Revert `eebb314` as one existing commit.

### 01 — Repository verification envelope

- **Commit:** `chore(repo): align verification tools and review guidance`.
- **Purpose:** Align secret scanning, Pi exclusions, type-checking, CodeGraph ignore, GGA provider, and review rules.
- **Ownership:** Complete `.gga`, `.gitignore`, `.gitleaks.toml`, `.pi-lens.json`, `AGENTS.md`, and `pyrightconfig.json` workspace paths.
- **Dependency / exact size:** 00 / 58.
- **Focused test:** N/A — repository tooling policy only.

### 02 — Safe ZIP extraction and archive-store paths

- **Commit:** `fix(archive): reject unsafe and colliding extraction targets`.
- **Purpose:** Refuse traversal, collisions, overwrite, and decompression overflow; clean partial output on failure.
- **Ownership:** Complete `etl/etl/storage.py` and `etl/tests/test_storage.py` workspace paths.
- **Dependency / exact size:** 01 / 359.
- **Focused test:** `cd etl && uv run pytest tests/test_storage.py`.

### 03 — Content-addressed archive and typed manifest

- **Commit:** `fix(archive): verify immutable captures by content digest`.
- **Purpose:** Address archive bytes by digest, verify reads, validate manifest types, and preserve drift captures.
- **Ownership:** Complete `etl/etl/archive.py`, `etl/etl/manifest.py`, `etl/tests/test_archive.py`, `etl/tests/test_http_client.py`, and `etl/tests/test_manifest.py` workspace paths.
- **Dependency / exact size:** 02 / 737.
- **Focused test:** `cd etl && uv run pytest tests/test_archive.py tests/test_manifest.py tests/test_http_client.py`.

### 04 — Strict numeric and identity boundaries

- **Commit:** `fix(etl): canonicalize source identities without permissive parsing`.
- **Purpose:** Share strict numeric parsing, preserve identity schemes, validate party-map YAML, and reject duplicate natural keys.
- **Ownership:** Complete `etl/etl/jurisdiction.py`, `etl/etl/numeric.py`, `etl/etl/party_map.py`, and `etl/tests/test_numeric.py`; mapped normalization snapshot for `etl/tests/test_jurisdiction.py`. Existing party-map tests remain focused evidence for the changed production boundary.
- **Dependency / exact size:** 03 / 319.
- **Focused test:** `cd etl && uv run pytest tests/test_numeric.py tests/test_jurisdiction.py tests/test_party_map.py`.

### 05 — Measured national source contracts

- **Commit:** `fix(etl): enforce measured national election row shapes`.
- **Purpose:** Enforce election metadata and measured national CSV/list/mesa shapes without permissive parsing.
- **Ownership:** Complete `etl/etl/ingest/national.py`, `etl/sources.yaml`, and `etl/tests/test_ingest_national.py`; cumulative `etl/tests/test_party_map.py` snapshot updating the 2025 empty-list-number call with the new required election metadata.
- **Dependency / exact size:** 04 / 778.
- **Focused test:** `cd etl && uv run pytest tests/test_ingest_national.py tests/test_party_map.py`.

### 06 — PBA fetch and schema boundaries

- **Commit:** `fix(etl): refuse unverifiable PBA cache and schema drift`.
- **Purpose:** Verify cached bytes, reject corrupt-cache healing and schema drift, and parse vote cells strictly.
- **Ownership:** Complete `etl/etl/ingest/pba.py` and `etl/tests/test_ingest_pba.py` workspace paths.
- **Dependency / exact size:** 05 / 356.
- **Focused test:** `cd etl && uv run pytest tests/test_ingest_pba.py`.

### 07 — Fiscalización ingestion refusals

- **Commit:** `fix(etl): refuse ambiguous fiscalizacion mesa attribution`.
- **Purpose:** Preserve source lineage and refuse unsafe numeric cells or ambiguous official mesa destinations.
- **Ownership:** Complete `etl/etl/ingest/fiscalizacion.py` and `etl/tests/test_ingest_fiscalizacion.py`; cumulative `etl/etl/db.py` snapshot introducing the same-election `official_jurisdictions_for_mesa(..., election_id=...)` lookup required by attribution.
- **Dependency / exact size:** 06 / 487.
- **Focused test:** `cd etl && uv run pytest tests/test_ingest_fiscalizacion.py`.

### 08 — Circuito-aware mesa-crosswalk schema

- **Commit:** `fix(db): add circuito to mesa crosswalk identity`.
- **Purpose:** Rebuild the projection with circuito in its unique key and provide an explicit clearing down path.
- **Ownership:** Complete migration `0016` and its down artifact.
- **Dependency / exact size:** 07 / 58.
- **Focused proof:** Apply migrations through `0016` with `ON_ERROR_STOP=1` to a unique disposable sibling database; the consolidated static SQL assertions arrive in unit 12.

### 09 — Exact crosswalk and curated projection

- **Commit:** `fix(etl): key mesa crosswalks by circuito and replace stale rows`.
- **Purpose:** Validate crosswalk YAML, key stability by circuito/mesa, and replace stale crosswalk projections.
- **Ownership:** Cumulative snapshots of `etl/etl/crosswalk.py`, `etl/tests/test_crosswalk.py`, and `etl/etl/db.py` containing only mapped loader/stability, replacement, and earliest-safe shared definitions.
- **Dependency / exact size:** 08 / 579.
- **Focused test:** `cd etl && uv run pytest tests/test_crosswalk.py`.

### 10 — Result and curated-loader idempotency

- **Commit:** `fix(etl): preserve idempotency across loader replacements`.
- **Purpose:** Keep Python and SQL merge-key encoders tagged and byte-equivalent, reject foreign archive ids before SQL, and replace stale party projections transactionally.
- **Ownership:** Complete `etl/tests/test_integration_idempotent.py`; cumulative snapshots of `etl/etl/db.py`, `etl/tests/test_jurisdiction.py`, and `etl/tests/test_party_map.py` containing mapped merge-key, result-guard, party-replacement, and parity assertions.
- **Dependency / exact size:** 09 / 567.
- **Focused test:** `cd etl && uv run pytest tests/test_integration_idempotent.py tests/test_party_map.py tests/test_jurisdiction.py`.

### 11 — Jurisdiction reconciliation repair

- **Commit:** `fix(db): repair jurisdiction reconciliation without rewriting history`.
- **Purpose:** Repair immutable migration history through proven PBA provenance while preserving result counts.
- **Ownership:** Complete migration `0017` and its down artifact.
- **Dependency / exact size:** 10 / 484.
- **Focused proof:** Apply migrations through `0017` with `ON_ERROR_STOP=1` to a unique disposable sibling database; the consolidated static SQL assertions arrive in unit 12.
- **Guard:** Never target the protected 18M-row database.

### 12 — Same-election fiscalización reconciliation

- **Commit:** `fix(db): reconcile fiscalizacion mesas with official identities`.
- **Purpose:** Repoint fiscalización rows only to one same-election official mesa and preserve review evidence.
- **Ownership:** Complete `etl/tests/test_migration_sql.py`, migration `0018`, and its down artifact; cumulative `etl/etl/db.py` snapshot completing Protocol typing for the same-election lookup introduced in unit 07.
- **Dependency / exact size:** 11 / 537.
- **Focused test:** `cd etl && uv run pytest tests/test_migration_sql.py -k 0018`.

### 12A — Complete migration-history runtime harness

- **Commit:** `test(db): prove jurisdiction repairs on disposable history`.
- **Purpose:** Exercise the complete `0001..0018` migration history and its refusal/retry/final invariants.
- **Ownership:** Complete `etl/tests/test_migration_integration.py`.
- **Dependency / exact size:** 12 / 425.
- **Focused test:** `cd etl && uv run pytest tests/test_migration_integration.py` with infrastructure that permits a unique disposable sibling database.
- **Guard:** The harness must drop the sibling database in cleanup and must never receive the protected database URL.

### 13 — Source/manifest trust-boundary errors

- **Commit:** `fix(cli): report malformed source and manifest records`.
- **Purpose:** Turn malformed source and manifest shapes into deterministic CLI refusals.
- **Ownership:** Cumulative `etl/etl/__main__.py` and `etl/tests/test_cli.py` snapshots containing mapped shared imports, trust-boundary definitions, source/manifest validation, and the semantic blocks listed below.
- **Dependency / exact size:** 12A / 214.
- **Focused test:** `cd etl && uv run pytest tests/test_cli.py -k 'malformed_sources or manifest_record or source_metadata'`.

### 14 — Fetch orchestration reaches verified archive storage

- **Commit:** `fix(cli): route fetches through verified archive records`.
- **Purpose:** Route the real fetch entrypoint through safe content-addressed records and reject source identity drift.
- **Ownership:** Cumulative `etl/etl/__main__.py` and `etl/tests/test_cli.py` snapshots containing mapped fetch/read-archive behavior, reachability, etiquette/robots behavior, and the semantic blocks listed below.
- **Dependency / exact size:** 13 / 572.
- **Focused test:** `cd etl && uv run pytest tests/test_cli.py -k 'fetch or archived_path or drifted_archive'`.

### 15 — Ingest orchestration and loader review items

- **Commit:** `fix(cli): keep ingest source identity and review outcomes exact`.
- **Purpose:** Carry election metadata and verified bytes through ingest while persisting loader review items.
- **Ownership:** Cumulative `etl/etl/__main__.py` and `etl/tests/test_cli.py` snapshots containing only mapped ingest identity, parser wiring, reachability, and review persistence behavior.
- **Dependency / exact size:** 14 / 238.
- **Focused test:** `cd etl && uv run pytest tests/test_cli.py -k 'ingest and not unguarded'`.

### 15A — Curated validation failure surfaces

- **Commit:** `test(cli): cover curated validation failure surfaces`.
- **Purpose:** Refuse parser-invariant violations and duplicate curated keys through the real CLI validation paths.
- **Ownership:** Cumulative `etl/etl/__main__.py` and `etl/tests/test_cli.py` snapshots containing the strict jurisdiction/party collection paths, election-aware fixture, and matching regression tests.
- **Dependency / exact size:** 15 / 215.
- **Focused test:** `cd etl && uv run pytest tests/test_cli.py -k 'parser_row or duplicate_curated_keys'` (**4 passed, 66 deselected** in preflight).

### 16A — Curated electoral projection validation and replacement

- **Commit:** `fix(cli): validate and replace curated electoral projections`.
- **Purpose:** Validate curated crosswalk, party, mesa, and load projections as one reviewable behavior.
- **Ownership:** Cumulative `etl/etl/__main__.py` and `etl/tests/test_cli.py` snapshots containing mapped crosswalk/curated validation, national jurisdiction/party/mesa collection, and curated replacement behavior.
- **Dependency / exact size:** 15A / 670.
- **Focused test:** `cd etl && uv run pytest tests/test_cli.py -k 'validate_crosswalk or validate_curated or load_curated'`.
- **Review order:** Archive reachability, identity collection, validation, replacement.

### 16B — Curated mesa-type backfill

- **Commit:** `fix(cli): backfill curated mesa type projections`.
- **Purpose:** Collect and apply curated mesa-type mappings, including disagreement preservation and CLI reachability.
- **Ownership:** Cumulative `etl/etl/__main__.py` and `etl/tests/test_cli.py` snapshots containing mapped `collect_mesa_tipo_mapping`, `apply_mesa_tipo_mapping`, `cmd_backfill_mesa_tipo`, and matching behavior tests.
- **Dependency / exact size:** 16A / 467.
- **Focused test:** `cd etl && uv run pytest tests/test_cli.py -k 'mesa_tipo or backfill_mesa_tipo'`.
- **Review order:** Mapping collection, disagreement preservation, update path, CLI reachability.

### 17A — Fiscalización baseline refusals

- **Commit:** `fix(cli): refuse incomplete fiscalizacion comparison baselines`.
- **Purpose:** Reject missing, unguarded, or metadata-incompatible fiscalización baselines before writes.
- **Ownership:** Cumulative `etl/tests/test_cli.py` snapshot plus the mapped `etl/etl/__main__.py` baseline refusal delta, containing baseline/unguarded/metadata refusal behavior and the semantic blocks listed below.
- **Dependency / exact size:** 16B / 680.
- **Focused test:** `cd etl && uv run pytest tests/test_cli.py -k 'baseline or unguarded or source_election_mismatch'`.
- **Review order:** Baseline presence, guard metadata, source/election compatibility, no-write refusal.

### 17B — Circuito-aware official comparison vectors

- **Commit:** `fix(cli): enforce circuito-aware official comparison vectors`.
- **Purpose:** Build circuito-aware official vectors and reject ambiguous or non-comparable mesa evidence.
- **Ownership:** Inherits the strict official-vector parser required by 17A; cumulative snapshots of `etl/etl/crosswalk.py`, `etl/tests/test_cli.py`, and `etl/tests/test_crosswalk.py` add comparison use, completeness checks, and the semantic block listed below.
- **Dependency / exact size:** 17A / 197.
- **Focused test:** `cd etl && uv run pytest tests/test_cli.py tests/test_crosswalk.py -k 'official or circuito or ambiguous'`.
- **Review order:** Circuito identity, vector completeness, ambiguity handling, non-comparable evidence.

### 18 — Fiscalización scope-binding regression proof

- **Commit:** `test(cli): prove fiscalizacion validation scope bindings`.
- **Purpose:** Prove source, election, and name-table scope mismatches are refused before an apparently authoritative comparison.
- **Ownership:** Inherits the complete validation caller from 17A; the cumulative `etl/tests/test_cli.py` snapshot adds the mapped scope-binding regression scenarios and semantic block listed below.
- **Dependency / exact size:** 17B / 397.
- **Focused test:** `cd etl && uv run pytest tests/test_cli.py -k 'scope and fiscalizacion'`.

### 19 — Post-archive closure documents

- **Commit:** `docs(openspec): record fix-05 verification and delivery chain`.
- **Purpose:** Preserve current evidence without rewriting historical reports and record the corrected delivery decomposition.
- **Ownership:** This plan and the 125-line [verification addendum](post-archive-fix-05-verification.md).
- **Dependency:** 18.
- **Exact size after this edit:** **388 + 125 = 513 changed lines**, within the 800-line limit.
- **Focused evidence:** Structural readback and exact-path trailing-whitespace/final-newline checks. Ordinary `git diff --check` is not evidence while `.gitignore` pattern `archive/` keeps these files ignored.
- **Rollback:** Remove only the two closure documents; never modify historical `verify-report.md`.

## Semantic ownership of the formerly inseparable test hunk

The formerly inseparable 640-line `etl/tests/test_cli.py` hunk is decomposed into these **13 complete top-level function/helper blocks at AST boundaries**. These ranges are copied exactly from `hunk-map.json`; they are audit coordinates, not permission to split a function.

| Unit | Complete semantic block | Exact final block | Exact changed range within mixed hunk |
|---|---|---:|---:|
| 13 | `test_malformed_sources_shapes_exit_cleanly_through_main` | 4089 + 18 | 4089 + 18 |
| 13 | `test_source_entry_missing_id_exits_cleanly_through_main` | 4109 + 18 | 4109 + 18 |
| 13 | `test_a_malformed_sources_file_exits_nonzero_instead_of_a_traceback` | 4129 + 23 | 4129 + 23 |
| 13 | `test_malformed_manifest_shapes_exit_cleanly_through_main` | 4155 + 17 | 4155 + 17 |
| 13 | `test_a_manifest_record_missing_status_exits_nonzero` | 4174 + 29 | 4174 + 29 |
| 14 | `test_a_pba_fetch_goes_through_the_etiquette_layer` | 3877 + 106 | 3877 + 106 |
| 14 | `test_pba_fetch_halts_before_source_or_archive_mutation_when_robots_appears` | 3985 + 46 | 3985 + 46 |
| 14 | `test_pba_robots_appearance_exits_fetch_command_cleanly` | 4033 + 46 | 4033 + 46 |
| 17A | `test_validate_fiscalizacion_refuses_a_circuito_blind_baseline_before_review_writes` | 3625 + 100 | 3654 + 71 |
| 17A | `test_validate_fiscalizacion_refuses_an_invalid_official_vector_before_any_write` | 3734 + 105 | 3734 + 105 |
| 17A | `test_validate_fiscalizacion_uses_registered_baseline_metadata_and_refuses_mismatch` | 4205 + 52 | 4205 + 52 |
| 17B | `test_a_non_comparable_row_cannot_declare_a_mesa_ambiguous` | 3841 + 34 | 3841 + 34 |
| 18 | `test_validate_fiscalizacion_refuses_fiscal_source_election_mismatch_before_access` | 4263 + 58 | 4263 + 31 |

No function, class, helper, or string may be split. State construction uses complete function/helper blocks and complete-file cumulative snapshots internally. Delivery staging must preserve these exact semantic blocks and reproduce the authoritative snapshot for each unit; do not stage by approximate prose ranges.

## Exact 42-path accounting

The corrected map owns 42 frozen paths: 40 implementation paths plus the two unit-19 closure documents.

| Candidate path | Exact owner |
|---|---|
| `.gga` | 01 |
| `.gitignore` | 01 |
| `.gitleaks.toml` | 01 |
| `.pi-lens.json` | 01 |
| `AGENTS.md` | 01 |
| `pyrightconfig.json` | 01 |
| `etl/etl/__main__.py` | 13, 14, 15, 16A, 16B, 17A, 17B, 18 via cumulative snapshots |
| `etl/etl/archive.py` | 03 |
| `etl/etl/crosswalk.py` | 09, 17B, 18 via cumulative snapshots |
| `etl/etl/db.py` | 07, 09, 10, 12 via cumulative snapshots |
| `etl/etl/ingest/fiscalizacion.py` | 07 |
| `etl/etl/ingest/national.py` | 05 |
| `etl/etl/ingest/pba.py` | 06 |
| `etl/etl/jurisdiction.py` | 04 |
| `etl/etl/manifest.py` | 03 |
| `etl/etl/numeric.py` | 04 |
| `etl/etl/party_map.py` | 04 |
| `etl/etl/storage.py` | 02 |
| `etl/sources.yaml` | 05 |
| `etl/tests/test_archive.py` | 03 |
| `etl/tests/test_cli.py` | 13, 14, 15, 16A, 16B, 17A, 17B, 18 via cumulative snapshots and semantic blocks |
| `etl/tests/test_crosswalk.py` | 09, 17B via cumulative snapshots |
| `etl/tests/test_http_client.py` | 03 |
| `etl/tests/test_ingest_fiscalizacion.py` | 07 |
| `etl/tests/test_ingest_national.py` | 05 |
| `etl/tests/test_ingest_pba.py` | 06 |
| `etl/tests/test_integration_idempotent.py` | 10 |
| `etl/tests/test_jurisdiction.py` | 04, 10 via cumulative snapshots |
| `etl/tests/test_manifest.py` | 03 |
| `etl/tests/test_migration_integration.py` | 12A |
| `etl/tests/test_migration_sql.py` | 12 |
| `etl/tests/test_numeric.py` | 04 |
| `etl/tests/test_party_map.py` | 05, 10 via cumulative snapshots |
| `etl/tests/test_storage.py` | 02 |
| `supabase/migrations/0016_add_circuito_to_mesa_crosswalk.sql` | 08 |
| `supabase/migrations/0017_repair_jurisdiction_reconciliation.sql` | 11 |
| `supabase/migrations/0018_merge_fiscalizacion_mesas_into_official.sql` | 12 |
| `supabase/migrations/down/0016_add_circuito_to_mesa_crosswalk.down.sql` | 08 |
| `supabase/migrations/down/0017_repair_jurisdiction_reconciliation.down.sql` | 11 |
| `supabase/migrations/down/0018_merge_fiscalizacion_mesas_into_official.down.sql` | 12 |
| `openspec/changes/archive/2026-08-04-electoral-analysis-platform/fix-05-delivery-plan.md` | 19; outside native 40-path target |
| `openspec/changes/archive/2026-08-04-electoral-analysis-platform/post-archive-fix-05-verification.md` | 19; outside native 40-path target |

The three paths already committed in `eebb314` are outside this 42-path corrected map and belong only to unit 00:

- `supabase/migrations/0013_merge_fiscalizacion_mesas_into_official.sql`
- `supabase/migrations/0014_drop_result_row_is_unmapped.sql`
- `supabase/migrations/0015_review_item_unreadable_vote_cell.sql`

## Safe construction and staging

The authoritative map does not rely on ad hoc interactive hunk selection:

1. Start from the exact preceding unit state; in particular, apply unit 08 schema bytes before materializing unit 09 loader bytes.
2. Materialize the unit's complete cumulative snapshots for every split path and complete bytes for every whole path.
3. Preserve complete semantic blocks; never split a function/helper or reconstruct from approximate line ranges.
4. Confirm staged paths, modes, and `git diff --cached --numstat` reproduce the exact mapped delta.
5. Inspect the full staged diff and run the unit's focused command only after delivery and test execution are authorized.
6. Keep later-unit bytes unstaged and preserve the protected database guard.

For unit 19, `.gitignore` pattern `archive/` ignores both documents. If and only if documentation delivery is authorized, force-add **only** these exact paths:

```bash
git add -f -- openspec/changes/archive/2026-08-04-electoral-analysis-platform/post-archive-fix-05-verification.md openspec/changes/archive/2026-08-04-electoral-analysis-platform/fix-05-delivery-plan.md
git diff --cached --stat -- openspec/changes/archive/2026-08-04-electoral-analysis-platform/post-archive-fix-05-verification.md openspec/changes/archive/2026-08-04-electoral-analysis-platform/fix-05-delivery-plan.md
git diff --cached --numstat -- openspec/changes/archive/2026-08-04-electoral-analysis-platform/post-archive-fix-05-verification.md openspec/changes/archive/2026-08-04-electoral-analysis-platform/fix-05-delivery-plan.md
git diff --cached -- openspec/changes/archive/2026-08-04-electoral-analysis-platform/post-archive-fix-05-verification.md openspec/changes/archive/2026-08-04-electoral-analysis-platform/fix-05-delivery-plan.md
```

Do not add any other ignored path. These are planning instructions only and grant no Git, push, or PR authorization.

## Final invariants

Before any authorized delivery action:

- All 23 new units and existing unit 00 appear in the exact dependency and review order above.
- Every mapped unit delta is exact and ≤800; unit 19 uses the post-edit plan line count plus the fixed 125-line addendum.
- Every split path matches its authoritative cumulative snapshot, including all 13 semantic AST-boundary blocks.
- All intended untracked implementation files are delivered only by their assigned units.
- The two ignored closure documents are force-added only by exact path in unit 19.
- Local `.env` files, `.next` output, and unrelated paths remain excluded.
- The protected 18M-row database is never used for rehearsal or verification.
- No commit, branch, push, or PR is authorized by this plan.
