# SPIKE 001: Granularity and Join Keys

> Phase: `sdd-apply` Phase 0 (hard gate) · Change: `electoral-analysis-platform`
> Status: **COMPLETE** — verdicts below gate/reshape Phases 1–11 per `tasks.md`.

This document converts every UNVERIFIED/NOT FOUND cell in `design.md`'s Open Questions into a
committed value, evidenced against real downloaded data and real statute text. No verdict below
is asserted without the command/artifact that produced it.

## Evidence artifacts (not committed — gitignored under `archive/`, per D2)

| Artifact | Source | sha256 | Notes |
|---|---|---|---|
| `elecciones_legislativas_2025.zip` | `datos.mininterior.gob.ar` (resource `a24110fb-...`) | `5fb19bb280af8895dc0bc2ac19d79e836fb4053b713a135357743bf35371ee4b` | 13,554,180 bytes; 6 entries (3 CSV + 3 `__MACOSX` junk), no traversal/absolute-path entries |
| `2023_generales.zip` | `argentina.gob.ar/sites/default/files/2023_generales_1.zip` (via CKAN `resultados-provisionales-elecciones-2023`) | `2562b18c741ba5740d264e5328f206cb25f709ed0a4f8cf962f301e423e79c6b` | 28,028,857 bytes; 4 entries, no traversal/absolute-path entries |
| `2023-PROVISORIOS_PASO.zip` | Wayback Machine snapshot `20240106010034` of `argentina.gob.ar/sites/default/files/dine-resultados/2023-PROVISORIOS_PASO.zip` | `25558e7b73e8c273726ea12f04040e2fac8e693ad0eb866386502eb112bd2c0c` | 88,157,604 bytes; archived to `archive/national_2023_paso/` (gitignored per D2); 3 entries (`2023_PASO/`, `Ambitos_PASO_2023.csv`, `ResultadosElectorales.csv`), no traversal/absolute-path entries. `ResultadosElectorales.csv` alone deflates from 88,151,975 compressed bytes to 3,756,022,182 uncompressed bytes (~42.6x ratio) — this and the ~38x ratio seen on `elecciones_legislativas_2025.zip` are useful real-world evidence for sizing task 2.6b's uncompressed-size cap (a naive cap must accommodate legitimate ~40x national-results ratios without flagging them as bombs) |
| Fiscalización CSV | `/Users/nicolasmateoippoliti/Documents/Carga de Datos de Fiscalización - La Libertad Avanza - Elecciones 2025 - Mesas Procesadas.csv` | not hashed here (external, personal-data-bearing, never committed) | 105 raw rows → 93 unique mesas per Engram `sdd/electoral-analysis-platform/fiscalizacion-csv-2025` (#1389) |

---

## (a) National ZIP headers + 2025 Coronel Rosales mesa count

**Verdict: RESOLVED. 2025 Coronel Rosales mesa count = 153 (identical to the 2023 baseline).**

`elecciones_legislativas_2025.zip` contains 3 CSVs:

- `ambitosElectorales.csv` — `año,distrito_id,distrito_nombre,seccionprovincial_id,seccionprovincial_nombre,seccion_id,seccion_nombre`
- `localesDeVotacionyMesas.csv` — `año,eleccion_tipo,recuento_tipo,distrito_id,distrito_nombre,seccion_id,seccion_nombre,localvotacion_codigo,localvotacion_nombre,localvotacion_direccion,localvotacion_localidad,localvotacion_cp,localvotacion_geolat,localvotacion_geolng,mesa_id,mesa_electores,mesa_tipo`
- `resultados2025.csv` — `año,eleccion_tipo,recuento_tipo,padron_tipo,distrito_id,distrito_nombre,seccionprovincial_id,seccionprovincial_nombre,seccion_id,seccion_nombre,circuito_id,circuito_nombre,mesa_id,mesa_tipo,mesa_electores,cargo_id,cargo_nombre,agrupacion_id,agrupacion_nombre,lista_numero,lista_nombre,votos_tipo,votos_cantidad,estado_final,eleccion_id,recuento_id`

Filtering `localesDeVotacionyMesas.csv` for `distrito_id=02, seccion_id=027` (Coronel Rosales; see (c))
yields **153 distinct `mesa_id`, all `mesa_tipo=NATIVOS`**. Filtering `resultados2025.csv` for the
same district/section and `cargo_nombre=DIPUTADO NACIONAL` (the only cargo present — this election
elected national legislators only, confirming the fiscalización CSV's election identity) yields the
same **153 distinct `mesa_id`, all NATIVOS**.

Cross-checked against the 2023 `ResultadoElectorales_2023_Generales.csv` for the same
district/section: **153 distinct `mesa_id` (151 NATIVOS + 2 EXTRANJEROS)**. The 2 EXTRANJEROS mesas
appear only under national-executive categories (e.g. GOBERNADOR Y VICE) in 2023, not under
DIPUTADO NACIONAL in 2025 — consistent with foreign-resident voters not participating in a
district-bound legislative category. **The true mesa denominator for the fiscalización coverage
figure (D9.2) is 153, not the previous `≥152` lower-bound hedge**: coverage is **93/153 ≈ 60.8%**.

## (b) 2023 vs 2025 schema diff (BUP drift)

**Verdict: RESOLVED — real drift confirmed. One shared parser is feasible only if implemented by
CSV header name (never by column position) and driven by a per-year file manifest.**

| | 2023 (`2023_generales.zip`) | 2025 (`elecciones_legislativas_2025.zip`) |
|---|---|---|
| File set | `AmbitosElectorales_2023_Generales.csv`, `Colores_2023.csv`, `ResultadoElectorales_2023_Generales.csv` | `ambitosElectorales.csv`, `localesDeVotacionyMesas.csv`, `resultados2025.csv` |
| Filenames | PascalCase + year/round suffix | camelCase, no suffix |
| `AmbitosElectorales` header | `año,distrito_id,distrito_nombre,seccionprovincial_id,seccionprovincial_nombre,seccion_id,seccion_nombre` | **identical**, only quoting convention differs (2023 fully quotes non-numeric fields, 2025 doesn't quote at all) |
| Locales/mesas metadata (establecimiento name, address, lat/lng) | **absent** — no such file in 2023 | **new** — `localesDeVotacionyMesas.csv` |
| Agrupación colors | `Colores_2023.csv` present | **absent** from the 2025 ZIP |
| Results file column set | `año,eleccion_tipo,eleccion_id,recuento_tipo,recuento_id,padron_tipo,distrito_id,...,votos_tipo,votos_cantidad` (`eleccion_id`/`recuento_id` positioned early, no `estado_final`) | `año,eleccion_tipo,recuento_tipo,padron_tipo,distrito_id,...,votos_tipo,votos_cantidad,estado_final,eleccion_id,recuento_id` (`eleccion_id`/`recuento_id` moved to the END, new `estado_final` column added) |

**Consequence for task 3.5** (`etl/etl/ingest/national.py`): a single shared parser is possible
(the column *names* are stable, only order/presence differ) but MUST use `csv.DictReader`-style
name-based access, MUST treat `localesDeVotacionyMesas` as optional-per-year (2023 has no
establecimiento-level data at all — 2023 mesa granularity tops out at `mesa_id`/`mesa_electores`
from the results file, no address/geo), and MUST treat `estado_final` as `None`/not-applicable for
2023 rows.

## (c) National distrito/seccion code vs PBA `027`, cross-year stability

**Verdict: RESOLVED. `distrito_id=02` (Buenos Aires) / `seccion_id=027` (unpadded `27` in some
files) = "Coronel de Marina L. Rosales" — the official name behind "Coronel Rosales" — and this
code is STABLE across 2023 and 2025.**

- 2025 `ambitosElectorales.csv`: `2025,02,BUENOS AIRES,6,Sección Sexta,027,CORONEL DE MARINA L. ROSALES`
- 2023 `AmbitosElectorales_2023_Generales.csv`: `"2023","2","Buenos Aires","6","Sección Sexta","27","Coronel de Marina L. Rosales"`

Same `distrito_id`/`seccion_id` pair, same official name, both years — confirms the design's `027`
reference is the correct join key at the seccion (partido/municipio) level, and this is what the
DINE schema calls "seccion" for PBA elections (not the larger "Sección Electoral" used for
provincial legislator districts — a naming collision worth flagging for Phase 4/7 documentation).

**Zero-padding inconsistency (real, minor drift, not a code change):** `resultados2025.csv`'s
`mesa_id` field is **unpadded** (`1`, not `00001`), while `localesDeVotacionyMesas.csv`'s `mesa_id`
is **zero-padded to 5 digits** (`00057`). The crosswalk join code (task 4.6) MUST normalize mesa
numbers to integers before comparison, never compare as raw strings.

## (d) `resultados-electorales.argentina.apidocs.ar` OpenAPI probe

**Verdict: RESOLVED — real, documented, live API, but it does NOT cover PBA-provincial data.**

`https://resultados-electorales.argentina.apidocs.ar/` returns HTTP 200 and serves a VitePress
OpenAPI doc site (v1.0.1) for **"API de Publicación de Resultados Electorales de Elecciones
Nacionales, desde 2011"** (DINE, `soportedine@mininterior.gob.ar`), backed by
`https://resultados.mininterior.gob.ar/api`. It exposes `GET /resultados/getResultados`, filterable
by `anioEleccion`, `tipoRecuento`, `tipoEleccion` (PASO/Generales/Segunda Vuelta), `categoriaId`,
`distritoId`, `seccionProvincialId`, `seccionId`, `circuitoId`, `mesaId` — genuinely mesa-level, and
requires a JWT bearer token (`bearer_auth`).

**This is a national-elections API only** ("Elecciones Nacionales" in its own description). It
covers categories like PRESIDENTE, DIPUTADO NACIONAL, SENADOR NACIONAL — not PBA-provincial-only
categories (GOBERNADOR, INTENDENTE, CONCEJALES, LEGISLADOR PROVINCIAL). It does not substitute for
a PBA-provincial mesa-level source, and does not change the verdict in (e) below.

## (e) `juntaelectoral.gba.gov.ar` robots.txt / terms of use — HARD GATE

**Verdict: DENY. No fetcher for this host may be written. PBA-provincial 2025 ingestion is DROPPED
from scope. Phase 5 tasks (`etl/etl/ingest/pba.py`) are SKIPPED — see scope-removal note below.**

Evidence, in the order gathered:

1. `curl -sk https://juntaelectoral.gba.gov.ar/robots.txt` → **HTTP 403**, body
   `Request forbidden by administrative rules.` (tried with default `curl/8.7.1` UA and with a
   Chrome-120 desktop UA — same 403 both times). The TLS certificate served is a generic
   self-signed `haproxy.selfsigned.invalid` cert (issued 2021, valid to 2031), confirming an
   edge/WAF proxy in front of the origin, not a transient app error.
2. The SAME blanket 403 was returned for the bare homepage (`/`), for a documented PDF path
   (`/docs/cant_fichas.pdf`), and for `/escrutinio-definitivo-2025` — every path tested, not a
   robots.txt-specific rule. This is a **global automated-request block**, verified from an
   Argentina-based residential IP (`AS7303 Telecom Argentina`, Punta Alta — the same partido as
   Coronel Rosales), ruling out geo-blocking of non-AR traffic as the cause.
3. Wayback Machine CDX search (`web.archive.org/cdx/search/cdx?url=juntaelectoral.gba.gov.ar/robots.txt`)
   shows **only historical entries from 2006–2008, every one HTTP 404** (robots.txt has never
   existed on this host in Wayback's record) and **zero snapshots with HTTP 200** for that path
   ever. A live homepage snapshot from 2026-07-27 was fetched and its full nav/footer inspected:
   **no "Términos y Condiciones" / "Condiciones de Uso" / "Aviso Legal" page exists anywhere in the
   site's navigation.**

**Reading**: there is no discoverable, affirmative permission for programmatic fetching (no
robots.txt exists to consult, and no terms-of-use page exists to read), and the live server
actively refuses every automated request tested — including the plain homepage — with a blanket
WAF 403. Per the task's instruction ("if they forbid or **fail to permit** programmatic fetching"),
the absence of any permission signal combined with an active technical block on all tested paths is
read as **deny**, not as silent permission. This is reported as observed evidence, not inferred
intent: the operator may simply run an aggressive anti-bot WAF for unrelated reasons, but the
practical, testable result is that this host cannot be fetched programmatically today, from this
network, by any client presenting as automated.

**Scope-removal note**: Phase 5 (`etl/etl/ingest/pba.py`, PBA provincial/municipal mesa-level
ingestion from `juntaelectoral.gba.gov.ar`) is removed from scope. `electoral-ingestion`'s PBA
requirement is satisfied only via the national-categories subset already covered by (a)/(d) above;
PBA-only categories (Gobernador, Intendente, Concejales, Legislador Provincial) have **no
programmatic official source** identified by this SPIKE. Task 5.4's "distrito fallback per proposal
decision #1" is moot — there is no fallback fetcher either, since the same host serves both
granularities. If a future SPIKE finds an alternate official PBA source (e.g. a press-release PDF
channel, or `apidocs.ar` gains provincial coverage), Phase 5 can be revisited as a new change.

## (f) Wayback-only 2023 PASO ZIP — local archive

**Verdict: ARCHIVED**, independent of the above verdicts. See "Evidence artifacts" table for the
sha256 (computed at apply time in `archive/national_2023_paso/`, gitignored per D2). Fetched from
Wayback snapshot `20240106010034` with a 180s timeout as instructed; the file is ~88 MB and the
Wayback origin is slow, so the generous timeout was necessary in practice (a 120s attempt was
insufficient and had to be retried as a background download).

## (g) PBA Ley 5109 / Ley Orgánica de las Municipalidades — piso and tie-break

**Verdict: RESOLVED for the tie-break (deterministic, sourced). RESOLVED-DIFFERENT for the
allocation method itself — D3/D4's `allocateDhondt` premise is corrected. Piso: NOT a separate
fixed-percentage parameter under Ley 5109 as currently sourced.**

Source: Ley 5109 (Provincia de Buenos Aires), texto ordenado por Decreto 997/93, full updated text
fetched from `normas.gba.gob.ar/documentos/VGW7pIWV.html` (the "Ver texto actualizado" link off the
official normas.gba.gob.ar ficha for Ley 5109). Confirmed applicable to Concejales via **CAPÍTULO
XVIII, "DE LA ELECCIÓN CONJUNTA DE GOBERNADOR, VICEGOBERNADOR, DE SENADORES Y DIPUTADOS NACIONALES
Y PROVINCIALES, Y DE INTENDENTES, CONCEJALES Y CONSEJEROS ESCOLARES"** (Arts. 112–114).

**CAPÍTULO XVI, "DEL CUOCIENTE ELECTORAL" (Arts. 109–110) — the actual method is a Hare quota with
largest-remainder, NOT D'Hondt:**

> Art. 109: a) Total valid votes ÷ seats to fill = `cuociente electoral`. b) Each list's raw votes ÷
> `cuociente` = seats won by that list (integer part); lists below the `cuociente` get zero seats.
> c) If seats remain unallocated, they go one-by-one to the lists with the **largest remainder**
> (residuo), until filled. **Tie-break on equal remainders: "se adjudicará el candidato al partido
> que hubiere obtenido mayoría de sufragios"** — the seat goes to the list with the higher raw vote
> total. Blank and null votes are excluded when computing the `cuociente`.
> Art. 110: if no list reaches the `cuociente`, it is halved (and halved again, repeatedly) until
> enough lists qualify to fill every seat. **If more lists reach the `cuociente` than there are
> seats, the seats go to whichever lists got more votes** — again a deterministic, vote-count
> tie-break, not a lottery.

**Consequences**:
1. **D4 (tie-break) is CONFIRMED, not just unverified-but-assumed**: the statutory tie-break for
   equal remainders is exactly D4's first rule — higher raw vote total, deterministic. No `sorteo`
   language appears anywhere in Arts. 109–112 (the only `sorteo` in the whole law, Art. 121, governs
   which individual councillors' terms end first in a half-renewal cycle — a different question,
   already out of scope for seat *allocation*). D4's `tieBreakInvoked` flag and its UI disclaimer
   about a hypothetical lottery should be revised: for the *documented* residual-seat tie-break, no
   lottery exists in the statute; a genuinely exact-vote-total tie (both raw votes AND remainder
   identical) is not addressed by the text at all, so D4's second-level "lower list id" convention
   remains a simulation-only convention for that narrower, unaddressed case, as the design already
   flagged.
2. **D3/D5 need a correction, not just a threshold value**: the statutory method is a **Hare quota
   + largest remainder** system, not D'Hondt (highest averages). These are different algorithms
   that can produce different seat distributions for the same vote totals. `apps/web/src/domain/
   seat-allocation/dhondt.ts` (task 10.7) MUST be re-scoped to implement Art. 109–110's quotient
   method, or the module/function must be explicitly renamed and reasoned about as a *different*,
   deliberately-chosen simulation method with the mismatch disclosed in the UI — this is a decision
   for a human maintainer, not something this SPIKE can resolve unilaterally. **Recorded here as a
   correction to design.md D3, not silently implemented.**
3. **No separate fixed-percentage "piso" was found.** Unlike the national PASO's flat 1.5%-of-
   padrón threshold, Ley 5109's Art. 109–110 uses the `cuociente electoral` itself (votes ÷ seats,
   halved repeatedly if under-subscribed) as the qualifying bar — there is no additional minimum
   percentage of `valid_votes` or `padron` layered on top, as far as this SPIKE's reading of Arts.
   109–112 shows. D5's `threshold: { value, basis }` parameter as designed cannot be populated with
   a literal PBA percentage from this source; if Phase 10 wants to model the *quota* mechanism
   faithfully it needs a different parameter shape (seats-to-fill-driven, not percentage-driven).
   This SPIKE did not separately check Decreto-Ley 6769/58 (Ley Orgánica de las Municipalidades)
   for a competing or overriding municipal-specific rule — flagged as a residual open question
   below, not asserted as checked.

## (h) Empirical mesa crosswalk — HARD GATE

**Verdict: LITERAL THRESHOLD FAILS (51.7% exact vote-vector match < 90% required) — Risk 1's
formal pass criterion is NOT met. Supplementary same-id diagnosis strongly suggests the failure
is benign (fiscal-tally-vs-definitive-escrutinio divergence), not a numbering mismatch — reported
per the instruction not to misread a benign cause as "codes do not reconcile", but the literal
"do not force a pass" instruction is honored: this is recorded as a FAIL, with the qualifying
evidence below.**

Reusable code: `spikes/scripts/vote_vector_match.py` (pure `match_vote_vectors` function, 5 unit
tests in `spikes/scripts/test_vote_vector_match.py`, all synthetic — no personal data). Driver:
`spikes/scripts/run_crosswalk_spike.py` (reads the real fiscalización CSV directly from its
external path and the extracted `resultados2025.csv`, applies D9.4's merge-then-validate +
collapse rule, never writes any name anywhere).

**Party/column mapping** (a useful side-finding for Phase 7): the fiscalización CSV's 17 vote
columns map 1:1 by name onto the 15 `agrupacion_nombre` values found for `distrito=02, seccion=027,
cargo=DIPUTADO NACIONAL` plus the `EN BLANCO`/`IMPUGNADO` `votos_tipo` rows — e.g. "La Libertad
Avanza" → "ALIANZA LA LIBERTAD AVANZA", "Fuerza Patria" → "ALIANZA FUERZA PATRIA". No column was
left unmapped. (Full mapping in `run_crosswalk_spike.py::OFFICIAL_AGRUPACION_BY_COLUMN`.)

**D9.4 parse of the 105-row fiscalización CSV**: 6 continuation rows merged (Mesas 13 ×2, 18, 19,
36, 77), 4 identical-duplicate groups collapsed (Mesas 89, 85, 15, 68 → matches Engram #1389's
count), leaving **89 mesas with a complete, non-blank 17-value vector** (4 further mesas — 139,
141, 142, 143 — have a blank vote cell each and were excluded from exact-match testing per D9.4
rule 3: blank is missing, not zero, so they cannot be compared for exact equality). This is 89, not
93, because the ≥90%/≥84 threshold in D9.5 is computed against usable vectors; against the full 93
(treating the 4 blank-cell mesas as automatic non-matches) the rate would be even lower (46/93 ≈
49.5%).

**(i) Identity hypothesis** (local mesa N = DINE mesa N): **89/89 usable local mesas have exactly
one same-numbered official counterpart** (100% coverage of the join key itself — no local mesa
number is missing from the official 153). Of those, 46/89 (51.7%) match EXACTLY on the full
17-value vector.

**(ii) Independent nearest-vector matching** (`match_vote_vectors`, ignoring local numbering
entirely): exact matches 46/89 (51.7%), **injective = True, conflicts = []** — zero ambiguity, no
two local mesas ever claim the same official mesa as an exact match.

**Decisive cross-check**: for every one of the 89 usable local mesas, the globally nearest official
vector (found by exhaustive search over all 153 official mesas, with no knowledge of the local
number) is **always** the official mesa with the SAME number — 0 exceptions. Not one local mesa's
best match points to a *different*-numbered official mesa. The distance distribution for
non-exact matches (`{1: 4, 2: 2, 3: 2, 4: 3, 5: 4, 6: 5, 7: 2, 8: 5, 9: 4, 10: 2, 11: 4, 12: 4,
14: 2}`) is a spread of small-to-moderate per-mesa vote-count differences, not scattered noise that
would suggest random/wrong pairing.

**Interpretation**: this pattern — 100% same-id uniqueness, 0% cross-mesa ambiguity, but only
51.7% byte-for-byte tally equality — is exactly the "benign cause" the design anticipated: LLA's
internal fiscal count at close of voting legitimately differs from the definitive escrutinio for
roughly half the mesas (recounts, contested-ballot resolution, transcription corrections), while
the identity numbering scheme itself is not in question. **However**, the task's literal,
pre-committed pass criterion is a 90% *exact-match* rate, and 51.7% does not meet it — this SPIKE
does not redefine the criterion after the fact. **Formal outcome: Risk 1's ≥90% exact-match
criterion is NOT satisfied → per task 0.9's failure branch, `curated/crosswalk.yaml` is NOT
pre-populated as "verified" by this SPIKE.** Given the strength of the same-id evidence, Phase 4
should treat identity (local N = DINE N within seccion 027) as a **strong, evidenced hypothesis**
worth recording in `curated/crosswalk.yaml` with an explicit `confidence: same-id-only, not
exact-value-verified` annotation rather than either "verified" or "independent numbering" — that
binary framing does not fit this evidence. This is a recommendation for the human maintainer at
Phase 4, not a decision this SPIKE makes unilaterally. Per task 0.9's failure-branch text,
fiscalización joins should default to `Escuela`-level (establecimiento) until a maintainer confirms
the identity hypothesis is acceptable for mesa-level joins.

---

## Consolidated verdict table (every UNVERIFIED cell in design.md, resolved)

| Open question | design.md status | SPIKE verdict |
|---|---|---|
| PBA concejal piso value/basis | UNVERIFIED | Ley 5109 uses the `cuociente electoral` (votes ÷ seats, halved if under-subscribed) as the implicit qualifying bar; **no separate fixed-percentage piso found**. D5's `{value, basis}` shape does not fit this mechanism as-is — flagged for a human decision at Phase 10, not implemented here. |
| Statutory D'Hondt tie-break | UNVERIFIED | **CONFIRMED, deterministic**: Ley 5109 Art. 109(c)/110 resolve equal-remainder and equal-quota-count ties by higher raw vote total — matches D4's first rule. No `sorteo` in the allocation articles. |
| `juntaelectoral.gba.gov.ar` robots.txt/terms | UNVERIFIED, BLOCKING | **DENY** — no robots.txt or terms page exists; live server 403s every path tested. Phase 5 dropped from scope. |
| BUP schema drift 2023→2025 | UNVERIFIED | **Real drift confirmed**: column reorder, `estado_final` added in 2025, `localesDeVotacionyMesas` new in 2025, `Colores` removed. One shared parser is feasible only with name-based (not positional) parsing and a per-year file manifest. |
| Mesa-level PBA/municipal source existence | UNVERIFIED, fallback accepted | `apidocs.ar` is real and mesa-filterable but **national-categories only**; no PBA-provincial source found. Fallback (distrito-level) is moot since Phase 5 is dropped entirely (no host to fetch from at any granularity). |
| 2027 half-renewal seat roster | Not yet sourced | Not addressed by this SPIKE (out of scope for the join-keys/granularity focus); remains open for Phase 10. |
| 2025 Coronel Rosales mesa count | UNVERIFIED, `≥152` hedge | **RESOLVED: 153** (identical to 2023). Coverage renders as `93/153 ≈ 60.8%`, not `93/≥152`. |
| Local fiscalización mesa numbers == DINE mesa codes | UNVERIFIED, SPIKE (h) | **Literal threshold FAILS (51.7% < 90%)**, but same-id structural evidence (100% coverage, 0 conflicts, 0 cross-mesa best-matches) strongly supports identity as the correct join key with tally divergence, not numbering error, explaining the gap. Recorded as a nuanced fail, not forced to pass. `curated/crosswalk.yaml` not pre-verified; Phase 4 default to `Escuela`-level joins pending a maintainer decision. |
| 17 fiscalización columns ↔ DINE agrupación list | UNVERIFIED, curated mapping required | **Full 1:1 name mapping found and recorded** in `run_crosswalk_spike.py::OFFICIAL_AGRUPACION_BY_COLUMN` — useful seed for Phase 7's `curated/party_map.yaml`, not a substitute for the curated review that task still requires. |
| Fiscal-vs-escrutinio divergence | Not yet measured | **First measurement**: ~48% of usable mesas show a non-zero vote-count difference between the fiscal tally and the definitive DIPUTADO NACIONAL escrutinio, distributed across small-to-moderate distances (see distribution above), consistent with ordinary recount/correction activity rather than data corruption. |
| Re-export cadence of the fiscalización sheet | Not yet measured | Not addressed by this SPIKE — the file was read once, at a single point in time. |

## Downstream scope changes

- **Phase 5 (`etl/etl/ingest/pba.py`, PBA provincial/municipal ingestion) is REMOVED from scope**,
  per the SPIKE 0.6 deny verdict. `sources.yaml` MUST NOT gain PBA entries (task 2.8's conditional
  branch resolves to "no PBA entries").
- **Phase 4's `curated/crosswalk.yaml`** should NOT be seeded as "verified" for mesa-level identity
  by this SPIKE (0.9 literal fail); seed it with the same-id hypothesis under an explicit
  lower-confidence annotation instead, and scope fiscalización joins to `Escuela`-level by default
  until a maintainer accepts the identity hypothesis for mesa-level use.
- **Phase 10's `allocateDhondt`** needs a design-level correction before implementation: Ley 5109's
  actual method is Hare quota + largest remainder, not D'Hondt. This SPIKE does not resolve which
  method ships — that decision belongs to a human maintainer, informed by this evidence.
- **D4's tie-break UI copy** can be strengthened from "a real tie would be settled by lot" (still
  true for the narrow unaddressed exact-vote-AND-remainder tie) to explicitly cite Art. 109(c)/110
  for the addressed cases, since those are now sourced and deterministic, not speculative.
- **D5's `threshold: { value, basis }` parameter shape** may not fit Ley 5109's quota mechanism;
  flagged for Phase 10 design reconsideration, not silently reshaped here.
