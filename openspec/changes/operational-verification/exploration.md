# Exploration — operational-verification

## Phase envelope

- **Status:** complete; exploration only. No hosted contact, raw archive/fiscal-data, secrets/environment/log access, tests, builds, installs, implementation, or delivery action occurred.
- **Inputs:** `AGENTS.md`, `openspec/config.yaml`, and `docs/audits/2026-09-11-project-status.md`, plus targeted repository evidence cited below.
- **Method boundary:** CodeGraph MCP/CLI is unavailable in this executor, so targeted file reads/grep were used after confirming the supplied repository root. No index was initialized.
- **Important:** repository CI and disposable release gates are evidence about the audited commit only; they do not establish deployed revision, migration state, Auth, grants, projection contents, telemetry, storage, or readiness.

## Executive finding

The audit identifies one coherent unknown class: **authorized, bounded collection of deployed-state evidence**. It is not a repository-security defect and should not default to a new CLI, table, telemetry service, or persistent ledger. The narrow first SDD can decide the evidence contract and an operator-run, read-only verification path; it must wait for product/owner decisions below before a proposal.

## Existing contracts and reachable seams to carry forward

| Area | Production consumer / executable path | Contract useful to operational verification |
| --- | --- | --- |
| Authorized official results | `GET /api/workspace/official/result` parses the request and calls `authorizedOfficialBundle` (`apps/web/src/app/api/workspace/official/result/route.ts`); the workspace module verifies claims before calling `workspace_api` (`apps/web/src/lib/workspace/context.ts`). | Private/no-store responses; invalid request is 400, all other failures are 403 without provider detail. Do not introduce a parallel raw-table read path. |
| Effective application authorization | `workspace_api.official_result` and `.official_comparison` require an exact entitled section and return denial/unavailable states (`supabase/migrations/20260826200000_authorized_official_operations.sql`). | Verify a real authorized route/facade outcome, exact-section denial, source separation, and no raw bypass only with approved identities/scopes; do not equate catalog grants with effective request behavior. |
| Source/projection provenance | `authorizedOfficialBundle` also calls `official_reference` and `official_provenance`; the latter returns official `archive_entry` metadata and source exclusions (`supabase/migrations/20260827000000_authorized_official_projections.sql`). | Existing user-facing provenance can anchor selected-scope evidence, but cannot prove archive bytes, all projection completeness, or hosted manifest status. |
| Auth/session context | `workspace_api` validates `sub`, `session_id`, and expiry and binds a session to organization/entitlement revisions (`supabase/migrations/20260826050000_workspace_context_selection.sql`). | Existing disposable DB test seam drives `authenticated` RPCs and stale/revoked/session cases (`etl/tests/test_migration_integration.py`). Hosted verification needs separately approved real identities, never fabricated JWT claims. |
| Migration inventory and rollback | `etl-verify` applies migrations only to a UUID-owned disposable DB; `--migration-atomicity` is explicitly restricted to GitHub’s owned loopback service (`etl/etl/verify.py`, `etl/etl/migration_atomicity.py`). Down files require deliberate manual application (`supabase/migrations_down/README.md`). | These are local safety proofs, not a deploy/migration operator. Any hosted migration observation must stay read-only in this slice; rollback authorization remains separate. |
| Release evidence | `.github/workflows/release-gates.yml` runs static, disposable ETL, and disposable E2E gates on PR/main. `ReleaseGateReporter` writes a 0600 receipt only to the configured per-run path (`apps/web/e2e/release-gate-reporter.ts`). | CI receipts and cleanup diagnostics are ephemeral local/CI artifacts, not persistent deployed evidence and not a release approval mechanism. |
| Archive/operator CLI | `python -m etl fetch`, `archive-history`, `ingest`, `load-curated`, and validators are actual parser entry points (`etl/etl/__main__.py`). Archive reads hash-check manifest bytes (`etl/etl/archive.py`). | No existing deployed-readiness subcommand exists. `archive-history`/manifest data are local artifacts; no raw archive access is needed for the first slice. |
| Review surfacing | `review_item`/scoped review facades persist ingestion exceptions, with category/reason counts (`supabase/migrations/0007_review_item.sql`, `20260827160000_platform_review_operator_access.sql`). | It is an ingestion/review queue, not an operations-verification ledger. Do not overload it with deployment attestations. |

### Existing persistent metadata verdict

`archive_entry` persists archive metadata and `review_item` persists review findings; workspace audit events record context switches. No inspected mechanism persists a deployed revision + migration inventory + Auth/grant/route/projection verification attestation. The atomicity “ledger” case is a deliberately injected disposable migration-history failure, not an operator ledger. A new table or telemetry/CLI wrapper is therefore an option requiring design, not a presumed need.

## Candidate first-slice boundaries (not a design choice)

| Alternative | Value / trade-off |
| --- | --- |
| **A. Operator-run, read-only evidence contract and runbook** | Smallest path: identify allowed target, approver, minimum observations, redaction/retention, stop conditions, and evidence audience. Can use existing hosted-preflight pattern in `docs/results-exploration.md` without copying its stale migration inventory. Produces no deployment, migration, or new runtime surface. |
| **B. Repository automation of an approved read-only check** | More repeatable, but introduces credential handling, target selection, output retention/redaction, identity lifecycle, and failure consequences. It must not run from ordinary CI by default; needs design and security/owner approval first. |
| **C. Persistent verification ledger/metadata** | Auditable history, but adds a new sensitive data model and operations lifecycle. Existing records do not establish this need. Defer unless the audience/release policy requires durable attestations beyond an approved evidence record. |

## Observable acceptance ideas for the future first slice

After explicit authorization, the chosen path could require an evidence record that distinguishes observed, unobserved, and failed checks, with timestamp, target identifier, actor/approval reference, redaction rule, and no credentials/personal data. Its minimum claims should be selected from:

1. deployed application revision aligned (or explicitly not aligned) with an approved repository revision;
2. applied migration inventory aligned with the expected immutable prefix, with drift as a stop condition;
3. effective Auth/session and exact-section facade behavior under approved test identities, plus anonymous/raw-access denial where safely observable;
4. effective grants/policies/function exposure cataloged separately from route behavior;
5. selected official source/projection and curated-mapping reconciliation counts, labelled as selected scope rather than corpus completeness; and
6. ownership/status of storage retention/encryption and hosted telemetry, recorded as unavailable if no owner evidence exists.

Acceptance must never certify general security, data completeness, performance, or commercial readiness from a passing subset. It must also state whether a failed/unknown result blocks release, creates a follow-up, or merely limits a claim.

## Product and authorization decisions required before proposal

1. **Assurance depth:** deployment alignment only; alignment plus Auth/grants/routes; or also projection reconciliation, storage, and telemetry?
2. **Data scope:** which environment and exact official election/category/section(s) may be read; are aggregate counts permitted; are any fiscalización checks categorically excluded?
3. **Evidence audience and retention:** named operator/owner only, internal reviewers, or release record; where may redacted evidence live and for how long?
4. **Release consequence:** what stops a release, what triggers incident/escalation, and who can accept an unknown or mismatch?
5. **Identity model:** which pre-existing approved accounts/scopes can exercise authorized and denied paths without creating persistent test users or widening access?

## Research to select later (no external research performed)

- **Supabase official operational docs:** current supported read-only migration-history, Auth configuration, role/grant/RLS catalog, and connection guidance; question: which observations are authoritative and safely least-privileged?
- **Vercel official deployment docs:** revision/build-to-deployment provenance and access/audit evidence; question: what proves the served revision without publicizing identifiers?
- **Internal deployment/incident policy:** authorization, retention, redaction, and release-stop authority; question: who owns each claim and remediation?
- **Electoral provenance policy/source contracts:** permitted reconciliation granularity and evidence retention; question: which official count comparisons are meaningful without exposing raw rows?

## Roadmap map (sequencing recommendation, not approval)

| Horizon | Workstream | Dependency / boundary |
| --- | --- | --- |
| **NOW** | Operational verification first slice | Resolve the five product gates above; then select A/B/C. No hosted action until separately authorized. |
| **NEXT** | Maintainer runbook + dead-path/doc-drift cleanup | Can proceed independently after caller inventory; correct `migrations_down`/release-doc drift, preserve production-used helpers, and do not claim hosted state. |
| **NEXT** | PASO-scale proof | Separate offline authorization for actual PASO shape/scale; require transactional/idempotent outcomes, memory observation, and per-category/per-reason exclusion counts. |
| **LATER** | PBA municipal expansion | Product selects jurisdictions/sources/crosswalk/mapping acceptance; current support remains only `027` and `113`. |
| **LATER** | Review resolution lifecycle | Product decision and full authorization/audit design; current review UI is read-only, not a defect. |
| **LATER** | Deferred local keyboard flakiness | Remains deferred by user; do not bundle with operational assurance. |

If a durable roadmap is authorized, prefer a single new `docs/roadmap.md`: existing conventions use dated snapshots in `docs/audits/` and topic-specific operational guidance in `docs/results-exploration.md`; a stable cross-workstream index avoids turning either into a duplicate PRD/spec. Do not create it until the roadmap content is approved.

## Non-goals

- No production/hosted query, migration, deployment, credentials, logs, raw archive/fiscal data, or test execution.
- No re-audit of repository controls, no new security finding, and no readiness/certification claim.
- No implementation, custom CLI, database table, telemetry, service wrapper, or persistent ledger by default.
- No alteration of archived changes, audit file, session delivery policy, or the preserved untracked audit artifact.

## Handoff

**Next recommended:** parent obtains product decisions above, selects research scope, then authorizes a pre-proposal handoff. Only then decide whether a concise proposal can serve as the PRD and whether a design phase is needed. No proposal/spec/design/tasks were created in this phase.