# Tasks: Private operational verification

Planning only. STOP BEFORE APPLY; creating this plan authorizes neither implementation nor a hosted RUN.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | Current checkpoint: 684 + task-artifact lines; future procedure/template/NOW link: 206–312; lifecycle records: not yet estimated |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Agreed split | A evidence baseline → B actionable plan → C future procedure/template/NOW link |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Measurement and agreed review scopes

- Current checkpoint: 684 hand-authored lines, excluded 0: audit 98; roadmap 57; design 78; exploration 89; preproposal 83; proposal 97; research 84; spec 98.
- Parent checkpoint was 684 + 46 = 730; this 50-line readback makes current planning 684 + 50 = 734; all hand-authored lifecycle artifacts count when generated.
- Excluded by pattern: `**/pnpm-lock.yaml` 0; `**/package-lock.json` 0; `**/yarn.lock` 0; `**/uv.lock` 0; `**/poetry.lock` 0; `**/*.tsbuildinfo` 0.
- Agreed A — evidence baseline: audit 98 + exploration 89 + preproposal 83 + research 84 = 354 measured lines.
- Agreed B — actionable plan: roadmap 57 + proposal 97 + spec 98 + design 78 + 50-line final tasks artifact = 380 (≤390).
- Planned C — future procedure/template/NOW link: 206–312 estimated lines before progress, verification, sync, or other lifecycle artifacts; count and remeasure those records before delivery.
- The owner selected stacked-to-main for A → B → C. The split decision is resolved, not apply/publication authorization; obtain a new scope decision if a final unit exceeds 400 lines. No size exception is authorized.

## Phase 1: Procedure construction

- [ ] 1.1 Create `docs/operational-verification.md` as the offline operator entrypoint: BUILD/REVIEW versus separately authorized RUN, exact approved scope, private evidence boundary, manual 30-day deletion deadline, human-only evaluation, and no hosted-command execution while constructing/reviewing docs; it may refer to supported existing interfaces for a separately authorized RUN. <!-- sdd-owner: implementation -->
- [ ] 1.2 Add the bounded observation sequence and stop rules in `docs/operational-verification.md`: observed/mismatch/unknown/refused-not-ready; deployment provenance, timestamp-only migrations, and distinct JWT, Auth-session, entitlement, grants, RLS, function, API, and route/status/cache claims. <!-- sdd-owner: implementation -->

## Phase 2: Sanitized evidence and offline acceptance

- [ ] 2.1 Create `docs/templates/operational-verification-evidence.md` with only synthetic records, required scoped-provenance/outcome/limitation/deletion fields, and no identities, private URLs, credentials, tokens, cookies, payloads, logs, screenshots, fiscalización, or rejected/refused/not-ready counts. <!-- sdd-owner: implementation -->
- [ ] 2.2 Add offline synthetic walkthroughs for all five requirements and ten scenarios: accepted-without-RUN; no-authority refusal; approved reconciliation; absent scope; bounded claim; mismatch/unsafe stop; private retention; repository template; authorized exclusions; unavailable ownership. Include valid authorized empty=zero versus denied/missing=unknown and privacy refusal; mixed nonofficial-exclusion metadata needs safe official-only presentation or remains unknown without raw-response inspection. <!-- sdd-owner: implementation -->

## Phase 3: Entrypoint and documentation-only verification

- [ ] 3.1 Update `docs/roadmap.md` NOW with the procedure entrypoint, and add reciprocal procedure↔template and procedure↔roadmap links so the real navigation path is roadmap → procedure → template. <!-- sdd-owner: implementation -->
- [ ] 3.2 Perform a command-free offline readback of `docs/operational-verification.md`, `docs/templates/operational-verification-evidence.md`, and `docs/roadmap.md`: verify all ten walkthrough outcomes, link targets, allowed paths, sanitized synthetic bytes, and docs-only diff; do not run app/ETL/E2E infrastructure or contact hosted targets. <!-- sdd-owner: implementation -->

## Human decisions and deferred RUN

- Delivery/chain handling is agreed: stacked-to-main, each PR reviewed against its immediate base and landed in order. Apply, branch creation, commits, push, PR creation and merge still require separate authorization; no tracker is planned.
- A separate later RUN authorization must name the exact target/domain and revision, existing approved accounts, selected official 2023/2025 source/categories at `02/027` compatible granularity, and any approved safe interface. Without it, no target identification, account validation, raw-response inspection, or live command is authorized.
- Existing runners need no establishment task. Strict TDD applies to a separately authorized executable-behavior change; these documentation walkthroughs neither fabricate RED nor waive it.