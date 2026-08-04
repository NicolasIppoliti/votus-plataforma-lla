# Verification Report: electoral-analysis-platform

> Phase: `sdd-verify` (RE-VERIFICATION #2 — confirms the W1 fix, replaces the prior report in full)
> Date: 2026-08-04
> Verdict: **PASS WITH WARNINGS** (known debt only; nothing blocks archive)

## 0. Why this report replaces the prior one

The prior report (also PASS WITH WARNINGS, ready-to-archive) carried one open defect, W1:
`validate-crosswalk` and `validate-curated` crashed with `UnicodeDecodeError` on the real archived
national ZIP, because `collect_national_jurisdiction_codes`/`collect_national_party_keys` in
`etl/etl/__main__.py` handed raw archived bytes straight to `ingest_national` instead of routing
through `resolve_national_results_bytes` first (the way `cmd_ingest` correctly does).

That defect is now fixed, commit `3da52da` (`fix(etl): unzip archived sources in the validate
commands`). This report re-derives nothing else from scratch: it confirms the fix by source read
and live execution, re-runs every gate, checks for regressions, and re-confirms every other item
from the prior pass still holds.

## 1. Task completeness

`tasks.md`: **0** unchecked `- [ ]` boxes, **174** `- [x]` boxes, 14 phases — unchanged from the
prior pass (the W1 fix was a post-Phase-14 correction, not a new task). Working tree clean except
this report file and `test-results/` (both expected, no implementation files touched by this
verification pass). Current branch `slice-18d-full-corpus`, HEAD `3da52da`, no remote.

## 2. The W1 fix — confirmed by source read AND live execution against the real archive

### 2.1 Source read
`etl/etl/__main__.py`: both `collect_national_jurisdiction_codes` (line ~334) and
`collect_national_party_keys` (line ~402) now wrap the raw archived bytes with the same
`resolve_national_results_bytes(raw_bytes, extract_dir=...)` call that `cmd_ingest` already used,
via a `tempfile.TemporaryDirectory`, before passing the result to `ingest_national`. Both helpers
are called from `cmd_validate_crosswalk` / `cmd_validate_curated` respectively — genuinely wired to
the CLI entrypoints, not orphaned. `tempfile` and `Path` were already imported at module level; no
new import gap.

### 2.2 New test
`test_collect_functions_read_a_real_zipped_archive_entry` (in `etl/tests/test_cli.py`) builds a
real ZIP archive entry on disk and drives both `collect_national_jurisdiction_codes` and
`collect_national_party_keys` through it end-to-end, asserting non-crash and non-empty results.
This closes the exact gap the prior report identified: the four pre-existing tests for these two
commands all bypassed the archive-reading path, calling `find_unmapped_jurisdictions`/
`find_unmapped_parties` directly with hand-built lists. Ran it in isolation: **1 passed**.

### 2.3 Live execution against the real, now-reloaded corpus (this pass, not repeated from disclosure)
After a full `supabase db reset` and fresh re-ingest of all three sources (see §3), ran both
commands myself against the real archived national ZIP:

```
$ uv run python -m etl validate-crosswalk
unmapped jurisdiction: 7/6 -- no curated crosswalk entry for distrito='7' seccion='6'
... (many more, nationwide distrito/seccion pairs)
exit 0

$ uv run python -m etl validate-curated
unmapped party: year=2025 jurisdiction=national category=SENADOR NACIONAL list_id=284 -- ...
... (many more, nationwide list_ids)
exit 0
```

Both commands now complete successfully (exit 0) instead of crashing. The reported unmapped
jurisdictions/parties are expected and correct, not a new defect: the curated crosswalk/party-map
tables in this project only cover Coronel Rosales (the fiscalización pilot jurisdiction), while the
national ZIP covers the entire country — so nationwide `validate-*` runs are supposed to report
most of the country as unmapped. This is the commands doing their job correctly for the first time
against real data. **W1 is CLOSED.**

## 3. Runtime evidence — every gate re-run live this pass

| Command | Result | Expected | Match |
|---|---|---|---|
| `cd etl && uv run pytest` | **126 passed** | 126 passed | PASS |
| `cd apps/web && pnpm vitest run` | **58 passed** (15 files) | 58 passed | PASS |
| `cd apps/web && pnpm exec tsc --noEmit` | clean, exit 0 | clean | PASS |
| `supabase db reset` then `supabase test db` | **22/22** pgTAP from a pristine reset | 22/22 | PASS |
| `pnpm exec playwright test` | **3 passed, 1 skipped** | 3 passed, 1 skipped | PASS |
| Re-ingest national/2025-legislativas | 1,621,111 rows, **57.5 s wall-clock** | ~57–59 s (batched) | PASS |
| Re-ingest pba/2025-distrito-027 | 23 rows | 23 rows | PASS |
| Re-ingest fiscalizacion/2025-coronel-rosales | 1,395 rows | 1,395 rows | PASS |
| `validate-crosswalk` against real archive | exit 0, nationwide unmapped list (expected) | runs, no crash | PASS (was CRASH before) |
| `validate-curated` against real archive | exit 0, nationwide unmapped list (expected) | runs, no crash | PASS (was CRASH before) |
| `select source_kind, granularity, count(*), sum(votes) from result_row group by 1,2` | matches prior pass exactly (below) | — | PASS |

```
  source_kind  | granularity |  rows   |  votes
---------------+-------------+---------+----------
 fiscalizacion | mesa        |    1395 |    20294
 official      | distrito    |      23 |    63781
 official      | mesa        | 1621111 | 28196825
```

pytest went from 125 → **126** passed, the exact +1 expected from the new
`test_collect_functions_read_a_real_zipped_archive_entry` test — no unrelated count drift. All
other gates match the prior pass's numbers exactly. No regression found anywhere in this pass.

## 4. Per-capability status across the 9 specs — compact, only what changed

The deep per-requirement pass (48 requirements / 86 scenarios across `source-archive`,
`jurisdiction-model`, `electoral-ingestion`, `party-identity-mapping`, `results-analysis`,
`seat-simulation`, `access-control`, `provenance-display`, `fiscalizacion-analysis`) was already
completed in the prior report and is not re-derived line by line here — none of those capabilities'
implementation code changed in commit `3da52da`. The only capability status that changes:

- **`electoral-ingestion`** — previously "COVERED, now with a real-data proof" but carrying a
  named gap ("the one gap this capability still carries: `validate-crosswalk` and
  `validate-curated` — a newly-confirmed defect"). That gap is now closed: both commands are
  genuinely exercised against real archived data and complete successfully. **Upgraded to fully
  COVERED, no residual gap.**

All other 8 capabilities: unchanged verdicts from the prior pass, all COVERED, re-confirmed live
this pass only insofar as their existing test suites re-ran green (pytest 126/126, vitest 58/58,
Playwright 3/1, pgTAP 22/22) with no code changes to their implementation.

## 5. The three leakage guards — unaffected by this fix, re-confirmed passively

`3da52da` touches only `collect_national_jurisdiction_codes`/`collect_national_party_keys` and
their test file — no leakage-guard code path. All three guards (default-query filter, aggregate,
rendered page) are unchanged from the prior pass's confirmation. No re-derivation needed.

## 6. Non-goal violations — unaffected by this fix

The fix adds no new source, no new personal-data-adjacent code, no new role, no OCR, no scraping
path. All 6 non-goals remain correctly unviolated, unchanged from the prior pass.

## 7. Standing instruction — searched for a sixth "tested but unreachable/broken" bug

This project has shipped correct, tested, unreachable code five times previously. Specifically
checked the W1 fix itself for the same failure shape:

- **Is `resolve_national_results_bytes` actually reachable from the two collect functions?**
  Confirmed by source read: both call sites now unconditionally wrap the raw bytes before calling
  `ingest_national`, not gated behind any dead branch.
- **Does the new test actually exercise the fixed code path, not a parallel pure function?** Yes —
  `test_collect_functions_read_a_real_zipped_archive_entry` calls
  `collect_national_jurisdiction_codes`/`collect_national_party_keys` directly (the exact functions
  that were broken), building a real ZIP on disk, not a hand-built list like the four pre-existing
  tests. Confirmed by running it in isolation: 1 passed.
  - **Are `collect_national_jurisdiction_codes`/`collect_national_party_keys` themselves called
  from the CLI entrypoints (`cmd_validate_crosswalk`/`cmd_validate_curated`)?** Confirmed by grep:
  yes, both are called, not orphaned.
- **Live confirmation, not just test-level**: ran both CLI commands myself against the real,
  reloaded national archive after this pass's `supabase db reset` + re-ingest — both completed
  (exit 0) with correct, plausible output (nationwide unmapped jurisdictions/parties, matching the
  known Coronel-Rosales-only curated-table scope).

**No sixth instance found this pass.** The fix is minimal (12 lines in `__main__.py`, reusing an
already-tested, already-used helper function), genuinely wired to its CLI entrypoints, and
genuinely tested through the previously-untested path — the opposite shape of the project's
recurring defect, not a repeat of it.

## 8. Debt being carried forward — explicit and complete

This is the full list of everything still open after this change. Nothing below blocks archive;
all of it is legitimate follow-up debt for a future change.

1. **`comparison.spec.ts` self-skips** on the missing local `service_role` GRANT. Confirmed again
   this pass: `pnpm exec playwright test` produced 3 passed, 1 skipped, same skip message as the
   prior two passes (local `service_role` has no table GRANTs — writes only ever go through
   `etl_writer`/raw `postgres` per D8). The property this spec would prove (mixed-granularity
   comparison flagging) is otherwise only unit-tested, not proven at real-HTTP level locally.
   Unchanged, unfixed, correctly disclosed rather than silently passing.

2. **D9.5 — PBA/fiscalización-to-national jurisdiction crosswalk remains unresolved.**
   `jurisdiction_crosswalk` table confirmed **empty (0 rows)** this pass, queried live against the
   freshly reloaded corpus. `curated/crosswalk.yaml`'s `fiscalizacion_mesa_identity` section is a
   **separate**, narrower, already-accepted decision (mesa-identity-within-distrito/seccion,
   "same-id-only, not exact-value-verified") — it does not close this gap. PBA and fiscalización
   result rows cannot currently be joined to the national jurisdiction hierarchy for cross-source
   comparison. This is the one item most likely to need its own follow-up change if cross-source
   comparison across PBA/fiscalización and national results is ever required.

3. **S1 (unchanged, still open, non-blocking)**: no test drives the exported `FiscalizacionPage`
   React Server Component itself with `searchParams` containing `compare*` query params end-to-end
   (neither vitest nor `fiscalizacion.spec.ts` exercises the comparison query-string path — the
   Playwright spec only asserts the no-params refusal state). The reachability defect that
   previously hardcoded `comparison: undefined` is closed (verified in the prior pass); the
   specific HTTP-level juxtaposition scenario is still proven only by composing two
   independently-tested units, not by one end-to-end test.

4. **S3 (unchanged, still open, non-blocking)**: no committed CI job or one-command local setup for
   the fixture Supabase `service_role` GRANT — item 1 above depends on manual local credential/grant
   population, which is why it self-skips rather than runs.

5. **The full-corpus personal-data sweep (12 column-pairs, 0 hits)** was performed in an earlier
   session and has not been independently re-run since — accepted as still-valid evidence given the
   corpus composition is unchanged (re-ingested from the same sources, same row counts), not
   re-derived this pass to avoid unnecessary re-handling of real names.

Nothing regressed. Every item above is a carry-forward of prior, already-disclosed debt — none of
it is new to this pass, and W1 (the only genuinely new finding from the prior pass) is now closed.

## 9. Design coherence — unaffected

`3da52da` does not touch any of the 10 ADRs' subject matter (fetch etiquette, leakage guards,
election scoping, credential handling, batching, etc.). No re-derivation needed; prior pass's
conclusions stand.

## 10. Issues

**CRITICAL**: none.

**WARNING**:
- W2 (renumbered from prior W2): `comparison.spec.ts` still self-skips on the missing local
  `service_role` GRANT (§8.1).
- W3 (renumbered from prior W3): PBA/fiscalización crosswalk join to national jurisdictions remains
  unresolved — D9.5's known-unverified state, `jurisdiction_crosswalk` table empty (§8.2).

(Prior W1 — `validate-crosswalk`/`validate-curated` crashing on real data — is CLOSED, confirmed
by live execution this pass, §2.3.)

**SUGGESTION**:
- S1: Add a test that drives `FiscalizacionPage` itself (or the real `/fiscalizacion` route via
  Playwright) with `compare*` query params, so the juxtaposition scenario is exercised end-to-end
  rather than by composing two independently-verified units (§8.3).
- S3: Provision a committed CI job or one-command local setup for the fixture Supabase
  `service_role` GRANT, so `comparison.spec.ts` (W2) stops depending on manual credential/grant
  population.
- S4: Record `curated/crosswalk.yaml`'s D9.5 PBA/national-jurisdiction gap as an explicit, named
  follow-up change if cross-source comparison across PBA and national results is ever required by a
  future capability.

(Prior S2 — "fix `collect_national_jurisdiction_codes`/`collect_national_party_keys` to unzip
before decoding... and add a regression test" — is DONE, closed by commit `3da52da`.)

## 11. Final verdict

**PASS WITH WARNINGS. Ready to archive.** The one defect (W1) this report's predecessor carried as
open is fixed and independently re-confirmed: source read shows the two `collect_*` helpers now
correctly route archived bytes through `resolve_national_results_bytes` before decoding, exactly
mirroring `cmd_ingest`; the new test drives the actual previously-broken functions through a real
zipped entry (not a hand-built list, unlike the four pre-existing tests); and both CLI commands were
run live by me against the real, freshly reloaded national/PBA/fiscalización corpus and completed
successfully (exit 0) with plausible, correct output. pytest count moved 125 → 126, the exact
expected delta. Every other gate matches the prior pass exactly with no regression: 58/58 vitest,
tsc clean, 22/22 pgTAP from a pristine reset, 3 passed/1 skipped Playwright, and the identical
three-row `result_row` composition after a full reset and re-ingest. No sixth instance of this
project's recurring "tested but unreachable/broken" defect shape was found in the fix itself — the
opposite is true: the fix specifically targets and closes that exact failure mode. Zero CRITICAL
issues. Two WARNINGs carry forward unchanged and undiminished (`comparison.spec.ts` skip, D9.5
crosswalk gap) — both pre-existing, both honestly disclosed, neither blocking archive. Full debt
list for the next person is in §8.
