# Private operational verification

Use this procedure to record bounded facts for responsible internal operators, not to certify production health, security, completeness, or release readiness.
Start from the [roadmap](roadmap.md); record only permitted summaries in the [evidence template](templates/operational-verification-evidence.md).

## Quick path: BUILD and REVIEW are offline

1. Read the RUN gate below without opening a target, validating an account, or executing a hosted command.
2. Walk through the ten synthetic cases at the end and follow the template backlink here.
3. Accept the documentation independently of execution. Leave all actual deployed-state claims unverified.
4. Return to the responsible human. A future RUN needs separate explicit authorization; document completion is not that authorization.

No new runtime, CLI, table, ledger, telemetry service, or automation is required.
This is not the general setup/release/rollback runbook or dead-code cleanup; those remain separate roadmap work.

## RUN gate: complete before any future observation

The approver must supply the following through an existing private channel. Do not discover missing targets or accounts by enumeration.

| Prerequisite | Operator action before proceeding |
| --- | --- |
| Exact target/domain and expected revision | Confirm the approved environment, deployment/domain association to inspect, and revision reference; use opaque references in evidence, never private URLs. |
| Existing approved accounts | Confirm which existing accounts and exact scopes may exercise positive and negative cases. Do not create users, fabricate JWTs, use service keys, or broaden permissions. |
| Selected official scope | Identify each 2023/2025 election/source and category, national distrito `02`, sección `027` (Coronel Rosales), and compatible granularity. A partido total is section-level, not province-level. |
| Safe existing presentation | Establish beforehand that each approved interface exposes only permitted official metadata/aggregates and sanitized status/cache information. Record the approval reference. |
| Available observation tooling | Check current provider documentation/changelog, supported CLI version/help, existing connection context, permissions and hosted PostgreSQL compatibility before use. Missing support means unknown; do not install, bootstrap, link or repair. |
| Side effects understood | Disclose that Auth refresh can update tokens/cookies and provider/session state. Domain-data read-only is not zero state change. Obtain approval for the existing journey with those effects. |
| Private recording and deletion | Agree the responsible operator, authorized audience, private location outside Git, and manual deletion deadline no later than 30 days after observation. |

Absent RUN authority: record `refused/not_ready`, reason “authorization unavailable”; do not execute or include counts.
If a particular approved observation lacks an input/interface, mark its claim `unknown` and stop that check. Other checks may proceed only if independently authorized and safe.
A negative case unavailable within the approved accounts/targets is “not verified”, not permission to try another identity or territory.

**Never fetch a raw or mixed bundle to sanitize later.** The existing official bundle can include nonofficial exclusion metadata.
Without a beforehand-established safe official-only presentation, record `unknown: safe presentation unavailable` without requesting or inspecting the raw response.
Do not fetch fiscalización, raw rows, raw payloads, logs, screenshots, credentials, tokens/cookies, personal data, or sensitive catalog/function-definition inventories.
Safe recording below means summarizing an already-safe observation, not cleaning an unsafe export.

## Outcomes: one record per claim

| Outcome | Use it when | Recording rule |
| --- | --- | --- |
| `observed` | An approved supported observation establishes the stated scoped fact, including an expected denial. | State exactly that fact and its limits. An expected denial establishes denial, not an empty dataset. |
| `mismatch` | Supported evidence disagrees with the expected fact. | Record a safe disagreement summary and stop the affected check; no passing inference. |
| `unknown` | Evidence, compatible counterpart, permission, safe presentation or approved case is unavailable. | Give the reason; “not observed”/“not verified” are unknown, never zero. |
| `refused/not_ready` | The authorization/prerequisite gate prevents execution. | Give the safe reason only; no counts. |

A successful authorized supported empty aggregate can establish zero for that exact selected scope.
A missing, denied, unavailable or rejected response cannot establish zero, even with HTTP success.
Never record refused, not-ready or rejected-payload numbers. This record restriction does not change the existing API transport contract.

## Future RUN observation sequence

For each step: confirm its gate, write the expected claim first, observe only through the approved safe interface, then complete one template record. Stop on the conditions below; do not retry through broader access.
The methods are existing interfaces, not blanket permission to execute them or instructions to add new commands.

### 1. Deployment provenance

In the authorized Vercel Project Overview/Deployments dashboard, select only the approved target.
Compare the expected revision with displayed deployment commit provenance and the approved domain's association to that deployment; note environment/status separately.
Record the supported association as observed or mismatch. Missing commit/domain provenance is unknown.
A branch label, successful build or “latest production” label alone does not prove which revision the approved domain serves. Do not open deployment logs.

### 2. Migration timestamp inventory

Use the supported existing Supabase migration-history listing (`supabase migration list`) only after its version/help and already-configured connection context are confirmed under the RUN approval.
Compare the approved revision's migration timestamp inventory in `supabase/migrations/` with the authorized remote timestamp listing; record alignment, mismatch, or unavailable.
This establishes timestamp-inventory alignment only: not original SQL-byte identity, absence of manual schema drift, or projected-data correctness.
Do not push/apply/repair migrations, relink the project, query broader catalogs, or reconstruct function definitions to strengthen the claim.

### 3. Separate access and route claims

Use approved metadata presentations and the existing scoped application journey; mark any unsupported claim unknown rather than inventing an observation method.
The existing `/api/workspace/official/result` route reaches `authorizedOfficialBundle` and the `workspace_api` facades; this names the existing boundary, not a raw-bundle inspection recipe.
Preserve exact-section entitlement controls, not historical single-role assumptions.

| Separate claim | Permitted evidence and limit |
| --- | --- |
| JWT signature/expiry validation | An approved safe validation summary; `getClaims` semantics alone do not establish Auth-server session validity. Never inspect or record the JWT. |
| Auth-server session validity | Independently approved safe Auth-server evidence (`getUser` semantics); no user details in the record. If unavailable, unknown; do not modify the application to obtain it. |
| Application entitlement | Approved exact-section entitlement evidence for the existing account; JWT/session success is not entitlement. |
| Object grants | Approved scoped metadata for object access; grants alone do not prove row access. |
| RLS | Approved scoped row-policy/effective-access evidence; object access is a different fact. |
| Function execution | Approved evidence of EXECUTE/security context for the selected facade; RLS is not function authorization. No definition enumeration. |
| Data API exposure | Approved scoped enablement/exposure evidence; neither default-grant documentation nor a metadata badge proves effective route access. |
| Route authorization | The separately approved existing journey's authorized or expected-denied result for the exact selected section; do not infer other territories. |
| HTTP status | Safe status-only observation; preserve invalid-request 400 and other-failure 403 behavior, without copying error bodies. |
| Cache handling | Safe cache-policy-only observation, separately noting private/no-store; do not copy response cookies or full headers. |

For negative cases, use only explicitly approved existing accounts/targets and safe presentations. If no such case is available, record not verified; never manufacture an invalid identity or broaden scope.
Data API GET/HEAD read-only mode is not a guarantee about arbitrary application routes, Auth refresh, or other provider effects.
HTTP success is not authorized-data success; denied/not-ready/rejected payload numbers do not belong in the record.

### 4. Selected official reconciliation

Use only the preapproved official-only aggregate/provenance presentation and an authorized compatible official source summary.
For each selected election, retain source reference, category, `02/027`, granularity and mapping reference; compare source and projection at the same scope and units.
Keep 2023 and 2025 results distinct; compare across years only where categories/granularity are explicitly compatible. Do not silently sum conflicting mappings or degrade granularity.
Record each permitted official exclusion breakdown by category or reason, not just a total. Preserve meaningful allowed counts; the refusal/rejected-payload prohibition is not a prohibition on legitimate official exclusions.
A missing counterpart is unknown. A valid authorized empty aggregate can be zero; missing/denied cannot.
Manifests, mapping counts and CI do not establish hosted availability or corpus completeness. If the only available presentation mixes nonofficial metadata, stop without fetching it.

### 5. Storage and monitoring ownership

Ask for existing authorized owner evidence of storage retention, encryption and monitoring responsibility; record these as separate observed or unknown claims.
Record only the bounded owner statement and opaque evidence reference, not configuration dumps or telemetry logs.
Unavailable ownership evidence stays unknown. Metadata access does not authorize sensitive catalogs, function definitions, broader monitoring access, or a zero-effects claim.

## Stop, record, and close

1. On missing authority, stop before contact. On mismatch, unsafe presentation or unavailable input, stop the affected check and dependent claims.
2. Record only the safe scope, outcome, reason and limitation. Never save unsafe output; if accidentally captured, withdraw it from circulation and remove the unsafe copy rather than attaching it to a report.
3. Notify the responsible operator through the approved private channel using only a safe reason. No repair, deployment, ingestion, scraping, account/config changes, bypass, or access broadening is authorized.
4. Review the template fields before retention. Keep the sanitized record private outside Git; no issue/PR attachment, shared logs, screenshot, or payload export.
5. The responsible human evaluates mismatches and unknowns. There is no automatic release approval or block, and no overall “passed” certification from a subset.
6. Assign the manual deletion deadline at observation time, no later than day 30. The responsible operator deletes all retained record copies by that deadline, including copies shared with the authorized audience, using the existing private storage controls. No deletion automation is introduced.

## Ten command-free synthetic walkthroughs

These are documentation exercises, not hosted evidence or executable tests. All labels and values below are synthetic; no real account, domain or project is identified.
For each case, start at roadmap NOW → this procedure → evidence template, apply the named step, and return through template → procedure → roadmap. Check that no link implies RUN approval.
Requirements R1–R5 follow the order in the [specification](../openspec/changes/operational-verification/specs/operational-verification/spec.md).

### W1 — Procedure is accepted without execution (R1)
Given complete documents but no RUN approval, follow Quick path and open the local template.
Expected: documentation can be accepted; actual target claims remain unverified. No hosted contact, readiness claim or automatic release decision is needed.

### W2 — Live execution lacks authority (R1)
Given `synthetic-approval-missing`, attempt the RUN gate on paper.
Expected: `refused/not_ready`, reason “authorization unavailable”; target is unobserved, no counts or account validation, stop before contact.

### W3 — Approved selected reconciliation (R2)
Given synthetic approval and safe presentations for official 2025/source-A/category-A/02/027/seccion, source and projection each show synthetic aggregate 12 with mapping-A.
Expected: step 4 records observed selected-scope agreement with all provenance, not corpus availability. An independently authorized supported empty counterpart pair establishes synthetic zero only for that same scope; a manifest/CI result alone cannot.

### W4 — Required scope is absent (R2)
Given a missing selected category or compatible source counterpart, follow gate and step 4.
Expected: affected reconciliation unknown, no number. A denied response also leaves aggregate unknown, never zero; if the whole RUN lacks approval use W2. An unavailable approved negative account remains not verified, not replaced by enumeration.

### W5 — Evidence supports only a bounded claim (R3)
Given synthetic matching migration timestamps and JWT validation only, complete separate records in steps 2–3.
Expected: timestamp alignment and JWT validation observed; SQL identity, drift absence, Auth-server session, entitlement, grants, RLS, function, API and route/status/cache remain unknown without their own evidence. A Data API GET fact adds no zero-Auth-effects claim.

### W6 — Mismatch or unsafe result occurs (R3)
Given synthetic expected revision-A but safe provenance says revision-B, apply step 1 and Stop.
Expected: mismatch, affected/dependent checks stopped, safe reason only, no repair. In the privacy variant, a presentation is known to include nonofficial exclusion metadata: refuse that observation before fetching, record unknown safe-presentation status, no raw-response inspection. If unsafe evidence was accidentally captured, withdraw/remove it and notify the operator without copying it.

### W7 — Private evidence is retained (R4)
Given the synthetic observed record in the template, inspect provenance, outcome, responsible operator and `synthetic-T0 + 30 days` deadline.
Expected: only permitted summary fields retained privately outside Git; operator manually deletes all copies by deadline. Missing retention ownership prevents recording readiness; no automatic release verdict follows.

### W8 — Repository template is prepared (R4)
Given the template's synthetic examples, read every field before considering a repository change.
Expected: opaque synthetic labels/placeholders only, no live evidence, private URLs, identities, secrets, screenshots, logs or payloads. Refusal/rejected-payload count fields are absent. Follow its backlink to this procedure and then the roadmap.

### W9 — Authorized exclusions are meaningful (R5)
Given preapproved official-only presentation with synthetic category-A/reason-A count 2 and category-B/reason-B count 1, apply step 4 and the optional template breakdown.
Expected: retain both permitted rows as approved selected scope, not only total 3. If the only bundle mixes nonofficial exclusion metadata, record unknown without fetching it; do not globally suppress legitimate official exclusions or expose rejected-payload numbers.

### W10 — Ownership evidence is unavailable (R5)
Given no authorized storage retention/encryption or monitoring owner evidence, apply step 5.
Expected: each ownership claim unknown with safe reason; no metadata widening, telemetry access, or invented ownership/health claim.

## Basis and next step

[Research](../openspec/changes/operational-verification/research.md) C1–C8 supplies the bounded interface semantics; provider docs and compatibility must be checked again before a separately approved RUN.
Return to the [roadmap](roadmap.md) for unrelated future work. This procedure does not publish evidence or authorize delivery.