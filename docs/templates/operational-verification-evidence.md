# Operational verification evidence template

Return to the [operator procedure](../operational-verification.md) for the RUN gate, observation sequence, stop rules and ten offline walkthroughs.
This repository copy is a blank/synthetic aid, not evidence of a RUN. Actual sanitized records belong in approved private storage outside Git, never in this file or an issue/PR.

## Filling rules

1. Complete the procedure's gate before any observation. Use existing private approval references to resolve exact target/domain, revision and account authority; never paste identities or private URLs here.
2. Make one record per claim. Keep JWT, Auth session, entitlement, grants, RLS, function execution, API exposure, route authorization, HTTP status and cache handling separate.
3. Use short safe summaries, not copied output. Do not capture raw/mixed responses for later sanitization; establish a safe official-only presentation beforehand or record unknown.
4. Require every field below; use `unknown` with a reason when unavailable, or `not applicable` with a reason for non-data provenance fields. Do not invent missing facts.
5. Remove the optional aggregate section unless supported and authorized. Refused/not-ready/rejected-payload records contain no counts, including in free-text summaries.
6. The responsible operator checks privacy, restricts the audience, and manually deletes every retained copy no later than 30 days after observation. No release verdict field exists.

No personal data, credentials, service keys, tokens, cookies, logs, screenshots, raw rows/payloads, fiscalización or sensitive metadata inventories may be included.
Opaque references must not embed identities, project URLs or secrets. Keep any reference resolution in the existing private approval channel, not a new repository mapping.

## Per-claim record: copy only into approved private storage

| Required field | Bounded value to fill |
| --- | --- |
| Record / claim | Opaque record reference; one specific claim from the procedure. |
| Observation time | Time with timezone; for refusal record gate-evaluation time and “not observed”. |
| Actor / approval | Opaque operator and approval references, or approval unavailable; no account details. |
| Target/domain provenance | Opaque approved target and association-evidence references; expected versus observed association summary, or unknown. |
| Revision provenance | Expected revision reference; observed revision/provenance reference or unknown; never infer from branch alone. |
| Selected scope | `official`; election/year, source reference, category, national distrito `02`, sección `027`, granularity and units; approved selected scope, not corpus. |
| Counterpart / mapping | Compatible official source/projection/mapping references, or unavailable reason; do not include raw rows. |
| Method / version | Approved existing interface, available tool/provider version or unknown with limitation, and safe-presentation approval reference. |
| Expected claim | One sentence describing the bounded expected fact before observation. |
| Observed summary | Safe supported fact, or “not observed”; never rejected/refused/not-ready counts. |
| Outcome | `observed`, `mismatch`, `unknown`, or `refused/not_ready`. |
| Reason / limitations | Required explanation; distinguish expected denial from empty data and timestamp alignment from SQL identity. |
| Stop / human follow-up | Affected/dependent checks stopped, safe notification reference or no stop needed; diagnosis only. |
| Responsible operator | Opaque reference to the person responsible for safe retention and manual deletion. |
| Private location / audience | Opaque existing storage/audience references outside Git; no path containing personal data or private URL. |
| Delete by | Explicit deadline with timezone, no later than observation time + 30 days; operator must remove all retained copies. |

### Optional: permitted official aggregates only

Use only after successful authorized supported observation through an already-safe presentation. Omit for unavailable/denied/refused/not-ready/rejected data; those are not zero.
For a mismatch, retain numbers only if both are legitimate authorized official aggregates, never rejected-payload numbers.
Record a separate row per approved source/category/granularity and a separate row per meaningful permitted exclusion category/reason. Never substitute a total for its breakdown.

| Official source / year / category / section / granularity / units | Source aggregate | Projection aggregate | Mapping reference | Permitted official exclusion category / reason / count |
| --- | --- | --- | --- | --- |
| synthetic-source-A / 2025 / synthetic-category-A / 02/027 / seccion / synthetic-unit | 12 | 12 | synthetic-mapping-A | synthetic-category-A / synthetic-reason-A / 2 |
| synthetic-source-B / 2025 / synthetic-category-B / 02/027 / seccion / synthetic-unit | 8 | 8 | synthetic-mapping-B | synthetic-category-B / synthetic-reason-B / 1 |

These invented values illustrate allowed official breakdowns only. They are not live results or nonofficial-exclusion metadata. A valid authorized supported empty aggregate may record zero; missing/denied evidence may not.

## Fully synthetic record: bounded observation

| Field | Synthetic example |
| --- | --- |
| Record / claim | synthetic-record-A / selected official aggregate agreement |
| Observation time | synthetic-T0 (replace with timezone-qualified time only in the private record) |
| Actor / approval | synthetic-operator-A / synthetic-approval-A |
| Target/domain provenance | synthetic-target-A / synthetic-association-A; approved association observed |
| Revision provenance | expected synthetic-revision-A; observed synthetic-revision-A via synthetic-provenance-A |
| Selected scope | official / 2025 / synthetic-source-A / synthetic-category-A / 02/027 / seccion / synthetic-unit; approved selected scope |
| Counterpart / mapping | synthetic-source-summary-A / synthetic-projection-A / synthetic-mapping-A; compatible scope |
| Method / version | synthetic-existing-presentation-A / synthetic-version-A / synthetic-safe-approval-A |
| Expected claim | Selected source and projection aggregates agree at the approved scope. |
| Observed summary | Permitted official aggregate agreement; optional synthetic row A illustrates the breakdown. |
| Outcome | observed |
| Reason / limitations | Only selected-scope agreement; other years/categories, corpus completeness, Auth and ownership remain unverified. |
| Stop / human follow-up | No stop for this synthetic claim; human diagnosis only, no release decision. |
| Responsible operator | synthetic-operator-A |
| Private location / audience | synthetic-private-store-A / synthetic-internal-audience-A; outside Git |
| Delete by | synthetic-T0 + 30 days; manual deletion of all retained copies by synthetic-operator-A |

For the refusal variant, keep required fields but mark target/revision and observed summary “not observed”, approval “unavailable”, outcome `refused/not_ready`, reason “authorization unavailable”, and stop “before contact”. Omit the entire aggregate section; never add refusal or rejected-payload counts.
For unavailable owner evidence, use separate `unknown` claims for retention, encryption and monitoring ownership; no broader metadata access.

Return to the [procedure](../operational-verification.md) before any next observation. Its roadmap link returns to the planning index, not to a release gate.