# Design: Private operational verification

STOP BEFORE APPLY. Implements [proposal](proposal.md)/[spec](specs/operational-verification/spec.md).
Authority: [preproposal v5](preproposal.md); citations: [research v3](research.md) C/S IDs.

## Decision and integration boundary

| Option | Tradeoff | Decision/rationale |
| --- | --- | --- |
| Markdown/existing interfaces | Manual recording/deletion | Selected: no credential machinery. |
| CLI/service/table/ledger | Security/lifecycle overhead | Rejected: repeatability insufficient. |

Final stack: Python/uv ETL → Supabase Postgres/Auth/RLS → Next.js/Vercel, unchanged; documentation-only, no new runtime.
ETL/archive/migrations remain references.
`apps/web/src/app/api/workspace/official/result/route.ts` reaches `authorizedOfficialBundle` in `apps/web/src/lib/workspace/context.ts`, then `workspace_api` result/reference/provenance/schools.
Preserve exact-section controls, not stale single-role wording.

## Future file changes and discovery

| Exact path | Future action |
| --- | --- |
| `docs/operational-verification.md` | Create procedure: prerequisites, observations, stops, closure; link template/roadmap. |
| `docs/templates/operational-verification-evidence.md` | Create sanitized template/synthetic example; backlink procedure. |
| `docs/roadmap.md` | Link NOW to procedure entrypoint. |

Independent root-runbook/dead-code cleanup remains NEXT; no copying stale inventories/commands/raw-output capture from `docs/results-exploration.md`.

## Lifecycle and observation flow

```text
BUILD → REVIEW (offline acceptance) → awaiting separate RUN authorization
RUN gate → approved observation → sanitize → private record → human evaluation → deletion
         ↘ refused/not_ready          ↘ stopped: mismatch/unsafe/unavailable
```

BUILD/REVIEW never authorizes RUN, including after apply.
RUN requires exact target/domain, revision, approved existing accounts, selected official 2023/2025 sources/categories and compatible granularity: Coronel Rosales distrito `02`, sección `027`.
Disclose Auth refresh/token-cookie updates and provider/session effects beforehand: domain-data read-only ≠ zero effects (C4/C6; S3/S4).
Verify current provider docs/changelog, CLI help/version, connection context, permissions and hosted PostgreSQL compatibility before use; unavailable means unknown, never install/bootstrap/link/repair.

| Observation method | Bounded claim and limitation |
| --- | --- |
| Authorized Vercel dashboard | Approved revision versus served deployment/domain provenance; absent provenance unknown (C1; S1/S8). |
| Supported migration listing | Timestamp alignment only, not SQL identity/schema-drift attestation (C2/C3; S2/S5). |
| Approved metadata/existing scoped journey | Separate JWT validation, Auth-server session, entitlement, grants, RLS, function execution, API exposure, route/status/cache claims (C4–C7; S3–S7). |
| Existing official aggregate/provenance presentation | Reconcile selected source/projection/mapping at compatible source/category/granularity; missing counterpart unknown. Manifests/mapping counts/CI cannot prove availability. |
| Authorized owner evidence | Storage retention/encryption, monitoring ownership: observed/unknown (C8; owner policy). |

No catalog/function-definition enumeration or privilege assumptions (C3/C7).
Negative cases require approved identities/targets; otherwise not verified, never unapproved enumeration.
Preserve HTTP 400/403 and private/no-store headers; HTTP success ≠ authorized data success.
Bundle includes non-official exclusion metadata: without beforehand-established safe official-only presentation, mark unknown; never fetch/export raw payloads for later sanitization.

## Evidence contract and stop rules

Per-claim record: observation time, opaque actor/approval reference, target/revision provenance, source/category/granularity, method/version, expected/observed summary, outcome, reason/limitations, responsible operator, deletion deadline.
Example shape only: `synthetic-target; synthetic-approval; official/2025/synthetic-category/02/027/seccion; unknown; counterpart unavailable; observed_at=<time>; delete_by=<time+30d>`.

- `observed`: supported scoped fact, including expected denial; zero only from successful authorized supported empty aggregate.
- `mismatch`: observed disagreement; stop affected check.
- `unknown`: not observed/not verified, including unavailable approved cases; never zero.
- `refused/not_ready`: authorization/prerequisite gate prevents execution; no counts.

Retain legitimate authorized official exclusion breakdowns by category/reason; never rejected-payload/refused/not-ready counts.
Stop affected checks on missing authority, mismatch or privacy risk. Never save unsafe output; record safe reason only, withdraw unsafe evidence, notify responsible operator.
No fiscal data, PII, credentials/tokens/cookies, service keys, fabricated claims, logs, raw rows/payloads or permission widening.
Private records outside Git; responsible operator deletes by 30 days, no automation.
Human diagnosis, no automatic release verdict.

## Acceptance, rollout and risks

Plan synthetic offline walkthroughs of all five requirements/ten scenarios, including empty-versus-denied, exclusions, privacy failure, unknown ownership and real roadmap→procedure→template navigation.
No checks run now; documentation acceptance needs no live checks. Later executable behavior requires genuine RED-before-implementation/GREEN/refactor, never fabricated TDD.
No migration. Publish reviewed docs; rollback withdraws/reverts docs, never hosted state.
No scraping, ingestion, deployment, repair, account/config changes, release automation or `getClaims` changes based on documentation alone.
Threat matrix: N/A—no routing, shell, subprocess, VCS automation, executable classification or process-integration changes.
Risks: false assurance, mixed metadata, stale compatibility, missed deletion. No unresolved product contradiction; unsafe/unavailable interfaces remain unknown.
Tasks forecast 400-line budget, ask-on-risk; chaining deferred.