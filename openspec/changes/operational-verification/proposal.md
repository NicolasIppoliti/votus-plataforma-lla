# Proposal: Private operational verification

Planning only; STOP BEFORE APPLY. This proposal is the PRD;
specs will own acceptance scenarios.

## Intent, users and value

Responsible internal operators need reproducible, bounded diagnosis
before making hosted-state claims. Existing local/CI controls work,
but do not prove deployed alignment, access or data.

## Scope

- A usable operator procedure, sanitized template and clear entrypoint,
  delivered by a future implementation task using approved existing interfaces.
- Selected official 2023/2025 metadata and aggregates for Coronel Rosales:
  national distrito `02`, sección `027`; preserve source/category/granularity.
- Deployment, migration, effective-access and selected-data reconciliation;
  storage retention/encryption and monitoring ownership: observed or unknown.

### Non-goals

No live checks now; no scraping, ingestion, repair, deployment,
account creation, permission widening or release automation.
No fiscalización, rejected-count exposure, raw rows/payloads, logs,
credentials, tokens/cookies or personal-data collection.
Domain/source-isolation/privacy contracts remain unchanged.

## Observable outcomes

| Observation | Required distinction |
| --- | --- |
| Deployment | Approved revision versus served target/domain provenance; missing provenance stays unknown. |
| Migrations | Timestamp alignment, not SQL identity or drift-free schema. |
| Access | Verified JWT ≠ Auth session ≠ entitlement ≠ route authorization. |
| Controls | Grants, RLS, function execution and API exposure separately from route/status/cache behavior. |
| Official data | Selected source/projection/mapping aggregates reconciled at compatible granularity; not corpus completeness. |

Missing authorization, metadata or data means unknown/not observed,
never zero, repair or broader access. Negative checks use only approved
identities/territories; unavailable approved cases remain not verified.

## Evidence and authority

- Approve exact future target, revision, selected sources/categories and
  existing accounts before execution; never fabricate JWTs.
- Record observation time, scoped provenance, opaque actor/approval reference,
  result, mismatch/unknown reason and limitations.
- Private internal operator evidence stays outside Git for 30 days,
  then is deleted; repository holds only procedure/sanitized template.
- Diagnosis only: human evaluation, no automatic release block or approval.
- Auth refresh may change tokens/cookies; no zero-state-change promise.

## Capabilities

### New

- `operational-verification`: bounded private diagnosis contract.

### Modified

None; existing product authorization remains unchanged.

## Approach and affected areas

Design finalizes methods, paths and interface/version prerequisites;
no architecture, CLI, table, ledger or telemetry service is preselected.

| Area | Impact |
| --- | --- |
| `docs/` | Future procedure/template; exact paths deferred. |
| `/api/workspace/official/result`, `workspace_api` | Existing observation surfaces, not new bypasses. |
| `supabase/migrations/` | Comparison reference only; unchanged. |
| `docs/roadmap.md` | Separate cross-workstream index. |

## Risks and rollback/stop

False assurance and metadata leakage are primary risks.
Stop affected checks on mismatch, unsafe output or missing authority;
record limitations for human review. Withdraw unsafe procedure/evidence;
no database rollback or remediation is authorized.

## Dependencies and traceability

[Audit](../../../docs/audits/2026-09-11-project-status.md),
[exploration](exploration.md), confirmed [handoff](preproposal.md) revision 5,
and completed [research](research.md) revision 3:
C1–C3 alignment; C4–C7 access/privacy; C8 existing interfaces.
Historical `access-control` single-role spec wording conflicts with the
audited exact-section runtime: preserve files, never weaken access.

## Success criteria

- Operators can follow the entrypoint and produce bounded evidence.
- Every observation distinguishes evidence, failure and unknown.
- Privacy, authorization and stop rules constrain the complete procedure.
- Missing observations never become readiness/security certification.