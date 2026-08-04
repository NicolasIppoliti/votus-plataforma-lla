# Design: Electoral Analysis Platform (Votus)

> Phase: `sdd-design` · Change: `electoral-analysis-platform`
> Inputs: `proposal.md`, `specs/*/spec.md`, `exploration.md`, `SESSION-HANDOFF.md`

## Technical Approach

Proposal Approach 3 (hybrid), bound to a two-runtime monorepo:

1. **Python 3.12 + uv ETL** (`etl/`) — port of `lla-coronel-rosales`'s
   `archive.py` / `manifest.py` / `http_client.py` / `storage.py` for an immutable,
   sha256-tracked raw archive, plus a NEW transform layer that loads Supabase Postgres.
2. **Supabase Postgres** (`supabase/migrations/`) — the normalized, rebuildable projection.
   Auth + RLS provide the single authenticated role; no anonymous path.
3. **Next.js App Router + TypeScript on Vercel** (`apps/web/`) — operator UI and the pure
   D'Hondt domain module.

Work item **0 is the SPIKE** (`spikes/001-granularity-and-join-keys.md`): nothing below it is
designed further until it returns a written verdict. It MUST (a) unzip real 2023/2025 national
ZIPs and dump column headers; (b) diff 2023 vs 2025 schemas (BUP drift); (c) cross-reference the
national distrito code for Coronel Rosales against PBA `027` and diff mesa/circuito codes across
years; (d) probe `resultados-electorales.argentina.apidocs.ar` and any per-mesa escrutinio
definitivo export before conceding distrito-level PBA data; (e) read
`www.juntaelectoral.gba.gov.ar/robots.txt` and its terms of use — **re-verified and corrected, see
D10: no robots.txt exists (404), the host serves normally, and the remaining gate is a product-owner
policy call, not a technical deny**; (f) archive the Wayback 2023 PASO ZIP locally (timeout 180 s);
(g) read PBA Ley 5109 / Ley Orgánica de las Municipalidades to resolve the concejal piso;
(h) derive the local ↔ DINE mesa mapping empirically from the fiscalización CSV (see D9.5).
No join strategy, shared parser, or PBA fetcher is locked before the verdict.

## Architecture Decisions

### D1 — Stack

| Option | Tradeoff | Decision |
|---|---|---|
| All-TypeScript monorepo | One language, one runner; but re-writes a proven archive layer and gives weaker bulk-CSV tooling | Rejected |
| Python ETL + versioned JSON in git (sibling pattern) | Zero infra; but ~10^5 mesa rows bloat git and give no ad-hoc query or auth | Rejected |
| **Python/uv ETL → Supabase Postgres → Next.js/Vercel** | Two runtimes and two test runners; ~80 % archive reuse, relational mesa joins, Auth/RLS satisfies `access-control` | **Chosen** |

### D2 — Archive is filesystem + manifest, not the database

Raw bytes live under `archive/<capability>/<file>` (gitignored, ~130 MB); `archive-manifest.json`
IS committed. Postgres stores only `archive_entry` rows referencing manifest ids. Re-fetch appends
a dated entry (`{id}@{date}`), never overwrites — satisfies `source-archive` immutability.
Rejected: bytea-in-Postgres (cost, no byte-level audit outside the DB).

> **D3, D4 and D5 were REVISED after the statutes were read.** The original three assumed D'Hondt
> at every level. That is wrong: Ley 5109 Arts. 109–110 govern PBA provincial legislators AND
> municipal concejales with a **Hare quota + largest remainder**, and only national diputados use
> D'Hondt (Ley 19.945 Art. 161). Product decision #3 was rewritten accordingly and is FINAL. The
> text below replaces the earlier versions; D1, D2 and D6–D9 are unaffected.

### D3 — Two statutory algorithms in one pure TS module, selected by level

`apps/web/src/domain/seat-allocation/` — `hare-quota.ts` (Ley 5109 Arts. 109–110), `dhondt.ts`
(Ley 19.945 Art. 161), `types.ts`, and `allocate.ts` as the **only public entry point**. No I/O,
table-driven tests. Rejected: a Postgres function or Python service (round trips, harder property
tests); also rejected: one parameterised algorithm with a `method` flag.

The spec requires that applying the national method to a PBA allocation be *impossible*, so this
lives in the type surface, not in prose: `AllocationInput` is a **discriminated union on `level`**,
the two algorithm functions are module-private, and neither input variant carries the other's
parameters (`HareInput` has no `threshold` field at all; `DhondtInput` has no `cuociente`).
Selecting D'Hondt for a PBA run is therefore a compile error, and — because the same shape is a
Zod 4 `z.discriminatedUnion` over `z.strictObject` variants — a runtime rejection at the web
boundary. Cost: allocation logic exists only in TS. Accepted; the ETL never allocates seats.

### D4 — Tie-breaking is statutory for PBA and a declared convention only for national

The earlier single rule labelled every tie-break "a simulation convention because the statute uses
sorteo". That is true for national and **false for PBA**. Split by level:

| Case | Rule | Status |
|---|---|---|
| PBA, equal remainders in the largest-remainder step | Seat to the list with the higher raw vote total | **Statutory** — Ley 5109 Art. 109(c). MUST NOT be labelled a convention in output or docs |
| PBA, more lists reach the cuociente than there are seats | Seats to the highest-voted qualifying lists | **Statutory** — Art. 110 |
| PBA, remainder AND raw votes both identical | Lower list id | Simulation convention — the statute does not address this case |
| National, equal quotients, different vote totals | Order by raw vote total | **Statutory** — Ley 19.945 Art. 161(c) first clause |
| National, equal quotients AND equal vote totals | Lower list id | **Simulation convention** — Art. 161(c) ends in *sorteo*, which the system does not perform; MUST be labelled as such |

Every result carries `tieBreak: { rule, basis: 'statutory' | 'simulation_convention', citation }`.
The UI renders the citation for statutory rules and an explicit convention warning otherwise. The
blanket "a real tie would be settled by lot" copy is removed — it was only ever true nationally.

### D5 — The percentage threshold exists only on the national path

| Level | Qualifying bar | Parameter |
|---|---|---|
| PBA municipal / provincial | The derived `cuociente electoral` (valid votes ÷ seats, halved per Art. 110 while under-subscribed) | **None.** Ley 5109 has no fixed-percentage piso |
| National diputados | 3 % of the **padrón electoral del distrito** (Ley 19.945 Art. 160, per Ley 24.444) | `threshold: { value, basis: 'padron' }`, configurable per run, plus a required `padron` figure |

The original `{ value, basis: 'valid_votes' \| 'padron' }` shape fitted the national rule and did
not model PBA at all. A PBA run MUST **reject** a percentage-threshold input rather than ignore it
— enforced structurally by D3's union (the field does not exist on `HareInput`, and the strict Zod
variant rejects the unknown key) rather than by a runtime `if`. `basis` is retained on the national
variant because a padrón-based bar and a valid-votes-based bar are not interchangeable, and the
figure MUST be reported as a percentage of the padrón.

The cuociente denominator is **valid votes** — total minus blank minus annulled (Art. 109 final
paragraph) — recorded separately from the total vote count, never approximated from it.

### D6 — Open item C: mixed granularity requires explicit operator choice

Default = **refuse**. A comparison spanning two granularity levels returns
`status: 'requires_explicit_aggregation'` with no figures. The operator must re-request with
`aggregate_to: 'distrito'`; the response then carries `granularity: 'distrito'` and
`aggregated_from: 'mesa'`, and the UI renders both. Auto-aggregate-and-label was rejected: the
proposal's Risk 8 is precisely an operator misreading an aggregate as a mesa figure.

### D7 — Open item D: one review queue is the surfacing mechanism

Table `review_item(kind, severity, subject_ref, detected_at, resolved_at, note)` with
`kind ∈ {content_drift, fetch_failure, unmapped_party, unmapped_jurisdiction, mesa_discontinuity}`.
Every ingestion run writes to it; the authenticated layout renders an unresolved-count banner
linking to `/review`. Logs are secondary, never the mechanism. **Granularity degradation is NOT a
queue item** — it is a first-class column on every result row and response, rendered as a badge.

### D8 — Ingestion is idempotent by (archive_entry, natural key)

Load runs in one transaction per archive entry: delete-by-`archive_entry_id`, then bulk insert.
Rebuild = truncate + replay. Satisfies `electoral-ingestion` idempotency and rebuildability.

### D9 — Internal fiscalización as a distinct source class

New evidence: `Carga de Datos de Fiscalización — LLA — Elecciones 2025 — Mesas Procesadas.csv`
(user-supplied, outside the repo). Confirmed by the user to cover the **26 Oct 2025 national
legislative** election, so its official counterpart is `elecciones_legislativas_2025.zip`, which
already has mesa-level granularity. No existing ADR is wrong; D2 and D7 are **extended** below.

**Correction to the recorded analysis (Engram #1389).** Reading the file directly shows the 6
rows with an empty `Mesa` (sheet lines 23, 33, 35, 54, 63, 69) are **not** independent records:
each is a wrapped continuation of the row immediately above it, carrying exactly the trailing
columns that row left empty (e.g. line 22 = Mesa 13 with `Potencia..Impugnado` blank; line 23 =
only those six values). Quarantining them as orphans would silently destroy real votes. The
ingestion rule is therefore **merge-then-validate**, not drop or quarantine-on-sight.

**9.1 Source class and trust.** `source_kind ∈ {official, fiscalizacion}` on `archive_entry` and
on every `result_row`. Fiscalización rows land in the same `result_row` table but are excluded by
default from every query — the repository applies `source_kind = 'official'` unless the caller
passes an explicit opt-in, mirroring D6. A fiscalización figure carries
`sourceKind: 'fiscalizacion'` and the UI renders a distinct "party-internal, unofficial, partial"
badge next to the existing granularity badge. Fiscalización MUST NOT be substituted for a missing
official figure, and MUST NOT be aggregated together with official rows in one figure.

**9.2 Coverage and bias are first-class.** Every fiscalización aggregate carries a `Coverage`
value (observed units, denominator, basis) and is refused without it. Measured: 93 unique mesas.
The denominator was hedged as `≥152` here until SPIKE (a) **resolved it to 153** by counting
distinct `mesa_id` for `distrito_id=02, seccion_id=027` in `localesDeVotacionyMesas.csv` and
`resultados2025.csv` — identical to the 2023 baseline. Coverage is therefore **93/153 ≈ 60,8 %**,
sourced rather than assumed. Coverage is structurally non-random: the covered set is exactly the mesas where
LLA had a fiscal present. `Coverage.isRandomSample` is the literal type `false`, so no code path
can assert otherwise. Any district-level projection from this source returns
`requires_explicit_unofficial_opt_in` and the UI states the bias direction. This is why the
60,58 % LLA figure here must never be rendered beside the 29,31 % 2023 municipal figure without
both badges: different election, different universe, self-selected coverage.

**9.3 Personal data — strip at ingestion.** `Nombre`/`Apellido` are named party fiscales.
Decision: **strip before any load** — the names never reach Postgres; the loader keeps only
`source_row_index` for review-queue lineage. Rejected: an access-controlled isolated table
(retains an identifiable roster of real people for zero analytical gain, and this change already
bans personal data). The names are also unusable as keys: in the source sheet one individual
appears under three spellings of their given name and two of their surname (accent dropped, a
diminutive, and a truncated surname), and Mesa 15's two identical rows are credited to two
different fiscales. The specific names are deliberately NOT reproduced here — this document is a
committed artifact and the rule it states applies to itself. Consequence: fiscalización archive
entries stay in the local
mirror only, are never uploaded to any shared bucket, and any committed fixture is the stripped
form. `Escuela` is retained — it is an establecimiento label, not personal data.

**9.4 Ingestion contract for hand-maintained spreadsheets** (`etl/etl/ingest/fiscalizacion.py`),
in order:
1. **Merge** a row whose `Mesa` is empty into the preceding row when their non-empty columns are
   disjoint and the preceding row has empty trailing columns; otherwise quarantine it.
2. **Collapse** duplicate `Mesa` rows whose 17 vote values are identical (observed: mesas 13, 15,
   68, 85 ×3, 89) into one row, recording the collapse in the review queue.
3. **Quarantine, never drop** any residual duplicate whose vote values *differ* (a real conflict),
   any unmergeable empty-`Mesa` row, and any row with a blank vote cell — blank is missing, not
   zero (observed on `Impugnado`, sheet lines 28, 59–61).
4. **Normalize** `Escuela` for matching only (`N°`/`Nº`/`N °`, case, spacing); the raw string is
   preserved.
5. **Extend D2's drift rule**: for `source_kind = 'fiscalizacion'`, a changed sha256 on re-export
   is **expected drift**, recorded as `review_item(kind: source_reexported, severity: info)`. For
   `official`, a changed sha256 on a published archive stays a `content_drift` warning. Same
   append-only mechanics, different severity — the archive contract does not change.

**9.5 SPIKE evidence against Risk 1 (highest value).** The 93 mesas give a per-mesa 17-dimension
vote vector for the same election as the national ZIP, so SPIKE step **(h)** DERIVES the local ↔
DINE mesa mapping empirically instead of assuming it: (i) test the identity hypothesis (local
`N` == DINE mesa `N` within the Coronel Rosales distrito); (ii) independently, match each local
vector against every DINE mesa vector in that distrito. Vectors of ~17 counts near 100 are
effectively unique, so a match is strong evidence. **Success criterion: ≥ 90 % (≥ 84/93) exact
vector matches, injective, with zero conflicting assignments** → the join is evidenced and the
identity/offset rule is recorded in `curated/crosswalk.yaml` as verified. Fiscal tallies may
legitimately differ from the definitive escrutinio, so the SPIKE MUST also report the
best-match-distance distribution, not just the exact-match rate. **If matching fails**, that is
itself the Risk 1 answer: local numbering is independent of DINE, a hand-curated crosswalk becomes
a mandatory deliverable, and fiscalización is confined to establecimiento-level joins via
`Escuela` until curated.

**Outcome (SPIKE (h), recorded, criterion not retrofitted):** the literal criterion **FAILS** —
46/89 usable vectors match exactly (51,7 % < 90 %). Four further mesas were excluded because a
blank cell is missing, not zero, per D9.4 rule 3. The supplementary evidence is nonetheless strong
for identity: all 89 local numbers have exactly one same-numbered official counterpart, matching is
injective with zero conflicts, and for every local mesa the globally nearest official vector is
always the same-numbered one (0 exceptions). The gap is fiscal-tally-vs-definitive-escrutinio
divergence, ~48 % of mesas differing by small margins, not a numbering mismatch. Binding
consequence: `curated/crosswalk.yaml` is **not** seeded as verified; it records identity with an
explicit `confidence: same-id-only, not exact-value-verified` annotation, and fiscalización joins
default to `Escuela` level until a maintainer accepts identity for mesa-level use.

**9.6 Test fixture under strict TDD.** The stripped file is real Coronel Rosales data and serves
as a fixture for `electoral-ingestion` (merge, collapse, quarantine, blank-vs-zero, idempotent
re-ingest), `jurisdiction-model` (establecimiento ↔ mesa lineage, unmapped code handling),
`party-identity-mapping` (the 17 column labels → canonical parties, including 2025 LLA),
`results-analysis` (mesa-level swing/flip, fiscalización-class only) and `provenance-display`
(unofficial + coverage badges). It does **not** serve `seat-simulation` — that is the municipal
concejales category, a different election. Any committed fixture MUST be personal-data-stripped.

### D10 — `juntaelectoral.gba.gov.ar` is a policy gate, not a technical block

The Phase 0 SPIKE recorded gate (e) as **DENY** ("blanket 403 on every path tested, including
robots.txt") and removed Phase 5 from scope. Re-verification from the primary environment
**refutes** that. Measured:

| Request | Result |
|---|---|
| `https://www.juntaelectoral.gba.gov.ar/robots.txt` | **HTTP 404** (3970 b error page) — not 403 |
| `https://www.juntaelectoral.gba.gov.ar/` | **HTTP 200** (13028 b), identical with `curl/8` and a browser UA — not UA-gated |
| `https://www.juntaelectoral.gba.gov.ar/resultados-generales/2023027.pdf` | **HTTP 200**; ranged read confirms `%PDF` magic bytes — a real PDF |
| `https://www.juntaelectoral.gba.gov.ar/docs/LEY5109.pdf` | Fetched and parsed this session (531 KB) — the same host supplied the statute text behind D3–D5 |
| `https://juntaelectoral.gba.gov.ar` (apex, no `www`) | TLS failure, self-signed certificate — the likely partial cause of the SPIKE's failures |

**Corrected verdict**: there is no robots.txt at all, so there are no robots directives to violate,
and the host serves normally over HTTPS on the `www` name. The genuinely open part of the risk is
unchanged: no terms-of-use page was found, so bulk programmatic fetching has no *declared*
permission and remains closer to scraping than to an open-data download. That is a **policy call
for the product owner**, not a technical deny. **PBA-provincial 2025 ingestion returns to scope as
in-scope-pending-policy.**

Binding requirements for that fetcher, given no robots.txt and no declared terms — deliberately
stricter than for the DINE bulk hosts, because absence of permission is not permission:

1. **Host pinned to `www.juntaelectoral.gba.gov.ar` over HTTPS.** Certificate verification stays
   ON; the apex is never used and a TLS failure is a hard error, never bypassed with `-k`.
2. **Serial only.** Concurrency 1 for this host — no parallel workers, no connection fan-out.
3. **Rate limit ≥ 4 s between requests**, reusing `POLITENESS_DELAY_SECONDS` from the sibling's
   `archive.py` (the same value already applied to `mcr.gob.ar` after it returned 429).
4. **Identifying User-Agent** naming the project and a contact address, per the existing
   `DEFAULT_USER_AGENT` convention — never a spoofed browser UA.
5. **Cache and never re-fetch what the archive already holds**: a URL with a successful entry is
   re-fetched only on an explicit refresh, not on every run. The archive exists precisely so this
   host is hit once.
6. **Back off and stop, don't retry through it**: on 429/5xx honour `Retry-After`, cap at the
   existing 3 attempts, then record a `fetch_failure` review item and stop for that host this run.
7. **Bounded surface**: only the specific result paths registered in `sources.yaml` are fetched. No
   crawling, no link discovery, no directory enumeration.
8. **Re-check on each run**: if `robots.txt` ever starts returning 200, the fetcher MUST halt and
   surface it for a fresh policy decision rather than parsing and proceeding.

Rejected: keeping the DENY (it rested on an unreproduced network observation, and the same host
demonstrably served this session's statute PDF). Also rejected: shipping the fetcher without the
policy call (the etiquette above reduces impact but cannot manufacture permission).

## Data Flow

    sources.yaml ─→ http_client ─→ archive.py ─→ archive/ + archive-manifest.json
    (official)                          │ sha256, drift          ▲ source_kind
                                        │                        │
    fiscalización CSV ──────────────────┘   (local mirror only, never a shared bucket)
                                        │
                    ingest/<parser>.py ─→ curated/{party_map,crosswalk}.yaml (join + map)
                        │  fiscalización only: merge → collapse → strip names → quarantine
                        ┌───────────────┴───────────────┐
                        ▼                               ▼
              Supabase Postgres (RLS)            review_item queue
              result_row.source_kind                    │
                        │  default filter = official    │
                        ▼                               ▼
          Next.js RSC (server-only reads) ─→ UI: figure + granularity badge +
                        │                     unofficial/coverage badge + provenance
                        │                     link + disclaimer + banner
                        ▼
             domain/seat-allocation/dhondt.ts (pure)

Unmapped list id or unmapped jurisdiction code → row stored raw, marked unmapped, excluded from
canonical rollups, queued. Never guessed. Fiscalización rows are filtered out by default and
require an explicit opt-in to appear at all.

## File Changes

| File | Action | Description |
|---|---|---|
| `etl/pyproject.toml`, `etl/uv.lock` | Create | uv project, pytest runner (task 1) |
| `etl/etl/{archive,manifest,http_client,storage}.py` | Create | Ported from sibling, unmodified semantics |
| `etl/sources.yaml` | Create | 4 national entries seeded from sibling; PBA entries (host `www.juntaelectoral.gba.gov.ar`) only after the D10 policy call, carrying the serial/4 s/identifying-UA constraints; one `fiscalizacion` capability entry with `source_kind: fiscalizacion`, a local file path instead of a URL, and `upload: never` |
| `etl/etl/ingest/{national,pba}.py` | Create | Parsers; `national` shared only if SPIKE (b) proves schema parity |
| `etl/etl/ingest/fiscalizacion.py` | Create | Spreadsheet contract of D9.4: merge, collapse, strip names, quarantine |
| `etl/tests/fixtures/fiscalizacion-2025-stripped.csv` | Create | Real data, personal-data-stripped (D9.3/D9.6) |
| `etl/tests/**` | Create | pytest; scenario-per-test |
| `curated/party_map.yaml`, `curated/crosswalk.yaml` | Create | Human-curated, PR-reviewed, schema-validated |
| `supabase/migrations/*.sql` | Create | Every migration ships a down migration |
| `apps/web/src/domain/seat-allocation/{allocate,hare-quota,dhondt,types}.ts` | Create | `allocate.ts` is the only export; Hare quota (Ley 5109) and D'Hondt (Ley 19.945) are private, selected by level (D3) |
| `apps/web/src/app/(authenticated)/**` | Create | Comparison, drilldown, `/review`, simulation |
| `apps/web/src/components/{GranularityBadge,ProvenanceLink,SourceDisclaimer}.tsx` | Create | Spec-mandated UI affordances |
| `spikes/001-granularity-and-join-keys.md` | Create | SPIKE verdict, gates everything |

## Interfaces / Contracts

Const-object-first per the TypeScript convention; flat interfaces, no inline nesting.

```ts
const GRANULARITY = {
  MESA: 'mesa', ESTABLECIMIENTO: 'establecimiento', CIRCUITO: 'circuito',
  SECCION: 'seccion', DISTRITO: 'distrito',
} as const;
type Granularity = (typeof GRANULARITY)[keyof typeof GRANULARITY];

const SOURCE_KIND = { OFFICIAL: 'official', FISCALIZACION: 'fiscalizacion' } as const;
type SourceKind = (typeof SOURCE_KIND)[keyof typeof SOURCE_KIND];

interface SourceRef { archiveEntryId: string; sha256: string; url: string; fetchedAt: string }

interface Coverage {
  observedUnits: number;          // 93 mesas
  denominatorUnits: number | null; // null while the 2025 denominator is UNVERIFIED
  denominatorBasis: string;        // e.g. 'observed_max_local_mesa=152 (lower bound)'
  isRandomSample: false;           // literal false — never assertable as a sample
}

interface Figure<T> {
  value: T;
  granularity: Granularity;
  sourceKind: SourceKind;
  degradedFrom?: Granularity;   // set when the requested level was unavailable
  aggregatedFrom?: Granularity; // set only after explicit operator opt-in (D6)
  coverage?: Coverage;          // REQUIRED whenever sourceKind is 'fiscalizacion'
  sources: SourceRef[];
}

const ALLOCATION_LEVEL = {
  PBA_MUNICIPAL_CONCEJALES: 'pba_municipal_concejales',
  PBA_PROVINCIAL_LEGISLADORES: 'pba_provincial_legisladores',
  NATIONAL_DIPUTADOS: 'national_diputados',
} as const;
type AllocationLevel = (typeof ALLOCATION_LEVEL)[keyof typeof ALLOCATION_LEVEL];
type PbaLevel = Exclude<AllocationLevel, typeof ALLOCATION_LEVEL.NATIONAL_DIPUTADOS>;

interface ListVotes { listId: number; party: string; votes: number }

interface HareInput {              // Ley 5109 Arts. 109–110 — no threshold field exists here
  level: PbaLevel;
  seats: number;                   // seats up for renewal, not the full council
  validVotes: number;              // total MINUS blank MINUS annulled (Art. 109 final)
  totalVotes: number;              // reported alongside, never used as the denominator
  lists: ListVotes[];
}

interface PadronThreshold { value: number; basis: 'padron' }

interface DhondtInput {            // Ley 19.945 Arts. 160–161 — no cuociente exists here
  level: typeof ALLOCATION_LEVEL.NATIONAL_DIPUTADOS;
  seats: number;
  padron: number;
  threshold: PadronThreshold;
  lists: ListVotes[];
}

type AllocationInput = HareInput | DhondtInput;

// The ONLY public entry point. hare-quota.ts and dhondt.ts are module-private,
// so no caller can pair a level with the other level's method.
function allocateSeats(input: AllocationInput): AllocationResult;
```

`AllocationResult` is traceable per the spec: `cuociente` and each list's `remainder` plus every
`halvingIteration` for Hare runs, the full `quotients` table for D'Hondt runs, and per seat an
`awardedBy` rule tag (`cuociente_division` | `largest_remainder` | `halving` | `dhondt_quotient` |
`tie_break`) with the numbers that rule used. Tie-breaks carry
`{ rule, basis: 'statutory' | 'simulation_convention', citation }` per D4.

A response is a discriminated union on `status`:
`ok` | `requires_explicit_aggregation` (D6) | `requires_explicit_unofficial_opt_in` (D9.2), the
last two carrying no figures. Operator-supplied inputs that cross the web boundary — what-if vote
totals, `aggregate_to`, the unofficial opt-in and the whole `AllocationInput` — are validated with
Zod 4 schemas and the TS types are derived via `z.infer`, so the boundary has one source of truth.
`AllocationInput` specifically is a `z.discriminatedUnion('level', [hareSchema, dhondtSchema])`
over `z.strictObject` variants, so a payload that pairs a PBA level with a `threshold` key is
rejected as an unknown key rather than silently ignored (D5).

Core tables: `archive_entry(source_kind)`, `jurisdiction`, `jurisdiction_crosswalk`, `election`,
`category`, `list_identity`, `party_canonical`, `party_mapping`,
`result_row(granularity, source_kind, is_unmapped, archive_entry_id, source_row_index)`,
`review_item`. Every `result_row` carries `archive_entry_id` — provenance is a foreign key, not a
lookup. `review_item.kind` gains `source_reexported`, `duplicate_collapsed`,
`duplicate_conflict`, `unmergeable_row` and `blank_vote_cell` (extends D7). Index
`result_row (source_kind, election_id, jurisdiction_id)` so the default official-only filter is
index-served rather than a post-filter.

## Testing Strategy

`strict_tdd: true` — every Given/When/Then scenario becomes one failing test first. Task 1
establishes both runners before any production code.

| Layer | What | Approach |
|---|---|---|
| Unit (pytest) | archive immutability, sha256, drift, fetch failure, manifest upsert | Fake `Fetcher` (the sibling's `Protocol` seam), `tmp_path` store |
| Unit (pytest) | parsers, crosswalk resolution, unmapped handling, degradation flags | Small committed ZIP/CSV fixtures cut from real archived files |
| Unit (pytest) | fiscalización: wrapped-row merge, identical-duplicate collapse, conflicting-duplicate quarantine, blank ≠ zero, name stripping | Stripped real fixture; one test per D9.4 rule, plus an assertion that no loaded column contains a fiscal name |
| Unit (vitest) | `Coverage` required on every fiscalización figure; official/fiscalización never combined in one figure | Type-level + runtime; default repository filter asserted |
| Unit (vitest) | Hare quota: cuociente from valid votes only, below-cuociente lists get zero, largest-remainder top-up, Art. 110 halving loop, over-subscription, half-renewal | Table-driven; golden case = 2023 Coronel Rosales concejales reproducing 3/3/3/0 |
| Unit (vitest) | D'Hondt: quotient table, padrón-based threshold exclusion, traceability | Table-driven, national level only |
| Unit (vitest) | Level→method binding: a PBA input cannot reach D'Hondt and a national input cannot reach Hare | Type-level (`@ts-expect-error` on the illegal pairing) plus a runtime Zod rejection of a PBA payload carrying `threshold` |
| Unit (vitest) | Tie-break classification: PBA equal-remainder is reported `statutory` with its Art. 109(c) citation; the national equal-votes case is reported `simulation_convention` | One test per row of D4's table |
| Integration (pytest) | idempotent re-ingest, drop-and-rebuild equality | Ephemeral local Postgres |
| Integration (SQL) | RLS denies anonymous on every table | Anonymous-role assertion per table |
| E2E (Playwright) | unauthenticated redirect, granularity badge, disclaimer, mixed-granularity refusal, provenance drilldown, unofficial+coverage badge, unofficial opt-in refusal | Seeded fixture DB |

Seams: `Fetcher` protocol (network), `LocalArchiveStore` (filesystem), a `ResultsRepository`
interface in the web app (database), and the pure `dhondt` module (no seam needed).

## Threat Matrix

Canonical rows:

| Boundary | Applicability | Reason |
|---|---|---|
| Documentation-like paths | N/A | No file-type-driven execution; the system never executes archived content |
| Git repository selection | N/A | No VCS automation; curated data is edited by humans via ordinary PRs |
| Commit state | N/A | No programmatic commits |
| Push state | N/A | No programmatic pushes |
| PR commands | N/A | No PR automation |

Project-specific rows (added by this design, same contract — each MUST carry its RED tests into
`tasks.md` unchanged):

| Boundary | Adversarial cases | Applicability | Design response | Planned RED tests |
|---|---|---|---|---|
| Personal-data-bearing source ingestion | Fiscal name columns reaching Postgres, a committed fixture, an error message, a review-queue note, or a shared bucket | **Applicable** (D9.3) | Strip `Nombre`/`Apellido` before load; keep only `source_row_index`; local mirror only, never uploaded; committed fixtures stripped | One test asserting no loaded column or `review_item.note` contains a name; one asserting the committed fixture has no name columns; one asserting fiscalización entries are never handed to the remote uploader |
| Untrusted archive extraction | ZIP entries with absolute paths or `..` segments; decompression bombs | **Applicable** | Reject traversal entries; enforce an uncompressed-size cap; fail loudly | One test per traversal form; one size-cap test |
| Unofficial-source leakage into official figures | A default query, a cached/pre-rendered page, or an aggregate silently including fiscalización rows | **Applicable** (D9.1) | Repository filters `source_kind = 'official'` by default; opt-in is explicit and per-request | One test per path: default query, aggregate, and rendered page each exclude fiscalización without an opt-in |
| Fetching a host with no declared permission | Parallel fan-out, spoofed browser UA, retry storms, TLS bypass on the self-signed apex, crawling beyond registered paths | **Applicable** (D10) | Serial, ≥ 4 s delay, identifying UA, `www` host with verification on, registered paths only, archive-first, halt if `robots.txt` ever returns 200 | One test per constraint against a fake fetcher: concurrency 1, delay honoured, UA asserted, non-registered path refused, cert failure surfaces as an error, `robots.txt` 200 halts the run |
| Statutory method applied to the wrong level | A PBA run reaching D'Hondt; a national run reaching Hare; a PBA payload carrying `threshold` | **Applicable** (D3/D5) | Discriminated union with private algorithm modules; strict Zod variants at the boundary | One `@ts-expect-error` test per illegal pairing; one runtime test rejecting a PBA payload with `threshold` |

## Migration / Rollout

Greenfield — no data migration. Rollout is the proposal's 11 auto-chain slices, SPIKE first.
Slice 5 (PBA ingestion) stays in the sequence but is gated on D10's policy call; if the owner
declines, it is dropped and the PBA requirement is met only by the national-categories subset.
Rollback: drop and rebuild the projection from the append-only archive; every SQL migration ships
a down migration; curated YAML is revertable by commit.

## Open Questions

Closed since the first revision (evidence in `spikes/001-granularity-and-join-keys.md` unless
noted): PBA piso — none exists, the cuociente is the bar (Ley 5109 Arts. 109–110); allocation
method — Hare quota for PBA, D'Hondt for national; tie-breaks — statutory and deterministic for
PBA, sorteo only nationally; BUP drift — real, one name-based parser is feasible; mesa-level PBA
source — none, `apidocs.ar` is national-only; 2025 mesa count — 153; column↔agrupación mapping —
full 1:1 found, still requires curated review; robots.txt/terms — corrected, see D10.

Still open:

- [x] **RESOLVED — the product owner APPROVED the automated fetcher for
      `www.juntaelectoral.gba.gov.ar`, bound by D10's eight etiquette constraints.** Phase 5 is
      unblocked; PBA source entries may now be added to `sources.yaml`. The eight constraints are
      the CONDITION of the approval, not guidance.
      Evidence weighed before deciding: (i) the open-data route cannot substitute —
      `catalogo.datos.gba.gob.ar` declares a clean **CC BY 4.0** license but its "Resultados
      Electorales Provinciales" dataset covers only 2005–2023 generales / 2011–2021 PASO at
      MUNICIPIO level, with no 2025 and no mesa or circuito; (ii) that catalog's own `robots.txt`
      disallows `/api/` and sets `Crawl-Delay: 10`, so any future use of its ≤2023 series must go
      through `/dataset/.../download/` URLs and honour the delay; (iii) `juntaelectoral` has no
      terms page — `/terminos`, `/terminos-y-condiciones`, `/legales`, `/aviso-legal`,
      `/sitemap.xml` all 404; (iv) refining the SPIKE 0.6 refutation, `/resultados-generales/`
      (the directory) returns 403 while files inside return 200 — ordinary directory-listing-
      forbidden config, which likely explains what the SPIKE probed.
      **Consequence — new Phase 5 prerequisite:** the 2023 URL pattern does not extrapolate
      (`/resultados-generales/2025027.pdf` → 404), so D10's registered-path allowlist cannot be
      seeded from a guessed pattern. Path discovery under the same etiquette becomes task 5.0.
      Recorded in Engram #1412.
- [x] **RESOLVED — Decreto-Ley 6769/58 (Ley Orgánica de las Municipalidades) does NOT override
      Ley 5109 Arts. 109–110.** Art. 4: "Las elecciones se practicarán en el mismo acto en que se
      elijan los senadores y diputados de conformidad con lo establecido en la **Ley Electoral que
      rija en la Provincia**" — the LOM delegates the electoral method to Ley 5109. A full-text scan
      of the LOM for `cuociente|cociente|d'hondt|resto mayor|residuo|adjudicaci|sistema electoral`
      found no competing allocation rule; every `adjudicación` hit concerns public procurement. D3–D5
      stand; no further revision needed. Source: https://www.argentina.gob.ar/sites/default/files/ley_organica_de_municipalidades.pdf
- [x] **RESOLVED — council size is 18 seats, with 9 allocated per election.** LOM Art. 2 sets council
      size by population bracket (40.000–80.000 inhabitants → 18 concejales); Coronel Rosales had
      67.503 inhabitants per the INDEC definitive Censo 2022 results. LOM Art. 3 sets four-year terms
      with renewal by halves every two years → 9 seats per election, matching the observed 2023
      outcome (3 + 3 + 3 = 9). `proposal.md` and `specs/seat-simulation/spec.md` previously said
      "9 concejales renewed by halves", which described a nine-seat council renewing 4–5 per election;
      both have been corrected. `AllocationInput.seats` is already documented as "seats up for
      renewal, not the full council" and needs no change, but the two quantities MUST stay separate
      in every downstream artifact: the seats-per-election value is the Hare cuociente DIVISOR, so
      substituting 18 for 9 silently doubles the bar.
- [x] **RESOLVED — both valid-vote denominators are sourced (Engram #1414).** Recovered from
      official Junta Electoral documents during Phase 5 path discovery, by dividing each published
      cuociente by the 9 seats allocated per election. **2023:** published `COCIENTE CONCEJALES
      3.928,777777` x 9 = **35.359 valid votes**; cross-check 39.273 total - 35.359 = 3.914 blank
      and annulled, and LLA 10.365 / 35.359 = 29,31 % reproduces the recorded share exactly.
      **2025:** published `Cociente: 3.587,8888880` x 9 = **32.291 valid votes**. The 2025 document
      (`escrutinio-definitivo-2025/concejales_distri/2025027.pdf`) publishes the FULL computation --
      per-list quotients and the seat split by award reason (LLA 14.550 -> 4,055310 -> 5 seats = 4
      cuociente + 1 residuo; Fuerza Patria 7.300 -> 2,034620 -> 2 = 2 + 0; Potencia 4.540 ->
      1,265370 -> 2 = 1 + 1), plus 5.901 valid votes on sub-cuociente lists receiving zero seats --
      making it a stronger golden case than 2023, which publishes only the outcome. Both years
      divide by 9, independently confirming the seats-per-election figure from document arithmetic.
      39.273 remains forbidden as a divisor. A `MAYORIA` column exists, zero in both observed years;
      it is an unexercised statutory provision and MUST NOT be modelled speculatively.
- [x] **RESOLVED — the same-id identity hypothesis is ACCEPTED; fiscalización joins to official
      results at MESA level.** Measured by the orchestrator directly against the real 2025 national
      ZIP for distrito 02 / seccion 027 / DIPUTADO NACIONAL (153 official mesas): all 93
      fiscalización mesa numbers exist in the official set — zero unmatched, injective, 93/93.
      `La Libertad Avanza` matches exactly on all 89 comparable mesas (signed delta min 0, max 0).
      Seven of seventeen columns diverge nowhere. Divergence concentrates in `Impugnado`
      (31 mesas, 217 votes) and `En blanco` (8 mesas, 55 votes) — ~272 of ~300 total; every
      party-column residual is in single digits except Proyecto Sur (10) and Union Liberal (9).
      L1 distance: median 0, mean 3,4, max 14. Party-columns-only exact match is 83/93 = 89,2 %.
      Cause: a fiscal records "impugnado" at the table as a provisional judgement while the
      definitive escrutinio resolves impugnaciones afterwards — a category-definition difference,
      not a numbering mismatch.
      **Criterion correction:** SPIKE (h)'s "≥90 % exact vote-vector match" gate was mis-specified.
      It conflated *do the codes correspond* with *do the tallies agree*; only the former is the
      join-key question. Tally agreement is a fiscalización-quality metric and MUST be reported
      separately, never used to gate the join. Per-mesa tally divergence becomes an informational
      D7 review-queue record; the `Impugnado`/`En blanco` mismatch is modelled as an EXPECTED
      documented difference between the two source kinds, not as drift.
- [ ] Which concejal seats are up for renewal in 2027 (half-renewal cycle) — needs a sourced
      2023/2025 seat roster before the simulation can report full council composition. Note Ley 5109
      Art. 121 settles *which sitting councillors* leave first by sorteo; that is a different
      question from seat allocation and stays out of scope.
- [ ] Whether fiscal tallies diverge from the definitive escrutinio systematically or randomly —
      SPIKE (h) measured ~48 % of mesas differing but did not test for directional bias.
- [ ] Whether the fiscalización sheet will be re-exported over time, and by whom — decides
      whether `source_reexported` needs a curator workflow or stays informational.
