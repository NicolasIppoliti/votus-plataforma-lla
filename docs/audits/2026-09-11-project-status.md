# Project status — repository controls advanced; hosted readiness remains unverified

**As of 11 September 2026, the historical corpus-wide authenticated-access concern is resolved in repository code, and the exact audited main commit has a successful post-merge release gate.** Product coverage has expanded, but remains deliberately bounded. The next decision is whether to authorize operational evidence collection—not to repeat the completed authorization or streaming implementation. This report does not certify commercial readiness, deployment correctness, or absence of vulnerabilities.

## Snapshot and method

| Item | Evidence and boundary |
| --- | --- |
| Audited main | `e33b2b0605a0c1e8ff1c5ee9fd5538ff51ba778f`; tree `42b26135c06ae901fb92dbf0cef411d0c6bffff1` |
| Remote observation | Parent audit observed matching remote main and a clean tree at `2026-09-11T17:29Z`. Writer independently confirmed HEAD/tree and clean `docs/project-status-2026-09-11` branch before writing. |
| Historical baseline | Local, unpublished `da8bc17:docs/audits/2026-08-21-project-status.md`, audited `19893571cb4a88354e3094a68f27617d9efe8a3e`. Inspected through a temporary read copy; the original was not changed or added to this branch. Historical local main/backup were left intact. |
| Method | Parent-supplied repository inspection and existing GitHub CI/delivery evidence; read-only YAML metadata counting with existing Python, `yaml.safe_load`, and `Counter`; writer read repository rules and historical report. Source citations below refer to audited main. |
| Exclusions | No production contact, hosted catalog queries, raw archive/fiscal data or log/secret/environment-file reads. No installs, tests, builds, Docker, ingestion, or application changes. Test source is evidence of contracts, not a fresh execution result. |

This is a new snapshot, not a retroactive correction of observations made in August. Historical production-repair evidence is not carried forward as proof of current hosted state.

## What changed since the historical report

| Area | Current assessment | Evidence and qualification |
| --- | --- | --- |
| Organization authorization | **Resolved in repository**, rather than planning-only | [PR #159](https://github.com/NicolasIppoliti/votus-plataforma-lla/pull/159), merged 30 August; raw access revocation and production facade callers are detailed below. Hosted activation was not observed. |
| National ingestion | Streaming implementation exists | [PR #188](https://github.com/NicolasIppoliti/votus-plataforma-lla/pull/188), merged 1 September, and [streaming validators #208](https://github.com/NicolasIppoliti/votus-plataforma-lla/pull/208), merged 2 September. Actual large PASO ingestion is not verified here. |
| PBA scope | Two allowlisted partidos, not all 135 | [PR #92](https://github.com/NicolasIppoliti/votus-plataforma-lla/pull/92) and [corpus documentation #93](https://github.com/NicolasIppoliti/votus-plataforma-lla/pull/93), merged 24 August. Registry/crosswalk support does not prove hosted rows or UI availability. |
| Latest delivery | Included in audited main | [PR #299](https://github.com/NicolasIppoliti/votus-plataforma-lla/pull/299) merged at audited main; issues #260, #261, and #265 are closed. |
| Backlog snapshot | Zero open issues and zero open PRs | Observed at the snapshot, not evidence that no work remains. Historical issue [#53](https://github.com/NicolasIppoliti/votus-plataforma-lla/issues/53) closed `2026-08-22T23:40:34Z`; its former open status is not current. |

The parent independently verified merge commits for #159, #188, #208, #92, and #93 as ancestors of audited main. Delivery titles and ancestry establish inclusion, not broad functional completeness or deployment state.

## Executable evidence: existing CI, not an audit rerun

[Release gates run 34626912700](https://github.com/NicolasIppoliti/votus-plataforma-lla/actions/runs/34626912700) completed **SUCCESS** on the exact audited main commit. All eight jobs succeeded: `scope`, `web-static`, four `etl-release` variants (ordinary, SQL, ledger, success), `e2e-release`, and `verify`.

The E2E gate executed successfully. Only its conditional failure-artifact upload was skipped; that is not a skipped required job. Job status alone does not establish test-case counts or zero skipped tests, and this report makes neither claim. A local ledger CI job exists; no hosted reconciliation was observed in the release workflow.

## Resolved repository controls

No concrete current repository-evidenced security defect was found in the bounded security lane. That finding is not a security certification; hosted grants, Auth settings, catalog, and applied migrations remain unobserved.

| Control | Current implementation and reachability |
| --- | --- |
| Deny legacy direct access | `supabase/migrations/20260829032228_revoke_legacy_results_public_contract.sql:3–37,65–82` revokes raw SELECT/permissive policy access; lines `39–62` retain the authorized executor. The August global-JWT-access P0 is therefore not a confirmed current repository vulnerability. |
| Exact-section authorization | `supabase/migrations/20260826200000_authorized_official_operations.sql:10–14` enforces exact-section official operations. `/drilldown` calls authorized facades (`apps/web/src/app/(authenticated)/drilldown/page.tsx:421,489`); the API does too (`apps/web/src/app/api/workspace/official/result/route.ts:2,7–11`). |
| Session-bound workspace context | `supabase/migrations/20260826050000_workspace_context_selection.sql:13–69` binds subject, session, expiry, membership, and entitlement revision. Runtime selection is in `apps/web/src/lib/workspace/context.ts:80–101` and `selection.ts:45–63`, reached by `apps/web/src/app/(authenticated)/layout.tsx:50`. DB-entry contract tests: `etl/tests/test_migration_integration.py:1555–1680`. |
| Review list/count alignment | `supabase/migrations/20260827040000_authorized_fiscal_review.sql:1` applies the scoped predicates. Review page line `29` and authenticated layout lines `55–59` share `authorizedReviewItems`; DB tests cover this at `etl/tests/test_migration_integration.py:2129–2216`. Sanitization: `apps/web/src/lib/workspace/review-items.ts:57–105`. |
| Fiscal evidence separation | `supabase/migrations/20260829232200_bound_authorized_result_evidence.sql:9–21,30–47` binds explicit opt-in, exact scope, and source kind. `apps/web/src/lib/workspace/fiscalizacion-evidence.ts:57–104` reaches the page at `apps/web/src/app/(authenticated)/fiscalizacion/page.tsx:638`; non-ready states intentionally contain no figures (`393–412,558–582`). |

The review screen is intentionally read-only (`apps/web/src/app/(authenticated)/review/page.tsx:62`). No resolution mutation was found. A resolution lifecycle is a possible product addition, not an authorization defect.

## Bounded product and data capabilities

| Capability | Supported contract | Limit of the evidence |
| --- | --- | --- |
| PBA ingestion | HTML sources for `027` Coronel Rosales and `113` Tigre: `etl/sources.yaml:88–117`, parser allowlist `etl/etl/ingest/pba.py:75–82`, crosswalks `curated/crosswalk.yaml:18–28`. Tigre real-CLI/idempotency tests exist at `etl/tests/test_cli.py:2251,2379`. | Exactly two jurisdictions; not full-PBA coverage and not proof of hosted Tigre availability. |
| Reference PDFs | Four `027` references registered at `etl/sources.yaml:118–166`; CLI refuses projection at `etl/etl/__main__.py:851–891`, tested at `etl/tests/test_cli.py:516`. | Archive-only by design, not missing OCR implementation. |
| Municipal/exploration | `/municipal` remains fixed to `02/027` (`apps/web/src/app/(authenticated)/municipal/page.tsx:259,396–435`). Drilldown supports authorized exact sections (`drilldown/page.tsx:404,470–489`). | Selectable capability depends on authorized persisted data, not registry entries alone. |
| Comparison | Independent 2023/2025 sides for the same exact section, with unmapped/granularity refusals (`apps/web/src/app/(authenticated)/compare/page.tsx:187–232,443–515`). | Not arbitrary election-pair comparison or guaranteed semantic coverage everywhere. |
| Simulation | PBA Hare / national D'Hondt (`apps/web/src/domain/seat-allocation/allocate.ts:71–133`); historical payloads rejected (`apps/web/src/app/(authenticated)/simulate/page.tsx:99–106,262`; entry test `simulate/page.test.tsx:676–692`). | Do not repeat the historical claim that caller-supplied historical composition is accepted. |
| Streaming ETL | Common ingest path streams (`etl/etl/__main__.py:851–1110,1346`; `etl/etl/ingest/national.py:165–237`). Synthetic 2025 ZIP CLI/database and 400k memory tests exist (`etl/tests/test_cli.py:794,7661`). | Actual approximately 3.76 GB PASO ingestion was not verified by this audit. This does not mean it never happened or that streaming is missing. |
| Archive boundary | CLI registration: `etl/etl/__main__.py:3269–3346,3684–3693`; hash gate: `etl/etl/archive.py:68–100`; ZIP safety: `etl/etl/storage.py:118–225`. | Manifest status is not fresh archive-byte verification or proof of hosted projection. |

### Curated metadata, not raw-row completeness

Read-only parsing found **30 canonical parties, 83 mappings, two jurisdiction crosswalks, and zero duplicate full mapping keys**. The key is `(year, jurisdiction, category, list_id)`; evidence: `curated/party_map.yaml:35–734` and `curated/crosswalk.yaml:18–28`.

| Year | Jurisdiction/category | Mappings |
| --- | --- | ---: |
| 2023 | Coronel Rosales municipal / CONCEJALES | 4 |
| 2023 | National / DIPUTADO NACIONAL | 6 |
| 2023 | National / PRESIDENTE Y VICE | 5 |
| 2025 | Coronel Rosales municipal / CONCEJALES | 8 |
| 2025 | National / DIPUTADO NACIONAL | 15 |
| 2025 | PBA / DIPUTADOS PROVINCIALES | 15 |
| 2025 | PBA / SENADORES PROVINCIALES | 15 |
| 2025 | Tigre municipal / CONCEJALES | 15 |
| **Total** | **2023: 15; 2025: 68** | **83** |

These counts describe curated definitions, not loaded data, completeness against source rows, or complete party identity resolution across the national corpus.

## Confirmed maintenance debt versus operational unknowns

**Pre-existing repository debt:** there is no root README, and `apps/web/README.md:1–7` is focused on E2E. `supabase/migrations_down/README.md:1–20` prescribes an old path while `supabase/tests/results_exploration_release.sql` references `supabase/migrations/down`. Also, `docs/results-exploration.md:14–26` still describes migrations `0001–0027` / synthetic `0028`, while `apps/web/scripts/e2e-gate-runtime.ts:183–248,362–390` inventories through `20260910212254` / synthetic `0039`. These are documentation drift, not evidence that rollback support is universally absent or SQL is unsafe.

`apps/web/src/lib/boundary.ts:1–19` is a Phase 1 scaffold reached only by its test. The old `ResultsExplorationRepository` RPC adapter at `apps/web/src/lib/results/exploration.ts:212–256` is test-only, but shared helpers/types in that file are production-used. Cleanup must not delete the entire file. The `/auth/callback` allowance at `apps/web/src/middleware.ts:12` has no matching route found: a stale path, not an observed authentication bypass.

**Operational unknowns:** deployed Git/migration alignment, hosted authorization state, source-by-source projection counts, hosted telemetry, and storage retention/encryption were not observed. A storage policy was not found in inspected repository material; that does not establish unsafe storage.

The historical blanket “weak observability” assessment is too broad for current repository tooling. Local diagnostics include timing (`apps/web/scripts/e2e-gate-timing.ts:1–87`), bounded browser failure diagnostics (`apps/web/e2e/playwright-failure-diagnostics.ts:5–86`), release receipts (`apps/web/e2e/release-gate-reporter.ts:146–316`), cleanup (`apps/web/scripts/e2e-gate-runtime.ts:555–641`), and ETL redaction (`etl/etl/verify.py:154–191`). App-side facet reason/status instrumentation also exists (`apps/web/src/lib/workspace/official-facets.ts:110–117`). These do not prove hosted telemetry. Likewise, `.gitleaks.toml` exists without an invocation in the release workflow, but external GitGuardian passed on PR #299: secret scanning is not absent, and duplicating it is not an established requirement.

## Decision priorities — none authorized by this report

| Priority | Decision to make | Evidence needed before a stronger claim |
| --- | --- | --- |
| 1 — Live assurances | Separately authorize bounded hosted-readiness verification if live access/readiness claims are needed. | Deployed revision/migrations; Auth, schemas, roles/grants/policies; authorized route checks; source projection and curation reconciliation; storage/telemetry ownership. Existing local ledger CI is not a substitute. |
| 2 — Maintainer clarity | Authorize a small runbook and dead-path cleanup work unit. | Accurate setup/release/rollback navigation and verified caller impact; preserve persisted contracts and production-used exploration helpers. |
| 3 — PASO scale evidence | Separately authorize representative offline ingestion proof against actual PASO shape and scale. | Transactional/idempotent outcome, memory behavior, and per-category/per-reason counts; synthetic streaming evidence alone is insufficient. |
| 4 — Product breadth | Decide whether wider PBA coverage or review resolution belongs on the roadmap. | Explicit source/crosswalk/mapping scope and acceptance criteria. These are product choices, not today's confirmed bugs. |

**Bottom line:** retain the August report as history. Use this snapshot for repository status and existing CI evidence; obtain separately authorized operational observations before making live assurances. No follow-up action, deployment, issue change, or source implementation is authorized by this document.
