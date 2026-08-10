# Tasks: Electoral Analysis Platform (Votus)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~5300–6600 across all units (SPIKE ~150 done; scaffold ~200; archive ~600; national ingestion ~700; crosswalk ~300; PBA ingestion ~500 conditional; fiscalización ~500; party mapping ~300; migrations ~550; access-control ~250; seat-allocation domain ~950 — two algorithms + discriminated union + Zod boundary; UI ~900; docs/design.md itself is 483+ lines and near budget alone) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (SPIKE, done) → PR 2 (scaffold) → PR 3 (archive) → PR 4 (national ingestion) → PR 5 (crosswalk) → PR 6 (PBA ingestion, conditional on policy) → PR 7 (fiscalización) → PR 8 (party mapping) → PR 9 (migrations+RLS) → PR 10 (access-control) → PR 11a (Hare quota) → PR 11b (D'Hondt) → PR 11c (allocate.ts boundary) → PR 12 (UI) |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain — PR 1 targets `tracker/electoral-analysis-platform`; each later PR targets the immediate previous PR's branch; only the tracker merges to main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | SPIKE verdict (a–h) — DONE | PR 1 (base: tracker) | N/A — findings doc | `uv run python spikes/scripts/*.py` | Delete `spikes/001-granularity-and-join-keys.md` |
| 2 | Test runners + monorepo scaffold | PR 2 (base: PR 1) | `uv run pytest` (empty pass), `pnpm vitest run` (empty pass) | N/A — no runtime behavior yet | Delete `etl/pyproject.toml`, `apps/web/package.json` |
| 3 | Archive/manifest layer (national sources only) | PR 3 (base: PR 2) | `uv run pytest etl/tests/test_archive.py etl/tests/test_manifest.py` | `uv run python -m etl fetch --source national_2023_generales` (fake fetcher) | Delete `etl/etl/{archive,manifest,http_client,storage}.py`, `etl/sources.yaml` |
| 4 | National 2023/2025 parser + normalized schema | PR 4 (base: PR 3) | `uv run pytest etl/tests/test_ingest_national.py` | `uv run python -m etl ingest --source national_2023_generales` against fixture ZIP | Delete `etl/etl/ingest/national.py`, migrations 0001–0002 |
| 5 | Crosswalk (national ↔ PBA, cross-year) | PR 5 (base: PR 4) | `uv run pytest etl/tests/test_crosswalk.py` | `uv run python -m etl validate-crosswalk` | Delete `curated/crosswalk.yaml`, migration 0003 |
| 6 | PBA provincial/municipal ingestion — conditional on D10 policy call | PR 6 (base: PR 5) | `uv run pytest etl/tests/test_ingest_pba.py` | `uv run python -m etl ingest --source pba_provincial_2025` against fixture | Delete `etl/etl/ingest/pba.py`; drop the `sources.yaml` entries |
| 7 | Fiscalización ingestion (D9 contract) | PR 7 (base: PR 6, or PR 5 if PR 6 is skipped) | `uv run pytest etl/tests/test_ingest_fiscalizacion.py` | `uv run python -m etl ingest --source fiscalizacion_2025` against stripped fixture | Delete `etl/etl/ingest/fiscalizacion.py`, fixture, migration 0004 |
| 8 | Party mapping (curated YAML + validation) | PR 8 (base: PR 7) | `uv run pytest etl/tests/test_party_map.py` | `uv run python -m etl validate-curated` | Delete `curated/party_map.yaml`, migration 0005 |
| 9 | Postgres migrations + RLS integration | PR 9 (base: PR 8) | `supabase test db` / `psql -f supabase/tests/rls.sql` | `supabase db reset && supabase db test` | `supabase migration down` per migration pair |
| 10 | Access control (auth + single role) | PR 10 (base: PR 9) | `pnpm vitest run apps/web/src/middleware.test.ts` | `pnpm playwright test e2e/auth.spec.ts` | Delete `apps/web/src/middleware.ts`, auth routes |
| 11a | Hare quota + largest remainder (`hare-quota.ts`) | PR 11a (base: PR 10) | `pnpm vitest run apps/web/src/domain/seat-allocation/hare-quota.test.ts` | N/A — pure function | Delete `hare-quota.ts` + its tests |
| 11b | D'Hondt (`dhondt.ts`) | PR 11b (base: PR 11a) | `pnpm vitest run apps/web/src/domain/seat-allocation/dhondt.test.ts` | N/A — pure function | Delete `dhondt.ts` + its tests |
| 11c | `allocate.ts` public boundary + Zod discriminated union | PR 11c (base: PR 11b) | `pnpm vitest run apps/web/src/domain/seat-allocation` | N/A — pure function, table-driven | Delete `allocate.ts`, `types.ts`, `schemas.ts` |
| 12 | Comparison/drilldown/review/simulation UI + provenance + badges | PR 12 (base: PR 11c) | `pnpm vitest run apps/web/src/components` | `pnpm playwright test e2e/comparison.spec.ts e2e/provenance.spec.ts` | Delete `apps/web/src/app/(authenticated)/**`, components |

## Phase 0: SPIKE (hard gate — nothing below may be implemented before this returns a verdict)

- [x] 0.1 Create `spikes/001-granularity-and-join-keys.md` skeleton with sections (a)–(h) per design.md.
- [x] 0.2 (a) Fetch/unzip real 2023 and 2025 national ZIPs; dump column headers; record the 2025 Coronel Rosales mesa count (resolves the `93/≥152` denominator open question). **Resolved: 153.**
- [x] 0.3 (b) Diff 2023 vs 2025 column schemas; record BUP drift verdict (decides shared vs split parser, feeds task 4.1). **Real drift confirmed — shared parser feasible only with name-based parsing + per-year file manifest.**
- [x] 0.4 (c) Cross-reference national distrito code against PBA `027`; diff mesa/circuito codes across years. **Stable: distrito 02 / seccion 027 = Coronel de Marina L. Rosales, both years.**
- [x] 0.5 (d) Probe `resultados-electorales.argentina.apidocs.ar` OpenAPI and any per-mesa escrutinio export; record mesa-level PBA/municipal availability verdict. **Real API, national-categories only, no PBA-provincial coverage.**
- [x] 0.6 (e) — HARD GATE: read `juntaelectoral.gba.gov.ar/robots.txt` and terms of use. **SPIKE recorded DENY (blanket 403). SUPERSEDED by design.md D10: orchestrator re-verification found no robots.txt exists (404, not 403), the `www` host serves 200 normally, and a `LEY5109.pdf` fetch succeeded from the same host this session. Corrected verdict: product-owner policy gate, not a technical deny (Engram #1398). Phase 5 below is RESTORED as in-scope-pending-policy — see Phase 5 header.**
- [x] 0.7 (f) Archive the Wayback-only 2023 PASO ZIP locally now (timeout 180s), independent of verdict outcome. **Archived to `archive/national_2023_paso/` (gitignored).**
- [x] 0.8 (g) Read PBA Ley 5109 / Ley Orgánica de las Municipalidades; record piso value+basis and tie-break statute (resolves D4/D5 UNVERIFIED items). **Tie-break CONFIRMED deterministic (Art. 109(c)/110, higher vote total). Allocation method is Hare quota + largest remainder for PBA, NOT D'Hondt (Engram #1399); D'Hondt applies only to national diputados (Ley 19.945 Art. 161). No separate fixed-% piso found under Ley 5109 for PBA — the cuociente itself is the bar. Council-size correction (LOM Art. 2: 18 total, 9 per election, Coronel Rosales 67.503 inhabitants) recorded separately, Engram #1400.**
- [x] 0.9 (h) — HARD GATE for join strategy: write a one-off matching script against the stripped fiscalización fixture (93 vectors) vs the national 2025 ZIP for distrito 027; test identity hypothesis and vector-distance matching; report exact-match rate and best-match-distance distribution. **Literal threshold FAILS (46/89 = 51.7% < 90%). Supplementary same-id diagnosis (100% same-id coverage, 0 conflicts, 0 cross-mesa best-matches) strongly supports identity as the correct join key with benign tally divergence, not numbering failure. `curated/crosswalk.yaml` not pre-seeded as verified; Phase 4 defaults to `Escuela`-level joins pending a maintainer decision on the identity hypothesis.**
- [x] 0.10 Write the SPIKE verdict conclusion: convert every UNVERIFIED/NOT FOUND cell in the proposal's granularity table into a committed value. **Done — see consolidated verdict table in `spikes/001-granularity-and-join-keys.md`. NOTE: that table's row for gate (e) still reads DENY; it is superseded in effect by design.md D10 and this tasks.md, but the SPIKE document's prose is left as the historical record of what was measured at the time, per instructions — do not silently rewrite completed history.**

## Phase 1: Scaffold and Test Runners

- [x] 1.1 Create `etl/pyproject.toml` + `etl/uv.lock` (uv project, pytest runner); `uv run pytest` passes on an empty test.
- [x] 1.2 Create `apps/web/package.json` (Next.js App Router, TypeScript, vitest, Playwright); `pnpm vitest run` passes on an empty test.
- [x] 1.3 Configure `apps/web/tsconfig.json` strict mode per the typescript skill (no `any`, const-object types).
- [x] 1.4 Wire Zod 4 (`zod` package) into `apps/web` for boundary validation.

## Phase 2: Archive and Manifest Layer (national sources only)

RED tests first (spec `source-archive`):

- [x] 2.1 RED: `etl/tests/test_archive.py::test_first_fetch_creates_immutable_entry`.
- [x] 2.2 RED: `etl/tests/test_archive.py::test_refetch_never_mutates_prior_entry`.
- [x] 2.3 RED: `etl/tests/test_archive.py::test_sha256_recorded_on_fetch`.
- [x] 2.4 RED: `etl/tests/test_manifest.py::test_manifest_entry_created_per_fetch` and `test_manifest_queryable_by_source`.
- [x] 2.5 RED: `etl/tests/test_archive.py::test_drift_flagged_on_changed_hash` and `test_no_drift_on_identical_refetch`.
- [x] 2.6 RED: `etl/tests/test_http_client.py::test_fetch_failure_does_not_create_partial_entry` and `test_unreachable_source_reports_unavailable`.
- [x] 2.6a RED (threat matrix — untrusted archive extraction): `etl/tests/test_storage.py::test_zip_entry_with_absolute_path_rejected`, `test_zip_entry_with_dotdot_traversal_rejected`.
- [x] 2.6b RED (threat matrix — untrusted archive extraction): `etl/tests/test_storage.py::test_decompression_bomb_exceeds_size_cap_fails_loudly` (cap must tolerate the ~40x national-results deflate ratio measured in the SPIKE evidence table).
- [x] 2.6c RED (threat matrix — fetching a host with no declared permission, D10, applies once Phase 5's fetcher exists): `etl/tests/test_http_client.py::test_pba_host_concurrency_capped_at_one`, `test_pba_host_delay_honours_politeness_seconds`, `test_pba_host_uses_identifying_user_agent`, `test_pba_host_refuses_unregistered_path`, `test_pba_host_tls_failure_is_a_hard_error_not_bypassed`, `test_pba_host_halts_run_if_robots_txt_ever_returns_200`.
- [x] 2.7 GREEN: port `etl/etl/{archive,manifest,http_client,storage}.py` from `lla-coronel-rosales` (read-only reference), unmodified semantics, fake `Fetcher` Protocol seam; extraction path rejects traversal entries and enforces an uncompressed-size cap; `http_client` reuses `POLITENESS_DELAY_SECONDS` and gains a per-host concurrency cap and registered-path allowlist for D10.
- [x] 2.8 GREEN: create `etl/sources.yaml` with the 4 national entries seeded from the sibling; PBA entries (host `www.juntaelectoral.gba.gov.ar`) added only after Phase 5's policy gate clears.
- [x] 2.9 REFACTOR: confirm all Phase 2 tests pass; no dead code from the port.

> **Delivery note — RESOLVED.** Phase 2's implementation is complete and independently
> re-verified by the orchestrator: **45 passed**, `ruff check` clean. Reviewable diff is
> **1588 authored lines** (measured; `uv.lock` excluded per `delivery.review_budget_exclusions`).
> The product owner raised `review_budget_lines` from 400 to **800**, so Phase 2 ships as
> **three** chained slices under `feature-branch-chain`, not the five that 400 would have
> required:
>
> | Slice | Contents | Lines |
> |---|---|---|
> | 3a | `storage.py` + `manifest.py` + their tests | 613 |
> | 3b | `archive.py` + `http_client.py` base (`RequestsFetcher`) + their tests | 652 |
> | 3c | D10 layer (`HostPolicy`/`PolicedHostFetcher`) + 6 threat tests + `sources.yaml` | 323 |
>
> `etl/etl/http_client.py` splits cleanly at line 87 (ported fetcher vs D10 etiquette layer),
> with the matching test-file boundary at line 200. No commit has been made (RDD on, no receipt).
>
> **Forecasting correction for later phases:** this phase was forecast at ~600 lines and came
> in at 1588. The gap is the test-to-logic ratio, roughly 2:1 once threat-matrix rows are in
> play (~458 lines of logic, ~884 of tests). Phases 6 and 11 carry the most threat-matrix rows
> and should be pre-sliced here rather than discovered at apply time.

## Phase 3: National Ingestion (jurisdiction-model + electoral-ingestion, national subset)

- [x] 3.1 RED: `etl/tests/test_jurisdiction.py::test_mesa_row_records_full_lineage` and `test_distrito_row_does_not_fabricate_lower_levels`.
- [x] 3.2 RED: `etl/tests/test_ingest_national.py::test_2023_generales_mesa_rows_one_per_combination`.
- [x] 3.3 RED: `etl/tests/test_ingest_national.py::test_2025_bup_format_parsed_or_fails_loudly` (name-based access, `estado_final` treated as absent for 2023 rows per SPIKE (b)).
- [x] 3.4 RED: `etl/tests/test_ingest_national.py::test_idempotent_reingest_same_archive_entry` and `test_full_rebuild_from_archive_is_identical`.
- [x] 3.5 GREEN: create `etl/etl/ingest/national.py` — one shared, name-based parser per SPIKE 0.3 verdict, driven by a per-year file manifest; mesa-id integers normalized (2025's unpadded vs `localesDeVotacionyMesas.csv`'s zero-padded form) per SPIKE (c).
- [x] 3.6 GREEN: `supabase/migrations/0001_jurisdiction.sql` + down migration — `jurisdiction`, `election`, `category` tables.
- [x] 3.7 GREEN: `supabase/migrations/0002_result_row.sql` + down migration — `result_row(granularity, source_kind, is_unmapped, archive_entry_id, source_row_index)`, index `(source_kind, election_id, jurisdiction_id)`.
- [x] 3.8 REFACTOR: confirm idempotency test passes against a real fixture ZIP cut from the archived 2023 file.

## Phase 4: Crosswalk (national ↔ PBA, cross-year stability)

- [x] 4.1 RED: `etl/tests/test_crosswalk.py::test_coronel_rosales_resolves_across_numbering_schemes`.
- [x] 4.2 RED: `etl/tests/test_crosswalk.py::test_unmapped_jurisdiction_code_is_quarantined`.
- [x] 4.3 RED: `etl/tests/test_crosswalk.py::test_mesa_code_stable_across_years` and `test_mesa_code_absent_in_one_year_reported_as_discontinuity`.
- [x] 4.3a RED: `etl/tests/test_crosswalk.py::test_fiscalizacion_mesa_identity_is_accepted_and_injective` — the identity hypothesis is ACCEPTED (product-owner decision, Engram #1410). Assert 93/93 mesa-number coverage against the official set with zero unmatched and zero many-to-one collisions.
- [x] 4.3b RED: `etl/tests/test_crosswalk.py::test_tally_divergence_is_informational_not_a_join_failure` — a mesa whose vote vector differs from the official record MUST still join, and the divergence MUST be recorded as an informational D7 review-queue item, never as a join failure or drift.
- [x] 4.3c RED: `etl/tests/test_crosswalk.py::test_impugnado_and_en_blanco_mismatch_is_expected_not_drift` — the fiscal's provisional `Impugnado`/`En blanco` judgement vs the definitive escrutinio is a documented category-definition difference between source kinds and MUST NOT raise drift.
- [x] 4.4 GREEN: create `curated/crosswalk.yaml` seeded with the SPIKE 0.4 distrito `027` mapping and the fiscalización mesa identity recorded as **`confidence: accepted-by-maintainer`**, citing the measured evidence (93/93 injective coverage; LLA exact on all 89 comparable mesas; L1 median 0 / mean 3,4 / max 14; party-columns-only exact match 83/93 = 89,2 %).

> **Criterion correction (why 4.3a changed).** SPIKE (h)'s "≥90 % exact vote-vector match" gate was
> mis-specified by the orchestrator's own Phase 0 prompt: it conflated *do the codes correspond*
> with *do the tallies agree*, and only the former is the join-key question. The SPIKE answered the
> test it was given correctly, reporting a literal FAIL at 51,7 % while flagging the same-id
> evidence. Tally agreement is a fiscalización-quality metric, reported separately, never a gate on
> the join. See design.md Open Questions and Engram #1410.
- [x] 4.5 GREEN: `supabase/migrations/0003_jurisdiction_crosswalk.sql` + down migration.
- [x] 4.6 GREEN: crosswalk resolution + quarantine logic in `etl/etl/ingest/national.py` (unmapped code → quarantine, not silent assignment).

## Phase 5: PBA Provincial/Municipal Ingestion — UNBLOCKED, policy call DECIDED (D10)

> **DECIDED (Engram #1412): the product owner APPROVED building the automated fetcher for
> `www.juntaelectoral.gba.gov.ar`, bound by D10's eight etiquette constraints.** Tasks 5.4–5.6 are
> no longer blocked. The 2025 PBA provincial election (7 Sep 2025) stays in scope per binding
> product decision #2. The eight constraints are the CONDITION of the approval, not advice.
>
> Evidence behind the decision:
> - The open-data route cannot substitute. `catalogo.datos.gba.gob.ar` carries a clean
>   **CC BY 4.0** license, but its "Resultados Electorales Provinciales" dataset covers only
>   **2005–2023 generales / 2011–2021 PASO at MUNICIPIO level** — no 2025, no mesa or circuito.
> - That catalog's `robots.txt` (HTTP 200) disallows `/api/` and sets `Crawl-Delay: 10`. If the
>   ≤2023 municipio series is ever pulled, use `/dataset/.../download/` URLs, honour the delay, and
>   do NOT automate against `/api/`.
> - `www.juntaelectoral.gba.gov.ar` has no terms page: `/terminos`, `/terminos-y-condiciones`,
>   `/legales`, `/aviso-legal`, `/sitemap.xml` all 404, as does `/robots.txt`.
> - Refinement of the SPIKE 0.6 refutation: `/resultados-generales/` (the directory) returns **403**
>   while files inside return 200 — ordinary "directory listing forbidden" config. The SPIKE likely
>   probed directory paths and saw real 403s. Its "blanket 403 including robots.txt" conclusion was
>   still wrong, but it was not fabricating.
>
> **New prerequisite — task 5.0 below.** The 2023 URL pattern does NOT extrapolate:
> `/resultados-generales/2025027.pdf` returns 404. D10's registered-path allowlist therefore cannot
> be seeded from a guessed pattern, and path discovery must happen first, under the same etiquette.

- [x] 5.0 GREEN (prerequisite): discover the real 2025 PBA result paths for distrito 027 under D10 etiquette (concurrency 1, ≥4 s delay, identifying UA, no crawling beyond linked pages). Record every confirmed URL, its HTTP status and content type in `spikes/002-pba-2025-paths.md`. If no 2025 provincial result document is reachable, STOP and report — do not widen the search into a general crawl. **Done — a 2025 document IS reachable: `escrutinio-definitivo-2025/distrito_027.html` (distrito-level HTML table, Diputados Prov. + Concejales) plus 4 reference-only "bancas" PDFs, found by navigating root → linked landing page → the site's own `distrito_<code>.html` JS pattern. See `spikes/002-pba-2025-paths.md` for the full trail.**

- [x] 5.1 RED: `etl/tests/test_ingest_pba.py::test_distrito_level_totals_ingested_without_fabricating_lower_levels`.
- [x] 5.2 RED: `etl/tests/test_ingest_pba.py::test_no_source_available_reports_unavailable_not_zero`.
- [x] 5.3 RED: `etl/tests/test_ingest_pba.py::test_mesa_requested_but_only_distrito_available_marks_degradation`.
- [x] 5.3a RED (threat matrix — D10, fetching a host with no declared permission): `etl/tests/test_ingest_pba.py::test_fetcher_pinned_to_www_host_cert_verification_on_no_dash_k`, `test_fetcher_bounded_to_registered_paths_only_no_crawling`, `test_fetcher_caches_and_does_not_refetch_existing_archive_entry`, `test_fetcher_backs_off_and_stops_after_3_attempts_on_429_or_5xx`.
- [x] 5.4 GREEN (unblocked): create `etl/etl/ingest/pba.py` at mesa or distrito granularity per whatever the fetch actually returns. **Distrito — the only granularity the discovered source provides; enforced structurally via `jurisdiction.make_result_row`.**
- [x] 5.5 GREEN (unblocked): add PBA source entries to `etl/sources.yaml`, host `www.juntaelectoral.gba.gov.ar`, carrying D10's 8 etiquette constraints (pinned host + cert verification, concurrency 1, ≥4s delay via `POLITENESS_DELAY_SECONDS`, identifying UA, archive-first caching, bounded retry-then-stop, registered paths only, halt-and-escalate if `robots.txt` ever returns 200).
- [x] 5.6 GREEN: degradation flag persisted as a first-class `result_row` attribute (not log-only), per `electoral-ingestion`'s degradation requirement. **`PbaRow.degraded_from` — set to the requested granularity when it differs from what the source provides, `None` otherwise; asserted by 5.3's and 5.1's tests.**

## Phase 6: Fiscalización Ingestion (D9 contract)

- [x] 6.1 Personal-data-stripped fixture: `etl/tests/fixtures/fiscalizacion_2025_full_sample.csv` — the REAL, full 105-row Coronel Rosales sheet, `Nombre`/`Apellido` columns fully removed (not blanked — the columns don't exist), `Escuela` retained. Added ALONGSIDE Phase 4's pre-existing `fiscalizacion_2025_stripped_sample.csv` (4-row excerpt, kept unmodified — its own tests parse every vote cell as plain `int` with no wrapped-continuation/blank handling, so growing it in place would have broken already-green Phase 4 tests) rather than extending that file, per the instruction to extend-or-add-alongside.
- [x] 6.2 RED→GREEN: `etl/tests/test_ingest_fiscalizacion.py::test_wrapped_continuation_row_merged_not_quarantined` (D9.4.1; the empty-`Mesa` rows).
- [x] 6.3 RED→GREEN: `etl/tests/test_ingest_fiscalizacion.py::test_identical_duplicate_rows_collapsed` (D9.4.2; mesas 13, 15, 68, 85×3, 89 in the real fixture, plus a synthetic case).
- [x] 6.4 RED→GREEN: `etl/tests/test_ingest_fiscalizacion.py::test_conflicting_duplicate_is_quarantined_not_dropped` and `test_unmergeable_empty_mesa_row_is_quarantined` (D9.4.3; synthetic cases — the real sheet has zero genuine conflicts, verified in 6.14).
- [x] 6.5 RED→GREEN: `etl/tests/test_ingest_fiscalizacion.py::test_blank_vote_cell_is_missing_not_zero` (D9.4.3/4; `Impugnado`/`En blanco` blanks).
- [x] 6.6 RED→GREEN: `etl/tests/test_ingest_fiscalizacion.py::test_escuela_normalized_for_matching_raw_string_preserved` (D9.4.4).
- [x] 6.7 RED→GREEN (threat matrix — personal-data-bearing source ingestion): `etl/tests/test_ingest_fiscalizacion.py::test_no_loaded_column_or_review_note_contains_a_name` — synthetic placeholder names only, never a real surname from the source sheet.
- [x] 6.8 RED→GREEN (threat matrix): `etl/tests/test_ingest_fiscalizacion.py::test_committed_fixture_has_no_name_columns`.
- [x] 6.9 RED→GREEN (threat matrix): `etl/tests/test_ingest_fiscalizacion.py::test_fiscalizacion_entries_never_reach_the_remote_uploader` — this project has no remote uploader at all (D2); the test makes that a structural, enforced invariant (`guard_local_mirror_only`) for this one personal-data-bearing source rather than an implicit absence, and asserts the committed `sources.yaml` entry itself complies.
- [x] 6.10 RED→GREEN: `etl/tests/test_ingest_fiscalizacion.py::test_reexport_hash_change_recorded_as_info_not_content_drift` (D9.4.5).
- [x] 6.11 GREEN: `etl/etl/ingest/fiscalizacion.py` implements the ordered contract: `strip_personal_columns` (on raw CSV text, before any row object exists) → merge wrapped continuations → collapse identical duplicates → quarantine genuine conflicts/unmergeable rows → normalize `Escuela` for matching only. Reuses `crosswalk.FISCALIZACION_VOTE_COLUMNS` (no duplication).
- [x] 6.12 GREEN: added `fiscalizacion` capability entry to `etl/sources.yaml` — `source_kind: fiscalizacion`, `source_url: local://...` marker (the real absolute path is user-machine-specific and outside the repo, per the constraint that no test may depend on it), `upload: never`.
- [x] 6.13 GREEN (deviation — see note below): `supabase/migrations/0004_source_kind.sql` + down migration — creates the `archive_entry` table (didn't exist before this migration; 0002's own comment recorded that gap as deferred) WITH `source_kind`. `result_row.source_kind` already existed since 0002 — nothing to add there. `review_item.kind` extension is NOT part of this migration: the `review_item` table itself doesn't exist until Phase 11 (same forward-gap already recorded for Phase 5's fetch-failure records); `etl.ingest.fiscalizacion.ReviewItemDraft` is the traceable artifact Phase 11's loader will project into it.
- [x] 6.14 REFACTOR: full suite green (84 passed: 73 carried + 11 new). `test_real_fixture_converges_to_93_unique_mesas_with_documented_totals` confirms, against the real 105-row fixture: 105 raw rows → merge → 99 (white-box on `_merge_wrapped_rows`, zero quarantined) → collapse → 93 unique mesas (zero conflicts) → 20.797 total votes, LLA 12.578 (60,48 %), Fuerza Patria 4.165 (20,03 %), 4 blank cells — exactly matching Engram #1389/design D9's documented end state.

## Phase 7: Party Identity Mapping

- [x] 7.1 RED: `etl/tests/test_party_map.py::test_lla_solo_list_135_mapped_2023_municipal`.
- [x] 7.2 RED: `etl/tests/test_party_map.py::test_lla_pro_alliance_distinct_from_2023_lla`.
- [x] 7.3 RED: `etl/tests/test_party_map.py::test_local_only_list_962_mapped_without_national_counterpart`.
- [x] 7.4 RED: `etl/tests/test_party_map.py::test_unmapped_list_id_excluded_from_rollup_and_flagged`.
- [x] 7.5 RED: `etl/tests/test_party_map.py::test_unmapped_row_never_falls_back_to_different_year_or_jurisdiction`.
- [x] 7.6 GREEN: create `curated/party_map.yaml` keyed by `(year, jurisdiction, category, list_id)`. **The "2025 list numbers UNVERIFIED" placeholder is obsolete — real identifiers were extracted from the archived sources (Engram #1417).** Seed with measured values:
  - **National 2023 (PASO):** `agrupacion_id` 135 = LA LIBERTAD AVANZA, `lista_numero` 3016. Same distrito also carries 132 JUNTOS POR EL CAMBIO (3008), 133 HACEMOS POR NUESTRO PAIS (3001), 134 UNION POR LA PATRIA (3005), 136 FRENTE DE IZQUIERDA (3009).
  - **National 2025:** `agrupacion_id` **110** = ALIANZA LA LIBERTAD AVANZA. Full distrito-02 set: 11, 110, 248, 252, 253, 258, 259, 260, 262, 263, 265, 315, 316, 317, 372.
  - **PBA municipal 2025 (concejales):** list **2206** = ALIANZA LA LIBERTAD AVANZA, 2200 = ALIANZA FUERZA PATRIA, 2201 = ALIANZA POTENCIA.
  - Also seed the 17-column-to-agrupación mapping the SPIKE recovered (`run_crosswalk_spike.py::OFFICIAL_AGRUPACION_BY_COLUMN`) as curator input, not as pre-verified.
- [x] 7.6a RED: `test_agrupacion_id_is_not_a_cross_year_party_key` — LLA's national `agrupacion_id` CHANGED 135 (2023) → 110 (2025). The identifier is per-election. Resolution MUST go through the `(year, jurisdiction, category, list_id)` key and MUST NOT match a party across years by `agrupacion_id`.
- [x] 7.6b RED: `test_empty_lista_numero_in_2025_is_not_treated_as_missing_data` — `lista_numero` is populated in 2023 (LLA = 3016) and **EMPTY for every agrupación in 2025**, a Boleta Única consequence: a single ballot has no per-party list numbers. This is a semantic emptying of an existing column, distinct from the already-recorded BUP column drift. Any mapping key that requires `lista_numero` works on 2023 and silently yields nothing on 2025 — assert that 2025 resolution succeeds without it.
- [x] 7.6c RED: `test_pba_municipal_scheme_never_resolved_against_national_ids` — PBA municipal uses a separate 22xx family unrelated to either national scheme. Cross-scheme resolution MUST fail loudly, not silently match.

> **CAUTION for 7.1 — RESOLVED.** Sourced (one-off fetch per D10) from the primary 2023 municipal escrutinio document, `https://www.juntaelectoral.gba.gov.ar/resultados-generales/2023027.pdf` (HTTP 200, distrito 027 SECCION SEXTA, TOTAL DE MESAS 153): the 2023 Coronel Rosales municipal (Concejales) ballot used the SAME list numbers as the national `agrupacion_id` space for this distrito — 135 LA LIBERTAD AVANZA, 132 JUNTOS POR EL CAMBIO, 134 UNION POR LA PATRIA, 962 AGRUPACION MUNICIPAL PRIMERO ROSALES (local-only). Task 7.1's premise is CONFIRMED, not borrowed from another jurisdiction's scheme — no field left UNVERIFIED. `curated/party_map.yaml` records this source per entry.
- [x] 7.7 GREEN: `supabase/migrations/0005_party_mapping.sql` + down migration — `list_identity`, `party_canonical`, `party_mapping` tables.
- [x] 7.8 GREEN: mapping resolution + unmapped-row handling in ingestion (national + PBA paths reference this table, never infer at query time).

## Phase 8: RLS and Idempotency Integration

> **Structural fix (prerequisite, discovered running real Postgres for the first
> time this phase).** The Supabase CLI applies every `.sql` file directly under
> `supabase/migrations/` as a forward migration, in filename order. The
> `NNNN_..._down.sql` files committed alongside 0001-0005 were therefore ALSO
> auto-applied on `supabase db start`/`db reset`, and their shared numeric
> prefix collided with the forward migration's own version in
> `supabase_migrations.schema_migrations` (`SQLSTATE 23505`, duplicate key) —
> migrations 0001-0005 could not run at all before this was fixed. All five
> `*_down.sql` files were moved to a new sibling directory,
> `supabase/migrations_down/` (not scanned by the CLI), with a README
> explaining the convention and how to apply one manually. No forward
> migration's SQL changed.

- [x] 8.1 RED: `supabase/tests/rls_anonymous_denied.sql` — one assertion per table under the anon role.
- [x] 8.2 RED: `etl/tests/test_integration_idempotent.py::test_ephemeral_postgres_reingest_matches_original` (ephemeral local Postgres).
- [x] 8.3 RED: `etl/tests/test_integration_idempotent.py::test_drop_and_rebuild_equality`.
- [x] 8.4 GREEN: `supabase/migrations/0006_rls.sql` + down migration — enable RLS on every electoral table, single authenticated-role policy, no anonymous grant.
- [x] 8.5 GREEN: idempotent delete-by-`archive_entry_id` + bulk insert transaction wrapper (D8) in ingestion entrypoints.

> **Evidence summary.** `supabase init` + `supabase db start` ran migrations
> 0001-0006 against real local Postgres for the first time (Docker,
> `supabase_db_votus-plataforma-lla`, port 54322). `supabase/tests/rls_anonymous_denied.sql`
> (11 pgTAP `throws_ok` assertions, SQLSTATE 42501) passes against 0001-0005
> alone — the CLI's local default never grants a new table to `anon` unless a
> migration explicitly does, so no accidental leak exists — and RED was
> instead produced honestly by injecting a real regression (`grant select on
> jurisdiction to anon`), observing the suite catch it (`Result: FAIL`, 1/11),
> then reverting and confirming `Result: PASS` again. `0006_rls.sql` makes the
> "no anonymous grant" invariant an explicit, self-documenting `REVOKE` (not
> an implicit platform default) and adds the one `authenticated`-only `SELECT`
> policy per table the requirement actually needs. `etl/tests/test_integration_idempotent.py`'s
> two tests were RED before `etl/etl/db.py` existed (`mv`'d aside — genuine
> `ImportError: cannot import name 'db'` collection error, matching Phases 6-7's
> transient-removal RED technique, this time for a not-yet-connected Postgres
> writer instead of a Python module), then GREEN after restoring it, both
> against the real ephemeral database (uuid-scoped `archive_entry_id` per
> test run, transaction rolled back in the `pg_conn` fixture's teardown).
> `db.upsert_jurisdiction` discovered a real correctness bug while writing
> this: `jurisdiction`'s unique constraint spans four NULLABLE columns, and
> Postgres never treats `NULL = NULL` as a conflict match, so a plain
> `ON CONFLICT` upsert would silently duplicate the jurisdiction row on every
> re-ingest of a PBA distrito-level source (all four columns `NULL`) — fixed
> with a `SELECT ... IS NOT DISTINCT FROM` lookup instead. `load_national_rows`
> and `load_pba_rows` wire `db.load_result_rows` into the two long-format
> entrypoints; `ingest_fiscalizacion` gets an explicit forward-gap comment
> instead (its wide-format 17-vote-column shape needs a list-id mapping that
> does not exist yet, and D9.1 already excludes it from every default read
> path). Full suite: **104 passed** — 3 new integration tests
> (`test_integration_idempotent.py`) added to the prior baseline; the exact
> prior total in Engram's Phase 7 note (96) undercounted by 5 relative to
> this session's `uv run pytest` output, which includes
> `test_vote_vector_match.py`'s 5 SPIKE-script tests (`../spikes/scripts`,
> wired into `testpaths` since Phase 1) — a pre-existing bookkeeping gap in
> the prior note, not a Phase 8 regression; `ruff check` clean,
> `ruff format --check` clean on every file authored this phase (pba.py's
> one pre-existing formatter-drift line, noted since Phase 7, was left
> untouched again). Personal-data sweep: grepped every file touched this
> phase for `Nombre`/`Apellido`/surname markers — the only hits are the
> pre-existing Phase 6 column-name references (`PERSONAL_DATA_COLUMNS`
> constant and its docstring, unmodified), zero real names anywhere.

## Phase 9: Access Control (web)

- [x] 9.1 RED: `apps/web/src/middleware.test.ts::test_unauthenticated_request_rejected_without_data`.
- [x] 9.2 RED: `apps/web/src/middleware.test.ts::test_authenticated_request_succeeds`.
- [x] 9.3 RED: `apps/web/src/middleware.test.ts::test_two_authenticated_users_get_identical_access`.
- [x] 9.4 RED: `e2e/auth.spec.ts::test_no_anonymous_read_path_including_cached_content` (Playwright, seeded fixture DB).
- [x] 9.5 GREEN: create `apps/web/src/middleware.ts` — Supabase Auth session check, redirect unauthenticated to login, no public route for in-scope data.
- [x] 9.6 GREEN: create `apps/web/src/app/(authenticated)/layout.tsx` gating all in-scope routes; single role, no privilege flags.

## Phase 10: Seat Allocation Domain (pure TypeScript, two statutory algorithms, D3–D5)

`apps/web/src/domain/seat-allocation/` exposes only `allocate.ts`; `hare-quota.ts` and `dhondt.ts`
are module-private. `AllocationInput` is a discriminated union on `level` (`HareInput` has no
`threshold`; `DhondtInput` has no `cuociente`), enforced at compile time and, via a Zod 4
`z.discriminatedUnion` over `z.strictObject` variants, at the web boundary.

### 10a — Hare quota + largest remainder (Ley 5109 Arts. 109–110)

- [x] 10.1 RED: `hare-quota.test.ts::test_cuociente_denominator_excludes_blank_and_annulled_votes` (Art. 109 final paragraph — divisor uses `validVotes`, never `totalVotes`).
- [x] 10.2 RED: `hare-quota.test.ts::test_list_below_cuociente_gets_zero_seats_but_carries_remainder_forward`.
- [x] 10.3 RED: `hare-quota.test.ts::test_largest_remainder_top_up_orders_by_descending_remainder`.
- [x] 10.4 RED: `hare-quota.test.ts::test_equal_remainder_resolved_by_higher_vote_total_and_flagged_statutory` (Art. 109(c) — MUST NOT be labelled `simulation_convention`).
- [x] 10.5 RED: `hare-quota.test.ts::test_repeated_50_percent_halving_when_no_list_reaches_cuociente` (Art. 110, multiple halving iterations recorded).
- [x] 10.6 RED: `hare-quota.test.ts::test_over_subscription_awards_seats_to_highest_voted_qualifying_lists` (Art. 110).
- [x] 10.7 RED: `hare-quota.test.ts::test_seats_divisor_is_9_not_18_for_coronel_rosales_council` (council-total-vs-seats-per-election distinction; Engram #1400).
- [x] 10.8 RED: `hare-quota.test.ts::test_18_seats_to_fill_for_single_election_is_rejected` (rejects council total substituted for seats-per-election).
- [x] 10.9 RED — **UNBLOCKED, denominators now sourced (Engram #1414).** Both years' valid-vote denominators were recovered from official Junta Electoral documents during Phase 5's path discovery, by dividing the published cuociente by the 9 seats per election. Write TWO golden cases, neither approximating anything:
  - `hare-quota.test.ts::test_2023_coronel_rosales_golden_case` — published `COCIENTE CONCEJALES 3.928,777777` × 9 = **35.359 valid votes**. Cross-check: 39.273 total − 35.359 valid = 3.914 blank + annulled. Sanity check that must hold: LLA 10.365 / 35.359 = 29,31 %, reproducing the recorded share exactly. Expected outcome UxP 3 / JxC 3 / LLA 3 = 9. Source: `https://www.juntaelectoral.gba.gov.ar/resultados-generales/2023027.pdf`.
  - `hare-quota.test.ts::test_2025_coronel_rosales_golden_case` — the STRONGER case, because the document publishes the full computation rather than only the outcome. Published `Cociente: 3.587,8888880` × 9 = **32.291 valid votes**. Assert every column: ALIANZA LA LIBERTAD AVANZA 14.550 votes → quotient 4,055310 → 5 seats (4 by cuociente + 1 by residuo); ALIANZA FUERZA PATRIA 7.300 → 2,034620 → 2 (2 + 0); ALIANZA POTENCIA 4.540 → 1,265370 → 2 (1 + 1). Total 9. The three qualifying lists sum to 26.390, so **5.901 valid votes belong to sub-cuociente lists that receive zero representation** — a sourced test of Art. 109(b) exclusion. Source: `https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/concejales_distri/2025027.pdf`.
  - The document also carries a `MAYORIA` column, zero in both observed years. Do NOT model it speculatively; record it as an unexercised statutory provision in the test file's comments so it is not mistaken for a missing feature.
  - 39.273 remains forbidden as a divisor. It is the TOTAL vote count and MUST only ever be reported alongside, never used as the denominator.
- [x] 10.10 GREEN: create `apps/web/src/domain/seat-allocation/hare-quota.ts` (module-private) implementing Art. 109–110 per 10.1–10.8; table-driven, no I/O.
- [x] 10.11 GREEN: create `apps/web/src/domain/seat-allocation/council.ts` — 9-per-election / 18-total half-renewal roster tracking, holds over the un-renewed 9 as sourced input.

### 10b — D'Hondt (Ley 19.945 Art. 161, national diputados only)

- [x] 10.12 RED: `dhondt.test.ts::test_national_diputados_quotient_table_matches_supplied_vote_totals`.
- [x] 10.13 RED: `dhondt.test.ts::test_national_3_percent_padron_threshold_excludes_list_but_reports_raw_share` (Art. 160 — basis is padrón, not valid votes).
- [x] 10.14 RED: `dhondt.test.ts::test_equal_quotient_different_vote_totals_ordered_by_vote_total_and_flagged_statutory` (Art. 161(c) first clause).
- [x] 10.15 RED: `dhondt.test.ts::test_equal_quotient_and_equal_votes_tie_flagged_as_simulation_convention_not_statute` (Art. 161(c) ends in sorteo, which the system does not perform).
- [x] 10.16 GREEN: create `apps/web/src/domain/seat-allocation/dhondt.ts` (module-private) per 10.12–10.15; table-driven, no I/O.

### 10c — `allocate.ts` public boundary and level→method binding

- [x] 10.17 RED (threat matrix — statutory method applied to the wrong level, D3/D5): `allocate.test-d.ts::test_pba_level_input_carrying_threshold_field_fails_to_compile` (`@ts-expect-error` on the illegal pairing — type-level test).
- [x] 10.18 RED (threat matrix): `allocate.test-d.ts::test_national_level_input_carrying_cuociente_field_fails_to_compile` (`@ts-expect-error`).
- [x] 10.19 RED (threat matrix): `allocate.test.ts::test_runtime_rejects_pba_payload_with_threshold_key_as_unknown_key` (Zod `z.strictObject` boundary rejection, not a silent ignore).
- [x] 10.20 RED: `allocate.test.ts::test_pba_level_always_resolves_to_hare_quota_no_operator_override`.
- [x] 10.21 RED: `allocate.test.ts::test_national_level_always_resolves_to_dhondt_no_operator_override`.
- [x] 10.22 RED: `allocate.test.ts::test_result_traceable_per_seat_awarded_by_rule_tag_and_numbers_used`.
- [x] 10.23 RED: `allocate.test.ts::test_hypothetical_2027_inputs_labeled_as_projection_not_historical`.
- [x] 10.24 GREEN: create `apps/web/src/domain/seat-allocation/types.ts` — `AllocationLevel`, `HareInput`, `DhondtInput`, `AllocationInput` discriminated union, `AllocationResult` per design's traceability shape.
- [x] 10.25 GREEN: create `apps/web/src/domain/seat-allocation/schemas.ts` — Zod 4 `z.discriminatedUnion('level', [hareSchema, dhondtSchema])` over `z.strictObject` variants; TS types derived via `z.infer`.
- [x] 10.26 GREEN: create `apps/web/src/domain/seat-allocation/allocate.ts` — the only public export, dispatches to private `hare-quota.ts`/`dhondt.ts` by `level`.
- [x] 10.27 REFACTOR: confirm all Phase 10 tests pass; confirm `hare-quota.ts` and `dhondt.ts` have no external imports outside `allocate.ts`.

## Phase 11: Results Analysis, Provenance UI, Disclaimers

- [x] 11.1 RED: `apps/web/src/lib/results/compare.test.ts::test_mesa_level_comparison_when_both_years_available`.
- [x] 11.2 RED: `compare.test.ts::test_distrito_only_comparison_labeled_distrito_not_mesa`.
- [x] 11.3 RED: `compare.test.ts::test_mixed_granularity_returns_requires_explicit_aggregation_status` (D6).
- [x] 11.4 RED: `compare.test.ts::test_flip_detection_reports_from_to_with_both_shares`.
- [x] 11.5 RED: `compare.test.ts::test_no_flip_still_reports_swing`.
- [x] 11.6 RED: `compare.test.ts::test_discontinuous_mesa_excluded_from_swing_and_listed_separately`.
- [x] 11.7 RED (threat matrix — unofficial-source leakage into official figures, path 1: default query): `apps/web/src/lib/fiscalizacion/repository.test.ts::test_default_query_excludes_fiscalizacion`.
- [x] 11.8 RED (threat matrix, path 2: aggregate): `repository.test.ts::test_aggregate_excludes_fiscalizacion_without_opt_in`.
- [x] 11.9 RED (threat matrix, path 3: rendered page): `e2e/provenance.spec.ts::test_rendered_page_excludes_fiscalizacion_without_opt_in`.
- [x] 11.10 RED: `repository.test.ts::test_fiscalizacion_query_without_coverage_is_refused` (D9.2, `requires_explicit_unofficial_opt_in`).
- [x] 11.11 RED: `apps/web/src/components/GranularityBadge.test.tsx::test_mesa_indicator_and_degraded_indicator_shown`.
- [x] 11.12 RED: `apps/web/src/components/SourceDisclaimer.test.tsx::test_disclaimer_present_and_not_permanently_dismissible`.
- [x] 11.13 RED: `apps/web/src/components/ProvenanceLink.test.tsx::test_traces_figure_to_archive_entry_sha256_url_timestamp` and `test_swing_figure_lists_both_contributing_sources`.
- [x] 11.14 RED: `e2e/comparison.spec.ts::test_mixed_granularity_flagged_in_display_not_only_api`.
- [x] 11.15 GREEN: create `apps/web/src/lib/results/compare.ts` implementing the discriminated-union response (`ok` / `requires_explicit_aggregation`; `requires_explicit_unofficial_opt_in` is implemented on `repository.ts`'s response type in task 11.16 — see Deviations).
- [x] 11.16 GREEN: create `apps/web/src/lib/fiscalizacion/repository.ts` — `ResultsRepository` interface, default `source_kind = 'official'` filter, explicit opt-in path.
- [x] 11.17 GREEN: create `apps/web/src/components/{GranularityBadge,ProvenanceLink,SourceDisclaimer}.tsx`.
- [x] 11.18 GREEN: create `apps/web/src/app/(authenticated)/{compare,drilldown,review,simulate}/page.tsx` (RSC, server-only reads) — the simulate page wires `allocate.ts` from Phase 10.
- [x] 11.19 GREEN: create `supabase/migrations/0007_review_item.sql` + down migration — `review_item(kind, severity, subject_ref, detected_at, resolved_at, note)`; unresolved-count banner query. ALSO wired the ETL write path (`etl/etl/review_item.py`, `etl/etl/db.py::insert_review_items`) that projects `MesaDivergence`/`ReviewItemDraft` into this table — see Deviations (beyond the 20 numbered tasks, done per explicit orchestrator instruction).
- [x] 11.20 REFACTOR: confirm the full E2E suite (`pnpm playwright test`) and full pytest suite (`uv run pytest`) pass together. Full evidence: `etl` 108/108 pytest passed, ruff clean; `apps/web` 43/43 vitest passed, `tsc --noEmit` clean, `next build` clean; Playwright against the real local Supabase stack: `auth.spec.ts` and `provenance.spec.ts` genuinely PASS (real login, real session, real HTTP), `comparison.spec.ts` explicitly SKIPS by default (see Deviations — a pre-existing `service_role` grant gap, verified to genuinely pass when temporarily granted, then reverted).

## Phase 11 Deviations (disclosed, not silent)

1. `compare.ts`'s discriminated union carries `ok` and `requires_explicit_aggregation` (D6) only; `requires_explicit_unofficial_opt_in` (D9.2) is implemented on `repository.ts`'s own response type instead, because it is a source-kind decision the repository makes, not a granularity decision `compare.ts` makes — keeps each module's union scoped to what it actually decides, and matches where 11.7–11.10's RED tests literally live (`repository.test.ts`, not `compare.test.ts`).
2. Task 11.19's `review_item` migration was extended with actual ETL wiring (`etl/etl/review_item.py`, `etl/etl/db.py::insert_review_items`) beyond the 20 numbered tasks, per the orchestrator's explicit "wire it" instruction — verified against the real local Postgres instance, not just pure-logic tests.
3. `compare`/`drilldown` pages use `list_id` as the party key (party-name resolution via `party-identity-mapping`'s `party_mapping` table is not wired into `ResultsRepository` — a disclosed simplification, not a silent gap).
4. `/simulate` takes a JSON `input` query parameter rather than a rich operator-facing form — task 11.18 scopes this page to wiring `allocate.ts`; a full form is out of this phase's numbered scope.
5. **Discovered, not fixed**: the local Postgres instance's `service_role` has `bypassrls=true` but no table-level `GRANT` on any electoral table (pre-existing across ALL tables, not introduced by Phase 11 — the ETL has always written through the raw `postgres` connection instead, so this was never exercised before). `e2e/comparison.spec.ts` seeds fixture rows via the `service_role` JS client and explicitly SKIPS with a clear reason when that grant is absent, rather than failing on an environment/ops gap. Verified genuinely GREEN end-to-end (real login, real Postgres, real page render, real D6 refusal displayed) with a temporary local-only grant, then reverted — no migration commits a broadened grant.
6. `result_row`'s D8 idempotency key `(archive_entry_id, jurisdiction_id, category_id, list_id, source_kind)` does NOT include `election_id` or `granularity` — two fixture rows for different years sharing an `archive_entry_id` collide as duplicates of the same natural key. `comparison.spec.ts`'s fixture uses a distinct `archive_entry_id` suffix per year to avoid this; worth flagging for whoever wires the real multi-year ingestion path.

## Phase 12: Runnable System — close the three gaps found in verification

Phases 0–11 delivered a well-tested library with no way to run it. `result_row` holds 0 rows,
no entrypoint exists, and the write path documented in `0006_rls.sql` is not the one the code
uses. The specs say the system MUST fetch each registered source and MUST ingest PBA
provincial and municipal results; today that is true of functions, not of the system.

### 12a — CLI entrypoint

`tasks.md`'s own work-unit table promised four runtime harnesses that were never built and that
no numbered task ever required. They are the contract this sub-unit satisfies.

- [x] 12.1 RED: `etl/tests/test_cli.py::test_fetch_subcommand_archives_a_registered_source` (fake `Fetcher`, no network).
- [x] 12.2 RED: `test_cli.py::test_fetch_rejects_an_unregistered_source_name` — unknown source is an error, never a silent no-op.
- [x] 12.3 RED: `test_cli.py::test_ingest_subcommand_loads_rows_into_result_row` (ephemeral Postgres; skip explicitly when unreachable).
- [x] 12.4 RED: `test_cli.py::test_validate_crosswalk_reports_unmapped_codes_and_exits_nonzero`.
- [x] 12.5 RED: `test_cli.py::test_validate_curated_reports_unmapped_list_ids_and_exits_nonzero`.
- [x] 12.6 RED: `test_cli.py::test_ingest_refuses_to_write_without_an_explicit_database_url` — never silently fall back to a default DSN.
- [x] 12.7 GREEN: create `etl/etl/__main__.py` exposing `fetch`, `ingest`, `validate-crosswalk`, `validate-curated`, matching the four commands the work-unit table already names. Exit codes: 0 success, non-zero on validation failure.

### 12b — Fiscalización Postgres loader

Fiscalización data is parsed, validated, merged and crosswalked, but never reaches Postgres:
`load_national_rows` and `load_pba_rows` exist, `load_fiscalizacion_rows` does not.

- [x] 12.8 RED: `etl/tests/test_ingest_fiscalizacion.py::test_wide_columns_map_to_one_result_row_per_list` — the sheet is 17 wide vote columns per mesa; `result_row` is long. The mapping MUST go through `curated/party_map.yaml`, never by column position.
- [x] 12.9 RED: `::test_blank_vote_cell_is_missing_not_zero_in_the_loaded_rows` — a blank cell must not become a 0 vote row.
- [x] 12.10 RED: `::test_loaded_rows_carry_source_kind_fiscalizacion` — never `official`.
- [x] 12.11 RED: `::test_fiscalizacion_load_never_writes_a_fiscal_name` — assert the personal-data columns reach no table.
- [x] 12.12 GREEN: `load_fiscalizacion_rows` in `etl/etl/ingest/fiscalizacion.py`, reusing `db.py::load_result_rows` so D8's election-scoped idempotency applies unchanged.

### 12c — Write role

- [x] 12.13 RED: `supabase/tests/rls_write_role.sql` — pgTAP asserting the role the ETL actually uses can INSERT/UPDATE/DELETE on every electoral table, and that `anon` still cannot read.
- [x] 12.14 GREEN: `supabase/migrations/0009_etl_write_grants.sql` + down — grant DML to the ETL's role on every electoral table, leaving the `authenticated` read-only policy and the `anon` revoke from 0006 untouched.
- [x] 12.15 GREEN: correct `0006_rls.sql`'s comment, which states loading happens through `service_role` when `service_role` holds no DML privilege and the code connects as `postgres`. Document the real write path, and make the DSN configurable rather than defaulting to a superuser.

### 12d — End-to-end proof

- [x] 12.16 GREEN: run the real pipeline once against the archived 2025 national ZIP and record the outcome — `result_row` count, distinct elections, distinct jurisdictions — in `spikes/003-first-end-to-end-run.md`. This is the first evidence the system runs at all, not just that its functions do.

## Phase 13: Fiscalización operator route

Closes the contract gap found after `sdd-verify`: the fiscalización capability was complete
and unreachable — no page called `repository.queryFiscalizacion()`. The product owner decided
the view belongs in this change, so the two requirements added to
`specs/fiscalizacion-analysis/spec.md` are mandatory here, not deferred.

- [x] 13.1 RED: `apps/web/src/app/(authenticated)/fiscalizacion/page.test.tsx::test_route_requests_fiscalizacion_through_the_opt_in_path` — asserts the page calls the opt-in query with a coverage argument and never reads through the default official-only path.
- [x] 13.2 RED: `::test_route_refuses_to_render_without_coverage` — renders the refusal state, never an unlabelled figure.
- [x] 13.3 RED: `::test_every_fiscalizacion_figure_carries_unofficial_indicator_and_coverage` — each figure shows the unofficial-source indicator plus covered/total mesa counts.
- [x] 13.4 RED: `::test_coverage_indicator_states_it_is_not_a_random_sample` — the covered mesas are exactly those where a fiscal was present; the indicator MUST say so.
- [x] 13.5 RED: `::test_official_figure_inside_the_view_carries_its_own_official_indicator` — the two source kinds are never visually interchangeable.
- [x] 13.6 RED: `apps/web/src/components/JuxtapositionBadge.test.tsx::test_cross_election_juxtaposition_shows_both_election_identities_and_source_kinds` — Requirement 7, previously unimplementable because nothing rendered a fiscalización figure.
- [x] 13.7 RED: `::test_non_random_coverage_is_stated_adjacent_not_only_in_a_footnote`.
- [x] 13.8 GREEN: create `apps/web/src/components/JuxtapositionBadge.tsx`.
- [x] 13.9 GREEN: create `apps/web/src/app/(authenticated)/fiscalizacion/page.tsx` — RSC, server-only read, reaching data ONLY through `repository.queryFiscalizacion()`.
- [x] 13.10 GREEN: link the route from the authenticated layout so it is reachable by an operator, not merely addressable by URL.
- [x] 13.11 RED then GREEN: `apps/web/e2e/fiscalizacion.spec.ts::test_route_renders_labelled_unofficial_figures` — the rendered-page leakage guard already has an e2e; this proves the opt-in path renders correctly. Skip explicitly if credentials are absent, never silently pass.

## Phase 14: Close the four carried risks

`sdd-verify` returned PASS WITH WARNINGS with six risks. Two were closed immediately (the
juxtaposition badge's live reachability and the dormant local-mirror guard). These are the
remaining four. None is a defect in what the change specifies; all four are real, and the
product owner asked for them fixed rather than carried as debt.

### 14a — Migration 0009 ships a known password

- [x] 14.1 RED: `supabase/tests/rls_write_role.sql` — assert no electoral-table role can log in with the literal `etl_writer_local_dev_only`, so a fresh deploy cannot inherit a publicly-known credential.
- [x] 14.2 GREEN: `supabase/migrations/0010_etl_writer_no_default_password.sql` + down — create `etl_writer` with NO usable password by default; a deployment MUST set one explicitly out of band. Keep the `if not exists` guard so an environment that already provisioned the role is untouched.
- [x] 14.3 GREEN: give local development an explicit, non-migration path to set the dev credential (a documented one-liner or seed script), so the local end-to-end flow still works without the migration itself shipping a secret.

### 14b — N+1 in `upsert_jurisdiction`

- [x] 14.4 RED: `etl/tests/test_integration_idempotent.py::test_jurisdiction_resolution_is_batched_not_per_row` — assert the number of round trips is bounded by a small constant, not proportional to the distinct jurisdiction count.
- [x] 14.5 GREEN: batch jurisdiction resolution in `etl/etl/db.py` — collect the distinct lineage tuples, resolve the existing ones in one query, bulk-insert the missing ones, preserving the `is not distinct from` NULL semantics that migration 0002's nullable key requires.
- [x] 14.6 REFACTOR: re-run the national 2025 ingest and record the new wall-clock against the 5 m 53 s baseline in `spikes/003-first-end-to-end-run.md`.

### 14c — Playwright never runs

- [x] 14.7 GREEN: commit a credential-provisioning path for the LOCAL stack only — the Supabase local anon/service keys are well-known fixed development defaults, not secrets, so they can be committed for `supabase start` without exposing anything. A real deployment continues to read from the environment.
- [x] 14.8 GREEN: seed the e2e fixture user reproducibly, and delete it afterwards.
- [x] 14.9 REFACTOR: run all four e2e spec files and record which now genuinely pass. Any that still skip MUST state why; a skip that hides an unproven requirement is worse than a failure.

  Result (recorded here, `apps/web/e2e.env` committed, ran via
  `npx playwright test` with the local Supabase stack up): **3/4 genuinely
  pass** — `auth.spec.ts`, `provenance.spec.ts`, `fiscalizacion.spec.ts`.
  `comparison.spec.ts` still skips, with an explicit, already-documented
  reason (pre-existing code, Phase 11): the local `service_role` has no
  table GRANTs on the electoral tables (writes normally go only through
  the ETL's raw `postgres`/`etl_writer` connection per D8), so its
  fixture-row seeding step fails and the test self-skips rather than
  failing on an environment/ops gap unrelated to the page or repository
  under test. Confirmed reproducible across two consecutive runs (fixture
  user seeded and deleted cleanly both times, `select ... from auth.users
  where email like '%votus-e2e-fixture%'` returns 0 rows after each run).

### 14d — PBA and fiscalización never loaded from real sources

`result_row` is 100 % `official` and holds only the national 2025 ZIP. Five PBA entries and one
fiscalización entry are registered in `sources.yaml` and have never been fetched or ingested.

- [x] 14.10 GREEN: fetch the five registered PBA entries under D10's etiquette constraints — serial, ≥4 s apart, identifying UA, TLS verification on, registered paths only.
- [x] 14.11 GREEN: ingest PBA into `result_row`, at whatever granularity the source publishes, surfacing degradation rather than fabricating lower levels.
- [x] 14.12 GREEN: place the fiscalización CSV at its registered archive path and ingest it, stripping personal data at ingestion.
- [x] 14.13 REFACTOR: record the resulting `result_row` composition — rows per `source_kind`, per election, per granularity — in `spikes/004-full-corpus-load.md`, and confirm the default query still returns official-only.

## Phase 15: Curated-table loaders

The curated YAML files exist, are validated and are tested, but **nothing loads them into
Postgres**: `party_mapping`, `party_canonical`, `list_identity`, `jurisdiction_crosswalk` and
`mesa_crosswalk` are all EMPTY. Consequences measured live: the UI renders raw `list 110`
instead of a party name, and a cross-year query returns NULL unless the caller hard-codes the
per-election ids by hand — LLA is `135` in the 2023 PASO, `20135` in the 2023 generales and
`110` in 2025. Reconciling those is precisely what the curated tables exist for.

### 15a — party mapping loader

- [x] 15.1 RED: `etl/tests/test_load_curated.py::test_party_canonical_rows_created_once_per_canonical_party` — re-running must not duplicate.
- [x] 15.2 RED: `::test_party_mapping_keyed_by_year_jurisdiction_category_list_id` — the four-part key, never `agrupacion_id` alone.
- [x] 15.3 RED: `::test_same_party_across_three_id_spaces_resolves_to_one_canonical` — 135 (PASO 2023), 20135 (generales 2023) and 110 (2025) must resolve to one canonical party.
- [x] 15.4 RED: `::test_unverified_mapping_is_loaded_but_flagged` — `verified` is carried, not silently promoted.
- [x] 15.5 GREEN: `load_party_map_rows` in `etl/etl/db.py`, idempotent by natural key like `load_result_rows`.

### 15b — crosswalk loader

- [x] 15.6 RED: `::test_jurisdiction_crosswalk_rows_loaded_from_curated_yaml`.
- [x] 15.7 RED: `::test_mesa_crosswalk_carries_presence_per_year_and_stability_flag`.
- [x] 15.8 GREEN: `load_crosswalk_rows` in `etl/etl/db.py`, idempotent.

### 15c — CLI and reachability

- [x] 15.9 RED: `etl/tests/test_cli.py::test_load_curated_populates_every_curated_table` — the command must be reachable from the CLI, not merely importable. This project has shipped correct, tested, unreachable code seven times; this test exists to make the eighth impossible.
- [x] 15.10 GREEN: `load-curated` subcommand in `etl/etl/__main__.py`, alongside `fetch`, `ingest`, `validate-crosswalk` and `validate-curated`.
- [x] 15.11 GREEN: run it against the real curated files and record the resulting row counts per table in `spikes/005-curated-load.md`.

### 15d — resolve party names in the UI

- [x] 15.12 RED: `apps/web/src/lib/fiscalizacion/repository.test.ts::test_rows_carry_a_resolved_party_name_when_a_mapping_exists`.
- [x] 15.13 RED: `::test_unmapped_list_id_renders_as_unmapped_not_as_a_bare_number` — an unmapped list is surfaced as unmapped, never silently shown as a raw id.
- [x] 15.14 GREEN: join `party_mapping` in the repository read path so pages render party names.

## Phase 16: Three carried gaps

### 16a — `mesa_tipo` is not captured, and two mesas depend on it

Diagnosed live: in 2023 every NATIONAL category covers 151 mesas in Coronel Rosales while every
PROVINCIAL/MUNICIPAL one covers 153, consistently across PASO, generales and balotaje. The two
extra mesas are **9001 and 9002, `mesa_tipo = EXTRANJEROS`** — foreign residents registered in
the padrón de extranjeros vote in PBA provincial and municipal races but not in national ones.
That is a real electoral fact, not a data defect. But `mesa_tipo` is captured NOWHERE — not in
the ETL, not in any migration — so the database cannot tell a foreign-resident mesa from a
regular one, and a per-mesa cross-year comparison silently compares different mesa populations.

- [x] 16.1 RED: `etl/tests/test_ingest_national.py::test_mesa_tipo_is_captured_from_the_source`.
- [x] 16.2 RED: `::test_extranjeros_mesa_is_distinguishable_from_a_regular_mesa`.
- [x] 16.3 GREEN: carry `mesa_tipo` through `ingest_national` into `result_row`; migration `0011_mesa_tipo.sql` + down.
- [x] 16.4 RED then GREEN: `apps/web/src/lib/results/compare.test.ts::test_cross_year_comparison_flags_a_mesa_population_mismatch` — comparing a category whose mesa set differs between years MUST surface the difference, never average over it silently.

### 16b — `validate-crosswalk` zero-padding

Phase 15 fixed a padding mismatch in `collect_national_mesa_codes`: curated YAML uses zero-padded
DINE codes while the raw CSVs are unpadded, silently yielding zero matches. `validate-crosswalk`
was flagged as likely sharing it and was never verified.

- [x] 16.5 RED: a test proving `validate-crosswalk` finds a curated entry whose codes are zero-padded against unpadded source rows. If the bug is absent, record that plainly and close the item — do not manufacture a failure. CONFIRMED REAL — `etl/tests/test_cli.py::test_validate_crosswalk_resolves_unpadded_codes_against_zero_padded_curated_entries`.
- [x] 16.6 GREEN: apply `_normalize_administrative_code` on both sides — `find_unmapped_jurisdictions` in `etl/etl/__main__.py`.

### 16c — PBA municipal has no operator route

`curated/party_map.yaml` carries the `coronel_rosales_municipal` mappings (list 2206 =
LLA+PRO alliance) and Phase 15 loaded them, but only the national DIPUTADO NACIONAL read path
was wired. No page renders a municipal figure, so the mappings are unreachable — the same
tested-but-unreachable shape this change has hit eight times.

- [x] 16.7 RED: `apps/web/src/app/(authenticated)/municipal/page.test.tsx::test_route_renders_pba_municipal_results_with_resolved_party_names`.
- [x] 16.8 RED: `::test_distrito_granularity_is_labelled_never_presented_as_mesa` — the PBA municipal source publishes distrito totals; the indicator must say so.
- [x] 16.9 GREEN: create the route, reachable from the authenticated layout, reading only through the repository.

## Phase 17: One real jurisdiction, one row

Coronel Rosales exists as THREE separate jurisdiction identities in the loaded database, and
nothing joins them. Measured live:

| distrito_code | seccion_code | jurisdictions | rows | source |
|---|---|---|---|---|
| `02` | `027` | 94 | 1.395 | fiscalización |
| `027` | NULL | 1 | 23 | PBA official |
| `2` | `27` | 166 | 38.983 | national official |

Two distinct causes:
1. **Format.** The national ingest writes the raw CSV's unpadded `2`/`27`; fiscalización writes
   padded `02`/`027`. Same scheme, different padding, so the same mesa becomes two jurisdictions.
2. **Scheme.** PBA writes its own `distrito_code = 027`, which `jurisdiction_crosswalk` says maps
   to national `02`/`027`. The crosswalk is never consulted at ingestion, so PBA is its own island.

Consequences: the accepted mesa-identity join (93/93 injective, proven in the SPIKE) does not
actually happen in the data; the cross-year comparison only worked because the orchestrator
hand-wrote `distrito_code in ('02','2')`. An operator querying normally gets neither.

Root cause is the one already flagged in Phase 16: administrative codes are normalized
per-call-site instead of behind a single boundary. Two call sites were fixed; ingestion —
where jurisdictions are CREATED — never was.

- [x] 17.1 RED: `etl/tests/test_jurisdiction.py::test_padded_and_unpadded_codes_resolve_to_one_jurisdiction`.
- [x] 17.2 RED: `::test_pba_distrito_code_resolves_through_the_crosswalk_to_the_national_pair` — PBA `027` must land on the same jurisdiction as national `02`/`027`, not a third one.
- [x] 17.3 RED: `::test_an_uncurated_pba_code_is_quarantined_not_silently_written` — a PBA code with no crosswalk entry must not create an island; it is quarantined and surfaced.
- [x] 17.4 GREEN: normalize administrative codes at the single jurisdiction boundary (`make_result_row` / `db.upsert_jurisdiction`), so every writer goes through one place. Choose the curated padded form as canonical, since `curated/*.yaml` and `jurisdiction_crosswalk` already use it. **Deviation, disclosed: NOT applied inside `make_result_row` itself — `ingest.pba`'s pre-crosswalk-resolution distrito value is not yet a national code, and blindly zero-padding PBA's own `"027"` silently produced the WRONG code `"27"` (caught live via a real test regression). Normalization instead lives at `etl.db.upsert_jurisdiction`/`batch_upsert_jurisdictions` (the actual write boundary every path funnels through) and at `resolve_pba_distrito_code`'s translation output.**
- [x] 17.5 GREEN: resolve PBA distrito codes through `jurisdiction_crosswalk` during `ingest_pba`, before any jurisdiction is created.
- [x] 17.6 GREEN: migration `0012_reconcile_jurisdictions.sql` + down — merge duplicate jurisdictions that differ only by padding, repoint `result_row.jurisdiction_id`, and delete the emptied duplicates. It MUST NOT lose or duplicate a single result row; assert the total before and after.
- [x] 17.7 REFACTOR: verify live that Coronel Rosales resolves to ONE jurisdiction set, that fiscalización mesas join to national mesas, and record the before/after counts in `spikes/006-jurisdiction-reconciliation.md`.

## Phase 18: Fail-closed verification harness

- [x] 18.1 Refresh OpenSpec testing configuration around executable repository commands.
- [x] 18.2 Add `etl-verify` as the only release-safe ETL entry point: unique disposable database
  and role ownership, all migrations, zero skipped tests, and verified cleanup.
- [x] 18.3 Isolate the disposable verification role and prove database and role counts return to
  zero. Final observed result at `fae210d`: **19 migrations, 670 passed, 0 skipped**.

## Phase 19: Close the seven canonical evidence gaps

- [x] 19.1 Project archive provenance before ingestion (`8ff505d`).
- [x] 19.2 Expose PBA granularity degradation through the operator path (`c6f8ba0`).
- [x] 19.3 Classify fiscalización re-exports without misreporting source drift (`1b7a71b`).
- [x] 19.4 Preserve national establishment lineage (`bb97ae2`).
- [x] 19.5 Retain complete source-fetch history (`0a8c4d4`).
- [x] 19.6 Strip personal columns before parsing creates row values (`b57e61b`).
- [x] 19.7 Use exact statutory allocation arithmetic (`f9b80db`).

## Phase 20: Simulation provenance and validation

- [x] 20.1 Align canonical Hare eligibility with the statute (`9290451`).
- [x] 20.2 Require trusted archive provenance for historical simulations and supplied-input traces
  for hypothetical projections (`e639385`).
- [x] 20.3 Validate council composition before allocation (`15df6c8`).
- [x] 20.4 Preserve vote-evidence breakdowns through simulation results (`c9d501c`).

## Phase 21: Fail-closed web static gates

- [x] 21.1 Add ESLint 9 with the explicit `eslint . --max-warnings=0` command (`1801c73`).
- [x] 21.2 Keep TypeScript 7 as the application compiler while exposing the TypeScript 6 API only
  to typescript-eslint.
- [x] 21.3 Verify ESLint at **0 warnings/errors**, TypeScript 7.0.2, **325 web unit tests**, and a
  passing production build.

## Phase 22: Fail-closed browser release gate

- [x] 22.1 Add `pnpm test:e2e:gate` with exact inventory, disposable Supabase, production servers,
  zero-skip enforcement, signal-safe owned cleanup, and residue checks (`0fbd34d`).
- [x] 22.2 Cover all eight operator routes/specs, including root, review, simulation, and municipal
  reachability (`7c11314`).
- [x] 22.3 Observe **8/8 passed, 0 skipped, 0 failed** and zero owned infrastructure residue.
- [x] 22.4 Add the GitHub-hosted release workflow. It exists locally but has not yet run remotely.

## Phase 23: Final documentation handoff

- [x] 23.1 Record `fae210d` as the verified implementation boundary and retain the earlier
  verification and archive reports unchanged as historical evidence.
- [x] 23.2 Mark divergent archived spec copies as historical snapshots; canonical
  `openspec/specs` remains authoritative.
- [x] 23.3 Replace stale greenfield, RDD-on, 400-line-budget, and municipal D'Hondt handoff claims
  with current operational truth.
- [x] 23.4 Record the completed local delivery history and current fail-closed commands without
  claiming a push, pull request, or remote workflow execution.

## Key Learnings

1. The SPIKE's hard gates each remove or reshape specific downstream phases; gate (e)'s original DENY was itself later refuted by re-verification (Engram #1398), so tasks encode a conditional-pending-policy state for Phase 5 rather than a permanent removal.
2. Reading the statute directly (Ley 5109 Arts. 109–110 vs. Ley 19.945 Art. 161) overturned the single-`allocateDhondt` design premise: PBA levels use Hare quota + largest remainder, national uses D'Hondt — two algorithms, not one parameterised function (Engram #1399).
3. Council total (18) and seats-per-election (9) are easy to conflate because the per-election figure happens to match the previously-assumed total; the Hare cuociente's divisor is the per-election figure, so this is a correctness-critical, not cosmetic, distinction (Engram #1400).
4. Under strict TDD, a golden-case regression test with an unsourced input (the 2023 valid-vote denominator) must be modeled as an explicitly blocked test, never approximated from a total-votes figure that the statute itself says is the wrong basis.
5. D9's merge-then-validate ordering for fiscalización remains safety-critical: quarantining on an empty `Mesa` key destroys real votes, so task 6.2 stays sequenced strictly before collapse/quarantine tasks.
6. A JS `service_role` client is NOT automatically granted table access just because it bypasses RLS — `bypassrls` skips policy checks, not object-level `GRANT`/`REVOKE`, so a project whose writes only ever go through a raw superuser connection can carry an unnoticed `service_role` grant gap (Phase 11 e2e seeding).
