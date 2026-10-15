# 0003 — Keep Supabase Auth and the session-bound Workspace boundary

Status: Proposed (recommendation for issue #492; not migration approval)

Decision owner: Product owner.

## Decision

**Keep Supabase Auth. Defer a Better Auth migration.** No required auth capability,
observed operational constraint, or measured MAU saving currently justifies changing
the identity provider. Keep Postgres Workspace authorization as the **single authority**
for memberships and section entitlements; do not duplicate it in an Organization plugin.

This is an ADR-only research spike under the owner's explicit scope restriction.
It changes no auth code, framework, provider, billing, domain, traffic, database or
hosted configuration. No disposable executable experiment was run. In particular,
this document does **not** certify Better Auth login, transport compatibility,
revocation latency or authorization equivalence. The executable acceptance criteria
below remain unproven and are explicitly outside this ADR-only deliverable.

## Context

Issue [#492](https://github.com/NicolasIppoliti/votus-plataforma-lla/issues/492)
asks whether Better Auth can replace identity while preserving the session-bound
Workspace contract. A successful cookie check is insufficient: authorization also
requires a selected organization, current membership/entitlement revisions,
territorial scopes, a non-revoked context and immutable fixed expiry.

Repository inspection here uses `b86591165a72aaf1a182a688aead49be6c289453`,
not the older SHA in the issue. Existing ADR 0001 establishes the local decision
format. Number 0003 is reserved for #492 (0002/#491 and 0004/#493 are independent).

The prerequisite #490 baseline was read **read-only from its sibling worktree**:
`/Users/nicolasmateoippoliti/dev/votus-plataforma-lla-worktrees/490/docs/research/page-waterfalls.md`.
It reports 80 successful local samples, zero classified errors, on instrumented
SHA `0dcd6a945b5ad74478c71c7250025fca51573d4e`. It is not necessarily present
on this branch and is not a hosted or Better Auth benchmark. That report is a
measurement receipt, not evidence that its local helper grants are production policy.

## Options

| Option | Benefit | Cost / limitation | Disposition |
|---|---|---|---|
| Keep Supabase Auth + existing SQL facades | Preserves delivered identity/session boundary without migration work | Continues existing provider dependency | Recommend now |
| Better Auth external JWT → PostgREST | Retains facade transport; customizable identity | Signing-key trust/import, explicit JWT verification, claim mapping, live revocation checks and client replacement required | Not selected; no compatibility test |
| Better Auth → trusted backend → SQL facades | Makes live session validation and claim construction explicit in one backend | Adds a privileged trust boundary, DB connection/transaction discipline, handlers and operational ownership | Preferred **future experimental transport**, not approved implementation |

For any reopened experiment, choose only the trusted-backend path initially.
Do not build two adapters or replace SQL authorization with cookie/role checks.
This is a design preference, not the issue's requested tested transport result.
An external JWT being accepted by Supabase does not make `getClaims()` a valid
external-token verifier [S4].

## Evidence (cited)

### Repository boundary

- [Client and facade entry points](../../apps/web/src/lib/workspace/context.ts):
  `verifiedWorkspaceApi()` calls `auth.getClaims()` and requires canonical UUID
  `sub`/`session_id` and a safe-integer future `exp`. `observeWorkspace()` reaches
  bootstrap, available organizations and current workspace; switching sends a
  desired organization and expected revision, not authoritative entitlements.
- [Selection SQL](../../supabase/migrations/20260826050000_workspace_context_selection.sql):
  `trusted_workspace_claims()` parses `request.jwt.claims`; it validates shape and
  expiry, **not cryptographic signature/issuer/audience**. Trust must already have
  been established before SQL receives these settings. Bootstrap inserts once per
  session with `fixed_expires_at` derived from the initial `exp`; conflict does
  nothing. Switching locks the context, checks revisions and current membership,
  and does not update fixed expiry. Zero/one/multiple available memberships do not
  themselves replace explicit context selection; #425 is a separate UX decision.
- [Authorized scope SQL](../../supabase/migrations/20260826160000_authorized_official_facets.sql):
  `authorized_section_scopes()` checks user/session binding, revocation, expiry,
  organization enabled state, membership revocation, both revisions and section
  entitlements. Official facets explicitly filter `source_kind='official'`.
- [Logout action](../../apps/web/src/app/actions/sign-out.ts) first awaits context
  invalidation and only then calls local `auth.signOut`; failures do not redirect.
  [Invalidation SQL](../../supabase/migrations/20260826033130_session_bound_context_invalidation.sql)
  locks and revokes only the claims-bound session context and records an audit event.
- [Legacy ACL closure](../../supabase/migrations/20260829032228_revoke_legacy_results_public_contract.sql)
  revokes direct result/review reads and legacy facade execution from public,
  anon, authenticated and service_role; an identity replacement must not reopen them.
  Service-role RLS bypass is not a substitute for object privileges.
- The Workspace client keeps fiscal coverage/result opt-in separate and types
  `is_random_sample` as literal `false`; [review sanitization](../../apps/web/src/lib/workspace/review-items.ts)
  restricts tenant output. These are obligations to preserve, not proof that an
  alternative provider passes them. Existing SQL suites include
  `supabase/tests/workspace_authorized_operations.sql`,
  `workspace_context_invalidation.sql`, `workspace_review_scope.sql` and
  `workspace_authorized_fiscal_coverage.sql`; none was rerun for this documentation.

### Primary-source research

Official pages were fetched during this spike. Better Auth's documentation displayed
**1.7.10** as its latest version; this is a documentation observation, not an installed
or tested version. The repository pins `@supabase/supabase-js` **2.117.2** and
`@supabase/ssr` **0.12.7** in [package.json](../../apps/web/package.json) and has no
Better Auth dependency there. Documentation is mutable; a later experiment must pin
its exact dependency/runtime/DB versions and archive its receipts.

| Source | Finding relevant to this decision |
|---|---|
| [S1 — Better Auth Supabase migration](https://better-auth.com/docs/guides/supabase-migration-guide) | Example imports preserve `user.id` and credential hashes; Supabase bcrypt needs an explicit compatible verifier because Better Auth defaults to scrypt. User/account import is not session or RLS migration. MFA and authorization require separate treatment. |
| [S2 — Better Auth database](https://better-auth.com/docs/concepts/database) | ID generation is configurable, including custom `crypto.randomUUID()`. Canonical UUID session IDs are feasible by configuration, not established by defaults or a Votus login test. |
| [S3 — Better Auth sessions](https://better-auth.com/docs/concepts/session-management) | Defaults are seven-day sessions with sliding renewal after updateAge. Refresh can be disabled. Optional cookie session-data caching is distinct from the server-side session token and JWT plugin; cache lifetime cannot establish immediate live revocation. |
| [S4 — Supabase JWTs](https://supabase.com/docs/guides/auth/jwts) | External JWTs can use supported third-party auth/imported signing keys, but `getClaims()` is intended for Supabase-issued JWTs; externally minted tokens need an appropriate verifier. |
| [S5 — Better Auth Organization](https://better-auth.com/docs/plugins/organization) | Plugin manages members, teams, roles/permissions and active organization. These do not establish Votus section entitlements, revision CAS or SQL context lifetime. Do not introduce a second membership authority. |
| [S6 — Better Auth JWT](https://better-auth.com/docs/plugins/jwt) | Documents issuer/audience verification with JWKS, configurable payloads and key rotation; rotation is disabled by default. A signed JWT is not a live-session revocation check. |
| [S7 — Supabase pricing](https://supabase.com/pricing) | Public Pro list price starts at $25/month, with 100,000 included MAUs then $0.00325/MAU. This is not Votus usage or an invoice; retained Postgres/project costs do not disappear when Auth changes. |

The official Hyperdrive query-cache page
(<https://developers.cloudflare.com/hyperdrive/configuration/query-caching/>) returned
HTTP 403 to this research fetch. No Hyperdrive cache semantics or revocation guarantee
is inferred from it. No Hyperdrive configuration was changed or tested.

### Performance and cost comparison

#490 observed warm document middleware `getUser` medians around 45–46 ms and
layout `getUser` around 29–31 ms. Individual warm `getClaims` medians were
1.17/1.36/2.03 ms for home/drilldown/compare. In contrast, warm drilldown facets
were about 1669 ms and compare facets about 1821 ms per call (seven calls per
compare document). These spans overlap and include transport: do not sum them
as isolated CPU costs or predict a replacement provider's speedup. The evidence
points toward investigating facets before changing auth for page latency.

| Dimension | Supabase baseline | Better Auth on retained Postgres |
|---|---|---|
| Sign-in latency / hashing CPU | Not measured by #490 | Not measured; bcrypt verification still consumes CPU; benchmark equal hash work and concurrency |
| Session check latency / DB | Observed spans above; not isolated DB timing | Not measured; live session reads plus existing SQL checks remain necessary |
| MAU / project spend | No actual usage or billing evidence inspected | No demonstrated saving; model only avoidable billed Auth charges, not the retained plan |
| Email | Real volume/provider spend unknown | SMTP delivery, retries, abuse controls and recovery remain operating costs; no real email test |
| Keys / cookies | Existing Supabase verification and SSR cookie lifecycle | Own session secret lifecycle, secure cookie/CSRF handling and, if JWT is used, signing/JWKS rotation and audience policy |
| Maintenance | Existing routes and delivered SQL contract | Adapter/schema upgrades, incident response, migration/recovery and parity tests add ownership |

A future comparison must report CPU-ms/login, DB queries and DB-ms/session check,
email count and delivery cost, p50/p95 sign-in/check latency at equal load, and
monthly operator time plus measured billed MAUs. No numeric Better Auth cost or
latency result exists here. The correct economic conclusion is **unproven benefit**,
not zero cost or guaranteed savings.

## Acceptance criteria and deferred experiment

The owner narrowed the issue to an ADR only. “Deferred” below means **outside the
authorized ADR-only outcome and not demonstrated**, not a passed acceptance test.
No production migration is authorized by any proposed experiment.

| Issue AC | Coverage / disposition |
|---|---|
| 1. Concrete benefit and one authorization authority | Addressed: no proven required capability, operational need or observed cost benefit; keep Auth. Workspace Postgres alone owns membership/section entitlements. |
| 2. Synthetic UUID/bcrypt migration fixture and login | Deferred: no executable fixture or login demonstration. A reopened local test must preserve synthetic existing user UUIDs, import bcrypt credential accounts, reject wrong passwords, generate canonical per-login session UUIDs and prove unchanged user identity through real login. |
| 3. Choose and test transport, trusted claims | Design choice: future trusted backend → existing SQL facades. Testing is deferred. Require negative signature/issuer/audience/expiry/role cases; no request-supplied claims or organization identity may become authority. |
| 4. Real login/routes/RPC authorization matrix | Deferred: test selection_required, valid organization, zero/multiple memberships, CAS switch, two tabs and pending requests, independent sessions, membership revocation, disabled organization, revision mismatch, context revocation and expiry through real entry points. Existing source checks are not an alternative-provider demonstration. |
| 5. Fixed expiry/logout/cache/revocation timing | Deferred: assert original fixed expiry unchanged after refresh/read/switch; invalidate context before deleting session. Replay old cookies and pending requests after revocation with caches enabled/disabled; prove no resurrection. Effective time-to-denial is **not measured**. |
| 6. ACL/review/fiscal/audit | Existing contract documented above; alternative-provider proof deferred. Exercise anon, authenticated tenant and service_role direct-table denials, tenant/platform review separation, fiscal opt-in/denominator/no-mixing, and audit actor/session binding without user-editable metadata as authority. |
| 7. CPU/DB/email/latency/operations/cost decision | Qualitative comparison plus #490 measurements above; replacement measurements deferred. No benefit proved, so no migration units are approved or scheduled. |

### Constraints on any separately authorized future experiment

Use a disposable local Postgres clone with synthetic accounts only, no hosted
configuration or real users/email. Preserve imported UUIDs; create **new** session
UUIDs for Better Auth login. Legacy Supabase sessions do not transfer: require
fresh login to the experimental provider and never reuse their context IDs.
A future cutover would intentionally terminate legacy sessions, but none are
invalidated by this ADR. Never reset or modify a shared baseline database to test.

The preferred backend must validate the opaque session against live authoritative
session storage on each protected request. If an assertion/JWT enters that boundary,
verify signature with an allowed algorithm/key and exact issuer/audience, future
integer expiry and server-approved role. Construct `sub`, `session_id`, `exp`
server-side from verified identity/session records; SQL still determines organization
and entitlements. Use transaction-local claims and least-privilege facade execution;
never use service_role or a DB owner as a tenant identity, accept arbitrary SQL, or
leave claims on pooled connections. Prove transaction rollback and cross-request
pool isolation before considering this compatible. This design is not implemented.

Fixed context expiry must remain independent of sliding provider renewal. A revoked
provider session must also invalidate its context (including administrative revoke),
not just remove a cookie. Bypass cookie-data and query-result caches for all live
identity/authorization decisions; Hyperdrive is neither required nor approved here.
Expected denial boundary is the next authorization statement with a snapshot after
revocation commits, not retroactive cancellation of statements already running.
Pending requests/two-tab tests must record commit, statement-start and denial times,
isolation level and p50/p95/max delay; no zero-millisecond claim is justified yet.

Stopping a future experiment means disconnecting its local handler, invalidating its
synthetic sessions/contexts and retiring its disposable database without touching
baseline data. Restore by returning to unchanged Supabase entry points; rollback
must not resurrect revoked experimental or legacy sessions. Require a recorded
cleanup/recovery receipt. There is nothing to restore from this ADR: no experiment
state or spike code was created.

## Consequences

- Existing auth/session behavior and SQL facades remain unchanged. #425 can proceed
  independently without making a provider choice.
- We forgo unproven identity flexibility now and avoid new privileged adapter,
  membership synchronization, cookie/key and migration responsibilities.
- This ADR can complete the narrowed research deliverable, **not close the original
  executable parity criteria as passed**. Any such issue disposition belongs to the owner.
- No dependency installation, DB grant/RLS edits, auth/provider/framework migration,
  real-user export, billing/domain/traffic change, email send or hosted mutation occurred.

## What would change the decision

Reopen only with a concrete product capability unavailable under the current setup,
a documented operational requirement, or actual billed-MAU/cost evidence that can
fund the additional ownership. Require owner-approved thresholds and a version-pinned,
separately authorized local experiment passing every deferred matrix row via real
login/routes/RPCs, including measured revocation timing and recovery. Only if that
comparison wins should a later decision define independently verifiable migration
units and request explicit production authority. Until then, keep Supabase Auth.

## Verification

Documentation-only exception to RED/GREEN: no runnable behavior was added, removed
or changed, so manufacturing a failing auth test would not test this deliverable.
Validation consists of source/official-document inspection, relative-link checks,
AC coverage review and `git diff --check`; no app suite, DB script or hosted test
was executed. External documents establish capabilities, not local compatibility.
