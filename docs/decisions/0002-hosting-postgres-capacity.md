# 0002 — Keep Postgres and current hosting; defer Workers adoption

Status: Proposed — keep/defer outcome of the documentation-only spike for [#491](https://github.com/NicolasIppoliti/votus-plataforma-lla/issues/491).

Decision owner: Product owner. This ADR does not authorize a deployment or migration.

## Decision

**Keep the existing hosting arrangement, Supabase Auth/PostgREST/Postgres and the
Python ETL. Defer a Workers hosting change.** The exact current Next.js pin is
outside the inspected OpenNext peer range. There is no workerd request proof,
matched hosting latency comparison, or scoped billing export establishing a net
benefit. This is an incompatibility/evidence-gap result, not proof that Workers
is slower or that every adapter is incompatible.

Do not add Hyperdrive to the current HTTPS RPC path. Do not replace Postgres with
D1 or move ingestion into Workers. R2 is an optional future archive replica, not
an existing feature or a prerequisite for this decision. No production code,
dependencies, Auth provider, billing, domain, traffic, database or hosted settings
were changed. No prototype was created.

## Context

Issue #491 asks whether a hosting-only change improves the product's latency and
total cost while keeping framework, database, corpus and Auth constant. User
authority narrows this delivery to an ADR; framework/Auth investigations belong
to #493/#492 respectively. Numbers below are either attributed observations or
explicit hypothetical planning inputs, never inferred account bills.

### Baselines and representative journey

| Item | Evidence / boundary |
| --- | --- |
| Repository inspected | `b86591165a72aaf1a182a688aead49be6c289453`, branch `docs/491-adr`, clean working tree before this ADR; issue originally inspected `d3aba535e364d969fd501a8db04280049521de1c` |
| Application pins | Node `24.x`, pnpm `12.6.0`, Next `16.3.6`, React/React DOM `19.3.0`, Supabase SSR `0.12.7`, supabase-js `2.117.2` [R1] |
| Database | Local configuration says PG17; this does **not** verify hosted engine, compute, region or plan [R2] |
| Existing performance run | #490: instrumented `0dcd6a945b5ad74478c71c7250025fca51573d4e`, Node `v24.21.0`, local production Next server and local Supabase; not this SHA and not Workers [R3] |
| Data and permissions | #490 public official 2023 generales / 2025 legislativas, DIPUTADO NACIONAL, distrito `02`, sección `027`, synthetic authorized workspace. Its local helper grants/policies persist; do not assume a pristine production-permission equivalent [R3] |
| Hardware / region / network | #490 summary does not identify CPU/RAM, browser version, network profile or geographic region: **unknown**. Local topology is not a hosted regional comparison. ETL's separately measured host is Apple Silicon arm64 / 16 GiB, not evidence of #490 hardware [R7] |
| Journey to preserve | `/login` → verified cookie → workspace bootstrap/organization selection → `/drilldown` scoped to the corpus above → official result and visible provenance. Add `/municipal` to exercise the hash-pinned section asset. Layout, middleware, RPC and geometry paths are real production callers [R4–R6] |

A future matched comparison must freeze one SHA, runtime/pins, SQL migrations,
corpus hash, permission/grant ledger, PG instance/region and Auth configuration.
Record client and server hardware, browser, timezone, network shaping/RTT,
placement and concurrency. Run both hosts against the **same** backend; never
attribute a SQL, corpus, region or framework change to hosting. None of this ADR
constitutes a new end-to-end run or a verified provenance-rendering receipt.

## Options

| Option | Benefit | Cost / risk | Disposition |
| --- | --- | --- | --- |
| Keep current host + Supabase PG/Auth/PostgREST | No migration; preserves RLS, claims, ingestion and rollback behavior | Existing latency remains; current hosting bill unknown | **Keep** |
| Next → OpenNext → Workers, same Supabase HTTPS APIs | Potential different hosting economics/placement | Current pin rejected by published peer range; cookies, filesystem packaging, SSR and placement unproved | **Defer**, bounded next unit below |
| vinext → Workers | Alternative Workers application runtime | Framework implementation changes the experiment; package availability is not this app's compatibility proof | Out of this hosting-only experiment; refer #493 |
| Workers + Hyperdrive + PG | SQL connection pooling; optional query cache | Does not accelerate existing PostgREST HTTPS calls automatically; new SQL/claims boundary and testing burden | Not needed for hosting-only candidate |
| D1 application database | Potential small SQLite read-model locality | Rewrites PG authorization/functions/ETL; unknown SQLite footprint and benefit | Reject as replacement; bounded read-model research only if justified |
| R2 archive replica | Durable object distribution with separately priced storage/operations | Added upload/verification/recovery operations; not filesystem equivalence | Defer |

## Evidence

Research retrieved **2026-10-15**. Official documentation is capability evidence,
not a deployed benchmark. Cloudflare documentation pages returned HTTP 403 from
this environment; citations [S2–S8] use the publisher's public documentation source
instead. The attempted OpenNext tagged `validate-config.ts` URL returned 404;
use published package metadata [S1], not that missing source, for the pin gate.

### Exact-version compatibility gate

| Route / component | Exact version evidence | Result |
| --- | --- | --- |
| Next `16.3.6` → `@opennextjs/cloudflare@1.20.11` | Peer `next: >=15.5.27 <16 || >=16.3.8`; `wrangler: ^4.148.0`, `rclone.js: ^0.6.6` [S1] | **Excluded**; minimum proposed Next change within 16.x is `16.3.8`, requiring coordinated eslint-config-next/lockfile and regression verification in a separately authorized unit |
| Same Next → OpenNext `1.20.12` (registry latest at retrieval) | Peer `next: >=15.5.28 <16 || >=16.4.1`; same Wrangler/rclone ranges [S1] | Also excluded; minimum proposed 16.x pin is `16.4.1`, not `16.3.8` |
| OpenNext overview | Broadly says Next 16 supported; Node Middleware introduced in 15.2 not supported [S9] | General docs do not override exact package peers. Audit middleware runtime before attempting build; do not assert current middleware is Node middleware merely because it imports an SDK |
| vinext `1.2.0` (registry latest) | Node `>=22`, Vite `^8.0.0`, React `^19.2.6`, RSC/plugin peers [S10] | Metadata only. Whether called beta or stable, no application parity, cookie or workerd proof here; would change framework implementation |

No adapter was installed, framework pin changed, build attempted or workerd
server started. A peer mismatch is not an observed build failure. A trivial
Worker echo endpoint would not prove the real authenticated Next request.
The version gate is sufficient to defer, without manufacturing a substitute
framework experiment. The proposed pins above are prerequisites, not approvals.

### Request/runtime proof ledger

| Contract | Repository evidence | workerd result |
| --- | --- | --- |
| Cookie refresh and gate | Middleware `getUser()` reads request cookies and copies refreshed cookies to response; layout independently calls `getUser()`; RSC uses async `cookies()` [R4] | Not run |
| Workspace, claims, RPC | UUID/session/expiry checks before `workspace_api`; bootstrap/current workspace and result/provenance RPCs [R5] | Not run; network reachability and denial parity unknown |
| Bundled archive/hash | #489 is present: small `data/geography/cne-rosales-section.d21df6a0ca949d64fbe4a4aa83c6d88695333be06d38321de00c1241bfd7a351.json`, read via `node:fs/promises` at `process.cwd()`; hash + schema validation, missing/corrupt → `withheld` [R6] | Not run; Node compatibility does not prove adapter includes the file or preserves path semantics |
| Asset source provenance | Verified derivative displays original source digest/timestamp, not derivative digest as if it were original [R6] | Not run; require valid, missing, corrupted bytes and rendered fallback cases |
| Routes and auth failures | Real layout gate, `/api/session` 401 versus 503 handling, login allowlist [R4] | Not run; test callback/refresh, expired/revoked session, organization switch/revocation, scoped denial, deep-link and unavailable backend |

The issue's old full-CNE runtime-read concern is **superseded in this checkout**
by #489's derivative. The original immutable ETL archive still lives on local
filesystem [R8]. Do not assume that archive is bundled or replaced by R2.

Rollback design, **not executed**: retain the known-good Node artifact and its
hosting configuration, no schema/Auth migration, and route back to that origin
through the existing same-domain hosting mechanism if a later rollout is
approved. Preserve cookie names/security attributes and callback URLs. Prove
same-domain session continuity in staging before rollout. Current routing owner,
mechanism, TTL and restoration time are unknown, so there is no approved
operational rollback runbook yet; this ADR does not authorize DNS/traffic changes.

### Latency and capacity

#490 reports 80 successful samples, zero classified errors: 10 cold-process and
10 warm document requests for `/`, `/drilldown`, `/compare`, plus 10 Next Link
navigations for each of drilldown/compare. Cold means fresh process, **not** cold
OS/DB cache. Medians are arithmetic; p95 nearest-rank [R3]. Selected values (ms):

| Entry | Cold TTFB p50 / p95 | Warm TTFB p50 / p95 | Warm instrumented envelope p50 / p95 |
| --- | ---: | ---: | ---: |
| `/` | 139.50 / 147.32 | 101.67 / 106.34 | 2937.40 / 5221.86 |
| `/drilldown` | 149.44 / 162.55 | 99.87 / 106.34 | 1841.63 / 1877.97 |
| `/compare` | 148.47 / 161.58 | 95.52 / 107.75 | 7381.58 / 7570.43 |

Drilldown navigation click-to-main/response completion p50/p95 is
1786.67/1841.63; compare 1891.34/1936.55. **Not** hydrated filter-to-result or LCP.
Observed RPC counts per document: home 13, drilldown 11, compare 16, plus two
getUser calls each; SDK spans include transport and are not SQL-only timings or
necessarily distinct TCP connections. Drilldown facets take ~1.67 s and compare
has seven facet calls/document: investigate this before claiming edge-hosting
wins. Streaming TTFB is not completed evidence latency.

| Required comparison metric | Node baseline available | Workers local / deployed |
| --- | --- | --- |
| Cold/warm TTFB, dispersion, errors, SDK call counts | Above / full #490 receipt | n=0 / n=0, unknown |
| LCP, hydrated filter → evidence, CPU, peak memory, artifact compressed/uncompressed sizes | Unknown in #490 summary | n=0 / n=0, unknown |

No relative speedup, error-rate parity or bundle-fit claim follows. A later
experiment should collect at least 30 samples per cold/warm bucket on each
host, publish raw redacted receipts, p50/p95/range, errors and complete evidence
assertions; distinguish local workerd from deployed measurements. Count RPCs,
Auth calls, bytes and actual round trips separately; measure server CPU/memory
and browser LCP/filter-to-render rather than substituting response start.
Hosted samples remain outside this authorization.

Workers documents 128 MB per isolate, shared by concurrent requests, not per
request [S2]. The measured ETL used 2,789,703,680 B peak RSS and ~6.12 GB peak
footprint, 3994.76 s first load / 6597.38 s reload, PG size 8,338,803,859 B /
14,115,171,475 B after reload [R7]. **Keep a direct-Postgres Python runner**;
hosting does not speed ingestion. For planning, use a separately priced Linux
runner with at least 8 GiB RAM initially, enough disk for reload/WAL/temp plus
archive and a free-space guard; validate on target hardware. This is a sizing
hypothesis, not a measured minimum or permission to provision #322's runner.

### Postgres, PostgREST, Hyperdrive and D1 boundaries

- Keep PG schemas, RLS/GRANT/roles, security-definer functions, claims and
  transaction semantics. Supabase client `.schema("workspace_api").rpc(...)`
  uses PostgREST HTTPS, not PostgreSQL wire protocol [R5, S11]. Moving its caller
  to Workers does not insert Hyperdrive into that path.
- Hyperdrive would require a SQL driver and PG wire connection, with explicit
  verified-claims propagation and transaction-local role/session state; that is
  a distinct security-sensitive transport change, not free hosting acceleration.
  Auth/session/permissions and claims-dependent RPC SQL must use a **cache-disabled**
  binding if ever introduced. Do not rely on volatility inference for safety;
  query caching is on by default and writes do not invalidate it [S3].
- Hyperdrive lists advisory locks as unsupported without a documented xact-lock
  exception [S4]. `pg_advisory_xact_lock(hashtextextended(...))` and repeatable-read
  ingestion remain on direct PG [R8]. Included Hyperdrive pricing does not include
  the origin database [S5].
- D1 uses SQLite semantics, not PG authorization. Concrete incompatible inventory
  includes schemas/role ownership, GRANT/REVOKE, FORCE RLS/policies, PL/pgSQL DO
  blocks, SECURITY DEFINER/search_path, UUID defaults, timestamptz/jsonb functions,
  PG advisory locks and PostgREST's claims-aware RPC boundary [R8, R9]. Even where
  SQLite has JSON/UUID equivalents they do not preserve these security contracts.
- D1's paid per-database hard cap is 10 GB; execution is single-threaded per DB
  [S6]. **SQLite size is unknown**, not 8.34/14.12 GB: PG indexes and dead tuples
  are not SQLite bytes. No import, SQLite conversion or throughput test ran.
- A bounded alternative would export a reproducible **public official-only**
  read-model, version/hash it, bulk-load off the request path, measure actual
  SQLite bytes/indexes and query latency, then atomically select its version.
  D1 bulk changes must be chunked within execution limits; measure batch sizing
  and reconciliation before publication [S6]. Partition only on measured
  size/concurrency need (election/territory), keeping
  full mesa lineage and explicit cross-partition aggregation; do not assume
  cross-DB transactions. Keep authorization/claims in PG and never mix fiscal
  data. Export validation, backfill, partition fanout, stale-version handling and
  operational effort must beat PG before proposing a rewrite. None is approved.

### TCO: actual ledger versus hypothetical scenarios

**Actual current monthly spend is unknown in every category.** No scoped invoices,
plan/usage exports, resource inventory or engineering time ledger were supplied.
Source code is evidence of capability, not deployment or expenditure. In
particular, a local PG17 config and public Supabase pricing do not establish the
user's current subscription. Do not read credentials or account billing to fill
this gap without a separately scoped export.

| Component | Current observed cost | Keep / candidate effect |
| --- | --- | --- |
| Frontend hosting/builds/logs/egress | Unknown | Only hosting is potentially displaced; builds/observability need explicit inventory |
| PG compute, disk, IOPS, backups, egress | All unknown | Retained on both sides; origin egress still payable even if Workers egress is free |
| Auth and transactional email | Unknown | Retained; public Auth entitlement does not establish SMTP volume/cost |
| Python ETL compute/temp/archive/operations | Unknown | Retained, dimensioned separately; no Worker replacement |
| R2 storage/A/B operations | Unknown whether used elsewhere; no upload path here | Optional added capacity, not credited as existing savings |
| Migration and recurring operation | Unknown | Candidate adds compatibility, deployment, rollback and verification work |

Public planning rates [S5, S7, S8, S12]: Workers Paid $5/month includes 10M
requests and 30M CPU-ms; excess $0.30/M requests, $0.02/M CPU-ms. Hyperdrive is
included; PG is not. R2 Standard $0.015/GB-month beyond 10 GB, $4.50/M A beyond
1M and $0.36/M B beyond 10M, no Internet egress charge; apply documented rounding.
Supabase Pro starts at $25/month with compute credit/inclusions; disk 8 GB included,
then $0.125/GB, 3000 IOPS included then $0.024/IOPS; PITR starts at $100/month.
These are reference tariffs, not a quote or the current bill.

Three **hypothetical USD/month** budgets below deliberately price every requested
component. PG compute is modeled as an all-in base, not added again to Pro;
backups are incremental beyond base retention. Inputs are assumptions, not
traffic forecasts. No taxes, discounts or currency conversion. ETL costs include
runner, temporary/archive storage; human operation is separate. R2 is optional
extra replication in the medium/large cases, not replacing local archive cost.

| Assumed input / calculated charge | Small | Medium | Large |
| --- | ---: | ---: | ---: |
| Dynamic requests/month; average CPU-ms/request | 0.1M; 10 | 10M; 10 | 100M; 20 |
| Assumed displaced frontend hosting H | 20 | 100 | 500 |
| Workers W = 5 + .30×max(0,requestsM−10) + .02×max(0,CPUmsM−30) | 5.00 | 6.40 | 71.40 |
| PG compute/base assumption | 25 | 100 | 500 |
| Provisioned PG disk GB; incremental disk at reference rate | 25; 2.125 | 100; 11.50 | 500; 61.50 |
| PG incremental IOPS / backups / egress assumptions | 0 / 0 / 0 | 0 / 100 / 10 | 48 / 100 / 100 |
| ETL runner/storage assumption | 10 | 40 | 200 |
| Email assumption | 0 | 10 | 50 |
| Added R2 GB; A ops M; B ops M | 0; 0; 0 | 100; 1; 10 | 1000; 2; 100 |
| Calculated incremental R2 R | 0 | 1.35 | 51.75 |
| Keep recurring human operation assumption | 50 | 100 | 200 |
| Candidate recurring human operation assumption | 75 | 150 | 300 |
| Keep total | **107.13** | **471.50** | **1759.50** |
| Candidate total (replace H with W, add R and operation difference) | **117.13** | **429.25** | **1482.65** |
| Net recurring saving S | **−10.00** | **42.25** | **276.85** |

Example engineering budget: 40 hours × $50/hour = **$2000 one-time**, not an
estimate derived from time tracking. With retained components held equal,
`S = H − W − R − (candidateOps − keepOps)`; break-even months `2000/S` only
when S > 0. Small never breaks even; medium ~47.34 months; large ~7.22 months.
For 12-month recovery require `H > W + R + deltaOps + 2000/12`:
$196.67 / $224.42 / $389.82 respectively. Common PG/ETL costs cancel from this
**comparison**, not from total product cost. Account-shared quotas, new build or
logging charges, duplicate hosting during rollback and engineering overruns can
erase the savings. Actual break-even remains **unknown** until scoped exports
and measured usage replace the assumptions.

## Consequences

- No immediate operational or billing risk and no unproved savings promised.
  The present latency and cost uncertainties remain; keep is not a claim the
  current host is optimal or known to have enough production PG capacity.
- Postgres capacity planning must include reload bloat, WAL, backup retention,
  free disk and ETL temporary extraction, not only the first-load size. The
  historical run is one source/corpus, not a guarantee for all elections.
- Framework-version compatibility blocks the tested hosting-only premise today.
  Workers documentation and vinext package availability cannot close that gap.
- #490's measured facet path is a stronger bounded performance investigation
  target than an unsupported promise of hosting acceleration.

## What would change the decision

The **next concrete unit** is an owner-approved, isolated compatibility receipt:
choose `Next 16.3.8 + OpenNext 1.20.11` (or separately assess the newer pair),
record exact transitive lockfile/runtime/compatibility flags, keep all candidate
files under `spikes/491/`, and exercise the real cookie → workspace → RPC →
result/provenance journey plus verified derivative/fallback in workerd. Do not
force peer resolution or change the production pins for this receipt. A copied
app build requires explicitly scoped generated-output/dependency authorization;
none is granted by this ADR. Hosted testing needs separate approval.

Reconsider adoption only after that receipt passes the security/asset matrix,
a matched Node/workerd and separately authorized deployed comparison measures
LCP/filter-result as well as TTFB, and exported bills plus measured usage show
positive **net** savings/payback acceptable to the owner. Obtain a same-domain
rollback rehearsal and capacity/backup/restore plan. Better adapter support
without a framework pin change could remove the current gate; a failed
compatibility check or absent net benefit is a valid final keep outcome.

### Acceptance-criteria disposition

| #491 criterion | Coverage and honest disposition |
| --- | --- |
| 1. Frozen baseline and representative login/workspace/result/provenance route | Baselines/pins/corpus/permissions recorded above. Hardware/region/network unknown; no matched new run. **Partial evidence**, not a completed benchmark |
| 2. Exact adapter/version matrix | Published exact peer ranges exclude 16.3.6; minimum proposed upgrade recorded before any spike. **Documented incompatibility outcome**; vinext not treated as proof |
| 3. Real workerd request/cookies/RPC/archive/fallback and rollback | Contract ledger and rollback constraints recorded. **Not executed** after version gate; no hosted mutation authorized. Runtime proof remains a follow-up, not claimed satisfied |
| 4. Comparable cold/warm latency/capacity/round trips/errors/artifacts | #490 n/dispersion/definitions cited; absent metrics and Workers n=0 explicit. **No comparative performance conclusion**; deployed collection outside current authority |
| 5. Current cost inventory, three scenarios and break-even | Actuals unknown; complete component ledger, explicit hypothetical calculations and engineering/payback model above. **Scenario analysis delivered**, not actual-account savings |
| 6. PG/PostgREST/Hyperdrive/cache/ETL split | Keep PG, HTTPS RPC unchanged, cache-disabled claims path if ever added, direct locks and separately sized ETL runner. **Addressed** |
| 7. D1 incompatibilities/limits/SQLite size/load/partition model | Concrete SQL/security inventory; 10 GB cap, single-thread; measured SQLite size **unknown**; read-model strategy bounded without approved rewrite. **Addressed as evaluation, not implementation** |
| 8. ADR keep/change/defer, components and next unit, no mutations | **Delivered keep/defer**, component costs/benefits and gated next unit. No deploy/billing/domain/production mutation |

The issue's empirical runtime/performance criteria are not checked off by this
ADR. Documentation-only delivery is complete; full compatibility/TCO proof is
not. This distinction should survive any issue-closing decision.

## Sources

### Repository evidence

Paths refer to baseline `b86591165a72aaf1a182a688aead49be6c289453` unless noted.

- **R1**: [`apps/web/package.json`](../../apps/web/package.json).
- **R2**: [`supabase/config.toml`](../../supabase/config.toml), `db.major_version`.
- **R3**: #490 [page-waterfalls report](../research/page-waterfalls.md), read
  **read-only from sibling worktree** `/Users/nicolasmateoippoliti/dev/votus-plataforma-lla-worktrees/490/docs/research/page-waterfalls.md`.
  The relative link becomes available when #490 lands; it is not present on this
  baseline. Report references `page-waterfalls-490-baseline.json`; raw JSON was
  not independently reanalyzed here. Measurements above are attributed to report.
- **R4**: [`middleware.ts`](../../apps/web/src/middleware.ts),
  [`authenticated layout`](../../apps/web/src/app/(authenticated)/layout.tsx),
  [`server-client.ts`](../../apps/web/src/lib/supabase/server-client.ts).
- **R5**: [`workspace/context.ts`](../../apps/web/src/lib/workspace/context.ts).
- **R6**: [`municipal-section-geometry.ts`](../../apps/web/src/lib/workspace/municipal-section-geometry.ts).
- **R7**: [`paso-scale-evidence.md`](../research/paso-scale-evidence.md), historical
  `e4a6c67` / 2026-10-10 local measurements, not rerun here.
- **R8**: [`circuit_membership.py`](../../etl/etl/circuit_membership.py) `run`,
  [`archive.py`](../../etl/etl/archive.py).
- **R9**: [`organization_workspace_authorization_facts.sql`](../../supabase/migrations/20260825165116_organization_workspace_authorization_facts.sql).

### Primary external evidence (retrieved 2026-10-15)

- **S1**: Published npm metadata: [OpenNext 1.20.11](https://registry.npmjs.org/@opennextjs/cloudflare/1.20.11),
  [1.20.12](https://registry.npmjs.org/@opennextjs/cloudflare/1.20.12).
- **S2**: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
  [retrieved official source](https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/workers/platform/limits.mdx).
- **S3**: [Hyperdrive query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/),
  [retrieved official source](https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/hyperdrive/concepts/query-caching.mdx).
- **S4**: [Hyperdrive unsupported PG features](https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/#unsupported-postgresql-features),
  [retrieved official source](https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/hyperdrive/reference/supported-databases-and-features.mdx).
- **S5**: [Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/),
  [retrieved official source](https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/hyperdrive/platform/pricing.mdx).
- **S6**: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
  [retrieved official source](https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/d1/platform/limits.mdx);
  [D1 FAQ limits partial (single-threading and loading)](https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/partials/d1/faq-limits.mdx).
- **S7**: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
  [retrieved official source](https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/workers/platform/pricing.mdx).
- **S8**: [R2 pricing](https://developers.cloudflare.com/r2/pricing/),
  [retrieved official source](https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/r2/pricing.mdx).
- **S9**: [OpenNext Cloudflare overview](https://opennext.js.org/cloudflare).
- **S10**: [vinext published metadata](https://registry.npmjs.org/vinext/1.2.0).
- **S11**: [Supabase RPC reference](https://supabase.com/docs/reference/javascript/rpc),
  [PostgREST functions](https://docs.postgrest.org/en/stable/references/api/functions.html)
  (HTTP 403 here; RPC behavior corroborated by retrieved Supabase reference and R5).
- **S12**: [Supabase public pricing](https://supabase.com/pricing).
