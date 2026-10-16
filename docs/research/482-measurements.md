# Issue #482 — remaining measurement evidence

## Latest follow-up: matched 2025 complete; PASO OFF disk-aborted

**Partial — do not close #482.** Revision `3d166b961c8a539e1cc6ea90d396a2634beda6d3`;
Python 3.13.12, macOS 26.4.1 arm64. No production changes, database access,
archive mutation, commits, or cleanup operations. The sections below this latest
follow-up are preserved prior evidence, not newly observed results.

Both requested test files initially passed unchanged: **8 passed in 0.27s**.
No production defect was revealed. Historical pre-optimization RED cannot be
reproduced honestly and was not manufactured. For the newly added disk guard,
a new test first failed with `KeyError: 'check_disk'`, then passed after implementation:
**9 passed in 0.21s**. Existing mutation claims below were not rerun in this follow-up.

### Fresh measurements

Values are **median [min, max]**, three fresh timed processes per completed variant.
Wall/CPU cover preflight plus emission, excluding extraction, imports, separate
completeness and untimed fingerprint hashing. RSS is interpreter-lifetime maximum
RSS in bytes, not phase-specific allocation. OS caches and competing workload were
uncontrolled. Variants ran sequentially, ON before OFF; no statistical significance
or production throughput claim is made. Disk polling every 10,000 emitted rows is
included equally in both variants. Parser retains global key state; source rows
are not materialized as a list.

| Metric | 2025 ON | 2025 OFF | PASO ON |
| --- | ---: | ---: | ---: |
| Wall seconds | 43.298503 [43.195079, 43.549879] | 59.579870 [49.157959, 73.078127] | 282.146675 [281.158861, 289.211602] |
| CPU seconds | 42.995455 [42.957291, 43.217341] | 52.944370 [48.765355, 60.629329] | 277.400081 [274.301950, 282.961356] |
| Max RSS bytes | 1207173120 [1202864128, 1212235776] | 1208647680 [1082130432, 1315864576] | 4096966656 [3634626560, 4634296320] |
| Rows each run | 2276730 | 2276730 | 16600877 |
| Parser scans / including completeness | 2 / 3 | 2 / 3 | 2 / 2 |

2025 observed median reductions: wall **27.33%**, CPU **18.79%** against the
measurement-local forced-sweep OFF counterfactual (not a historical release).
OFF variability is substantial; these are local observations, not generalizable
speedup guarantees. No meaningful RSS improvement established. PASO has no
companion catalogue, so completeness returns unavailable without an extra scan.

Raw fresh records:
- `482-2025-on-differential.json`
- `482-2025-off-differential.json`
- `482-paso-on-differential.json`

Source SHA-256 values match earlier records: 2025
`5fb19bb280af8895dc0bc2ac19d79e836fb4053b713a135357743bf35371ee4b`, PASO
`25558e7b73e8c273726ea12f04040e2fac8e693ad0eb866386502eb112bd2c0c`.

2025 ON/OFF ordered full-field rows, full completeness, metrics, status,
quarantine, completeness status, stderr, and explicit exclusion bucket records
are identical (canonical comparison recorded in final validation below).
Ordered rows SHA-256:
`e2d6d951b210ec845d798261214cf9a9ff91f9029d08bd39deb1e795653298d9`;
completeness SHA-256:
`dc05bc36844a04f3edd304268e8f90b193be62c4bbe206e56bcf610389fb9ebe`.
Explicit NO ESCRUTADO exclusions: **18,646**, split SENADOR NACIONAL **3,975**
and DIPUTADO NACIONAL **14,671**, all zero parseable votes/unreadable vote rows.
Seen/emitted: SENADOR 386,004/382,029; DIPUTADO 1,909,372/1,894,701.
Ambiguous-category and companion-conflict buckets are empty/zero in both variants.
PASO ON has zero exclusions in each of its ten categories; the JSON retains each
category's seen/emitted counts, internal lists and source indices enter the ordered
row digest. No PASO OFF fingerprint exists, so PASO parity is **not established**.
Parser-only status remains `failed`, `commit_returned=false` by metrics defaults,
with `first_pass=complete`, `iteration=complete`; it is not CLI failure evidence.

### Disk abort and retained extracts

Initial available space: 9,837,144 KiB. Extractions were retained and reused under
`docs/research/482-extracted-2025/` and `docs/research/482-extracted-paso/` to remain
inside the allowed write surface and avoid deletion. **These large public-source
extracts are not PR artifacts: parent must exclude them from commits.**
The benchmark verifies size/ZIP CRC before reuse, checks projected extraction
space, polls during extraction and every 10,000 emitted rows, and refuses below
2 GiB. It does not continuously sample disk or poll inside preflight/completeness.
PASO OFF first timed child raised `RuntimeError: STOP: free disk below 2 GiB
(including planned extraction)`; the parent runner exited nonzero and published
no OFF JSON. No completed OFF timing or fingerprint is claimed. Final `df -k .`
showed **1,063,592 KiB** available. No further measurements attempted. Concurrent
space consumption/swap was not diagnosed. Cleanup is parent-owned.

### Latest AC disposition

| AC | Verdict |
| --- | --- |
| 1. Differential entry-point RED before optimization | Existing CLI regressions pass; historical RED cannot be supplied retroactively; no new live DB rollback evidence. |
| 2. Fast path/minimal projection before fusion | Existing guarded sweep measured against same-contract forced sweep; production normalization/validation unchanged; no projection/fusion added. |
| 3. All fields/accounting/status parity | Complete canonical 2025 equality; PASO ON reference only, OFF missing. Failure/partial DB semantics not measured. |
| 4. Non-positive/NO ESCRUTADO analysis | No prefilter; unchanged sources; existing BLANCO EOF regression passes; full 2025 exclusion/category equality. No new independent non-positive coverage proof. |
| 5. Fusion RSS/error ordering | Not applicable: no fusion. |
| 6. Repeated matched CPU/wall/RSS/pass counts | Complete for 2025 with local wall/CPU improvement; PASO OFF aborted on disk floor, criterion not fully met. |
| 7. Reviewability/CLI lifetime/atomic publication | Production unchanged; CLI regression doubles pass; parser-only measurements establish no live DB durability. |

### Latest reproduction

All three successful measurements and the aborted fourth used the shared venv
Python, `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=.`, from `etl/`, invoking
`../docs/research/national-preflight-benchmark.py` directly (not the cleanup wrapper).
Arguments were `--archive /Users/nicolasmateoippoliti/dev/votus-plataforma-lla/archive/national/<archive>`
`--output ../docs/research/<output>` `--extracted-directory ../docs/research/<extract>`
`--source <source>` `--year <year>` `--round <round>` `--repetitions 3 --fast-path <variant>`:

| Archive | Output | Extract | Source | Year / round / variant |
| --- | --- | --- | --- | --- |
| 2025-legislativas.zip | 482-2025-on-differential.json | 482-extracted-2025 | national/2025-legislativas | 2025 / legislativas / on |
| 2025-legislativas.zip | 482-2025-off-differential.json | 482-extracted-2025 | national/2025-legislativas | 2025 / legislativas / off |
| 2023-paso-wayback.zip | 482-paso-on-differential.json | 482-extracted-paso | national/2023-paso-wayback | 2023 / paso / on |
| 2023-paso-wayback.zip | 482-paso-off-differential.json (not published) | 482-extracted-paso | national/2023-paso-wayback | 2023 / paso / off (aborted) |

### Latest final validation

- From `etl/`, with shared venv on PATH and `RUFF_NO_CACHE=true`:
  `ruff check . && ruff format --check .` — all checks passed; 104 files already formatted.
- From `etl/`: `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=. /Users/nicolasmateoippoliti/dev/votus-plataforma-lla/etl/.venv/bin/pytest -p no:cacheprovider tests/test_482_cli_preflight.py tests/test_482_measurement_runner.py`
  — **9 passed in 0.52s**.
- Read-only Python canonical JSON comparison of complete 2025 ON/OFF `parity`
  objects, archive SHA-256, and three repetitions each — **passed**.
- PASO OFF measurement command — **failed on required 2 GiB disk guard**;
  no retry, no published result, no PASO OFF parity claim.

## Preserved previous follow-up and earlier evidence

## Current-contract ON/OFF differential — prepared, execution pending

**Do not close #482 yet.** The helper now supports a measurement-only forced-sweep
counterfactual. Full-source ON/OFF execution and extraction cleanup belong to the
parent; this implementation task did **not** run either benchmark. Existing JSONs
and the earlier measurements below are preserved, not relabeled as differential data.

### Parent commands: 2025, three fresh processes per variant

Run sequentially from the repository root, using the same interpreter and read-only
archive. Outputs are exclusive-create; the following names must not already exist.

```sh
PYTHONDONTWRITEBYTECODE=1 /Users/nicolasmateoippoliti/dev/votus-plataforma-lla/etl/.venv/bin/python docs/research/482-run-measurements.py --archive /Users/nicolasmateoippoliti/dev/votus-plataforma-lla/archive/national/2025-legislativas.zip --output docs/research/482-2025-on-differential.json --source national/2025-legislativas --year 2025 --round legislativas --repetitions 3 --fast-path on
PYTHONDONTWRITEBYTECODE=1 /Users/nicolasmateoippoliti/dev/votus-plataforma-lla/etl/.venv/bin/python docs/research/482-run-measurements.py --archive /Users/nicolasmateoippoliti/dev/votus-plataforma-lla/archive/national/2025-legislativas.zip --output docs/research/482-2025-off-differential.json --source national/2025-legislativas --year 2025 --round legislativas --repetitions 3 --fast-path off
```

Each invocation extracts into its own `/tmp/votus-482-*` directory, records its exact
path in `extraction_directory`, runs three timed fresh children plus one untimed
fingerprint child, and the existing wrapper cleans its own extracts in `finally`.
Only the parent executes this cleanup-capable wrapper. It checks disk before extraction
and before each child, enforcing **3 GiB**, stricter than the 2 GiB floor; extraction
must also leave at least 3 GiB. It does not continuously monitor disk during a child:
the parent must monitor concurrent disk consumption and abort if free disk drops below
2 GiB. No PASO extraction is authorized under the recorded disk condition.

OFF uses `inspect.getsource` on the installed worktree's `iter_national_rows`, requires
exactly one match for the guarded loop, and compiles a measurement-local copy with
`for key, stats in stats_by_key.items():`. It does not patch production files or
change the actual ambiguity set, validation, normalization, emission, or completeness.
A changed guard causes an explicit refusal instead of an unmatched baseline.
ON uses the unmodified production iterator. Neither mode materializes source rows.

### Differential result placeholders

All cells below require fresh parent-run evidence. Values must be **median [min, max]**.
JSON `medians` and `ranges` contain these summaries.

| Metric | Fast path ON | Forced sweep OFF |
| --- | --- | --- |
| Wall seconds | PENDING | PENDING |
| CPU seconds | PENDING | PENDING |
| Peak RSS bytes | PENDING | PENDING |
| Emitted rows | PENDING (expected current contract: 2,276,730) | PENDING |
| Parser scans / total with completeness | PENDING (expected 2 / 3) | PENDING |

| Canonical fingerprint | Equality verdict |
| --- | --- |
| Ordered full-field dataclass rows, including names/source row indices | PENDING |
| Full completeness, including expected mesas/status/quarantines/exclusions | PENDING |
| Parser status, first-pass/iteration state, commit observation | PENDING |
| All metrics, including per-reason/per-category exclusions | PENDING |
| Completeness status and quarantine sub-fingerprints | PENDING |
| Exact exclusion breakdown and stderr report | PENDING |

The `parity` object contains all these digests plus explicit `status` and
`exclusion_breakdown` objects. The latter retains `exclusions`, `categories`,
`ambiguous_categories`, and `companion_conflicts`, not just a grand total (rule 3).
`status` is the raw parser-only metrics observation: its default `status="failed"`
and `commit_returned=false` do **not** represent a failed CLI run; no CLI/database
operation runs in this benchmark. `first_pass` and `iteration` show parser completion.
Do not claim database status/publication equivalence from this measurement.

After both commands, verify canonical byte equality of their entire parity records:

```sh
/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/etl/.venv/bin/python - <<'PY'
import json
from pathlib import Path
on = json.loads(Path('docs/research/482-2025-on-differential.json').read_text())
off = json.loads(Path('docs/research/482-2025-off-differential.json').read_text())
assert (on['fast_path'], off['fast_path']) == ('on', 'off')
for key in ('python', 'platform', 'source', 'archive_sha256', 'conditions'):
    assert on[key] == off[key], key
assert len(on['runs']) == len(off['runs']) == 3
assert on['archive_sha256'] == '5fb19bb280af8895dc0bc2ac19d79e836fb4053b713a135357743bf35371ee4b'
canonical = lambda value: json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(',', ':')).encode()
assert canonical(on['parity']) == canonical(off['parity']), 'fingerprint/accounting mismatch'
print('Canonical parity bytes equal; ordered rows and completeness SHA-256 equal.')
for name, result in [('ON', on), ('OFF', off)]:
    print(name, result['medians'], result['ranges'])
PY
```

This compares canonical fingerprints, not retained full-source row byte files; row
hashing streams every ordered field. Review raw per-reason/category buckets even when
the hashes match. Historical #525 timings emitted 1,608,120 rows; #541 changed the
contract to 2,276,730. They are not a matched baseline and imply no current speedup.

### PASO disposition

**Fast path applies to PASO computationally.** In `etl/etl/ingest/national.py:892–900`,
companion-circuit state is accumulated only when companion bytes exist. PASO has none,
so `ambiguous_companion_keys` is empty and line 928 skips every candidate-key conversion.
OFF would restore that sweep even for PASO, without changing its output. Lack of a
companion catalogue is therefore not evidence that the optimization cannot help PASO.

Observed free disk: **4,118,496 KiB = 3.93 GiB**, below the required **7 GiB**. PASO
ON/OFF differential **not run**. Existing three-run PASO measurements below remain
single-variant evidence only. Recheck disk before any later parent-run PASO experiment.

### CLI regression and mutation evidence

New tests: `etl/tests/test_482_cli_preflight.py`:

- `test_cli_eof_ambiguity_excludes_every_affected_candidate[duplicate|circuit|companion]`
  calls the real `etl.__main__.main` ingest dispatcher with a synthetic in-memory ZIP.
  EOF evidence removes every affected candidate; the independent mesa survives with
  its original source-row index. The companion case uses a BLANCO tail that is filtered
  as a result candidate but still participates in ambiguity analysis.
- `test_cli_late_metadata_conflict_rolls_back_complete_ingestion` drives the same
  entry point and real loader with one-row batches. Real name merging fails after
  two successful inserts; CLI rollback restores previous results, jurisdiction names,
  archive projection, receipt and completeness state. Commit must not occur.

These are in-process calls to the exact `python -m etl` main function, **not spawned
subprocesses**. Archive lookup/SQL/connection/receipts use deterministic boundary doubles;
ZIP streaming, parser, loader and name-conflict validation are real. They prove CLI
orchestration rollback behavior, not PostgreSQL durability or verified archive lookup.
No production implementation was changed, so pre-optimization historical RED cannot be
recreated. Instead, the requested differential mutation RED was observed:

1. Set the test-local `MUTATION` to `"eof"`: a parser wrapper seeks to the beginning
   then omits the final source evidence row, simulating classification before EOF.
   All **three EOF cases fail** on leaked mesa-1 rows (2/3 persisted rather than 1).
2. Set it to `"metadata"`: monkeypatch real name merging to accept incoming names
   unconditionally. The late-conflict test **fails** because main returns 0 instead
   of 1 and commits three rows.
3. Restore `MUTATION = None`: **16 focused tests pass**, including original preflight
   characterization and synthetic measurement-helper tests. Production files were
   never mutated. These are mutation RED results, not historical TDD claims.

The first test-harness run also caught an incorrect expected string mesa ID; it was
corrected to the actual integer identity before the meaningful mutation runs. An
initial EOF mutation failed two cases at schema validation due to stream position;
seeking to zero corrected that harness, and the recorded rerun failed all three on
leaked candidates as intended.

### Current verdict per acceptance criterion

| AC | Verdict for this follow-up |
| --- | --- |
| 1. EOF/late-conflict entry-point RED | CLI regressions and mutation RED added; historical before-optimization RED cannot be retroactively supplied; durability not established by doubles. |
| 2. Small fast path/shared validation before fusion | Preserved; OFF changes only the measurement-local sweep guard. No production projection/fusion added. |
| 3. Full-field/accounting/status parity | Helper ready and synthetic ON/OFF checks pass; full-source equality PENDING parent execution. |
| 4. Non-positive/NO ESCRUTADO analysis | No prefilter/production change. Filtered BLANCO EOF evidence covered; full-source fingerprints PENDING. |
| 5. Fusion RSS/error order | Not applicable: no fusion. |
| 6. Repeat CPU/wall/RSS/pass counts and demonstrated improvement | PENDING matched 2025 execution; PASO differential skipped for disk threshold. No speedup claimed. |
| 7. Reviewability/CLI lifetime/atomic boundary | Production unchanged; CLI streaming and rollback tested with boundary doubles. Live database durability remains unverified. |

### Follow-up validation

The requested worktree-local `../etl/.venv/bin/python` runner is absent (exit 127).
Used the explicitly supplied main-checkout interpreter instead. Focused command:

```sh
cd etl && PYTHONDONTWRITEBYTECODE=1 /Users/nicolasmateoippoliti/dev/votus-plataforma-lla/etl/.venv/bin/python -m pytest -q -p no:cacheprovider tests/test_482_cli_preflight.py tests/test_482_measurement_runner.py tests/test_national_preflight.py
```

Final focused result: **16 passed in 0.27s**. Ruff check: **All checks passed**.
Ruff format check: **3 files already formatted**. Exact root-level commands:

```sh
/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/etl/.venv/bin/python -m ruff check --no-cache etl/tests/test_482_cli_preflight.py etl/tests/test_482_measurement_runner.py docs/research/national-preflight-benchmark.py
/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/etl/.venv/bin/python -m ruff format --no-cache --check etl/tests/test_482_cli_preflight.py etl/tests/test_482_measurement_runner.py docs/research/national-preflight-benchmark.py
```

Initial Ruff checks found import ordering, stale E402 suppressions and a misplaced
S102 suppression after formatting. Imports/suppressions were corrected; the remaining
S102 suppression is narrowly scoped to compiling trusted checked-in measurement code.
Ruff checks above were rerun successfully after those fixes. No full-source benchmark,
full suite, database connection, commit, or git write was performed by this worker.

## Earlier single-variant measurement record

The following is preserved prior evidence, not a record of this follow-up's execution.

## Disposition

**Partial: do not close #482 on this evidence alone.** Full unchanged 2025 and PASO
parser repeat measurements are now available. They do not establish a new before/after
speedup or live CLI/database atomic-publication parity. The disposable database setup
probe fails before ingestion with the exact connection blocker below.

Measured revision: `65543448b13495e417b24e6e5fa378de96867f9e` on
`perf/482-measurements`. Production ETL code was not changed. Raw outputs:
[`482-2025-measurements.json`](482-2025-measurements.json) and
[`482-paso-measurements.json`](482-paso-measurements.json).

## Environment and method

- Apple M4, 10 logical CPUs, 17,179,869,184 bytes RAM (16 GiB).
- macOS 26.4.1 arm64; Python 3.13.12 from
  `/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/etl/.venv/bin/python`.
- Running local container `supabase_db_votus-plataforma-lla`: PostgreSQL 17.6.
  Parser measurements do **not** use PostgreSQL. DB resource limits are not measured.
- Three sequential fresh interpreters per source; uncontrolled/warm OS cache.
  No instrumented per-row metrics during timed runs. A fourth, untimed process computes
  ordered full-field row, completeness, metrics and stderr SHA-256 fingerprints.
- Wall and process CPU cover parser iteration (preflight plus emission), excluding
  extraction, imports, separate completeness and fingerprint hashing. RSS is macOS
  `resource.getrusage(RUSAGE_SELF).ru_maxrss`, in bytes: interpreter-lifetime high-water
  RSS, not a phase-specific allocation measurement. Completeness RSS/CPU/wall are not
  separately measured, and these numbers are not whole CLI ingestion timings.
- Existing runner streams ZIP extraction and emitted rows; it does not retain a full
  source row list. Parser global natural-key state remains source-sized: do not call
  this constant-memory. The small 2025 companion is read into memory as before.
- Archives were opened read-only. Both measured SHA-256 values match the existing
  source evidence. No extraction/recompression or source filtering changes.
- Disk checked before each timed process and the untimed fingerprint process. Initial
  free space was 6.3 GiB. After 2025 cleanup, available space increased independently
  to 7.1 GiB, making PASO feasible. PASO extraction required 3,756,022,182 bytes;
  projected free space was 3,866,572,378 bytes. Observed pre-child checks stayed at
  3.6 GiB or above. No below-3-GiB condition was observed. No continuous disk sampler
  was used. Task-owned extracts `/tmp/votus-482-71w3_zvx` and
  `/tmp/votus-482-g2bacfrv` were removed in `finally`; no unrelated files were removed.

## Results

Values are **median [minimum, maximum]**, three runs per source.

| Metric | 2025 legislativas | 2023 PASO |
| --- | ---: | ---: |
| Wall seconds | 46.576415 [45.210461, 47.640326] | 291.926590 [286.143788, 322.249238] |
| CPU seconds | 46.456484 [45.054432, 47.533772] | 281.153240 [279.338297, 302.681840] |
| Peak RSS bytes | 1,314,881,536 [1,314,766,848, 1,315,160,064] | 3,909,910,528 [3,798,155,264, 3,941,859,328] |
| Emitted rows, every run | 2,276,730 | 16,600,877 |
| Result CSV parser scans | 2 | 2 |
| Total result CSV scans with separate completeness | 3 | 2 |

PASO has no companion catalogue; `build_national_completeness` returns unavailable
without reading results. Two scans therefore do **not** imply completeness fusion.
Counts are all emitted vote kinds, not just positive votes.

Source hashes:

- 2025: `5fb19bb280af8895dc0bc2ac19d79e836fb4053b713a135357743bf35371ee4b`
- PASO: `25558e7b73e8c273726ea12f04040e2fac8e693ad0eb866386502eb112bd2c0c`

The raw JSON files retain all individual timings/RSS and full fingerprint digests.
Fingerprints are **current-revision references**, not a differential comparison:
only one untimed fingerprint pass was run per source. Fingerprint metrics exclude
reason/category data loss accounting from timed-run overhead, but no fresh independent
per-category accounting audit was performed here.

### Why historical speedup percentages are not reused

`national-preflight-482.md` reports 1,608,120 emitted 2025 rows. Current runs emit
2,276,730; PASO now emits 16,600,877 rather than the historical positive-only
13,627,397. History includes subsequent non-positive persistence work:
`b21f04e feat(etl): persist non-positive vote kinds from national ingestion (#541)`.
Comparing these timings would mix different output contracts. No matched current-contract
pre-optimization baseline was run, so **no new speedup percentage is claimed**.

## Disposable database blocker

Credentials were obtained in memory using `supabase status -o env` in the main
checkout, without printing its output. Documentation connection shape only:
`postgresql://postgres:<local>@127.0.0.1:54322/...`.

`482-probe-database.py` uses repository `DisposablePostgres` and `clone_schema`,
then would call `grant_test_privileges`. Two setup attempts both failed at
`clone_schema`, before grants or ingestion. The first printed only the exception
class; the second captured the redacted diagnostic:

```text
pg_dump: error: connection to server on socket "/tmp/.s.PGSQL.5432" failed: No such file or directory
        Is the server running locally and accepting connections on that socket?
```

Observed exception: `CalledProcessError`. `clone_schema` calls `pg_dump` with
`--format=custom --schema-only --no-owner --schema=public --schema=workspace_api
--schema=workspace_private`, places a connection-info string in `PGDATABASE`, and
passes no `--dbname` connection argument. The client attempted its default local
socket, not the supplied loopback port 54322. This is the observed blocker, **not**
an established fixture-ownership failure. `docs/research/jurisdiction-index.md`
is absent in this checkout. No fixture ownership was changed or failure invented.
Both probe contexts exited via the tooling's cleanup path without a reported cleanup
exception. No shared database objects were modified and the container was not stopped
or reset. Live CLI ingestion, full database fingerprints and rollback were not run.

PASO DB ingestion also cannot safely be budgeted from current disk: existing
`paso-scale-evidence.md` reports first-load disk growth up to 11 GiB, beyond this
host's 7.5 GiB observed after extraction cleanup. Parser-only PASO measurements fit.

## Acceptance criteria, one by one

1. **“Produce differential RED entry-point tests before optimizing: ambiguities
   discovered at EOF still exclude every affected duplicate/circuito/companion
   candidate; a late jurisdiction metadata conflict still fails and rolls back the
   complete ingestion.”** Historical tests are described in
   `national-preflight-482.md`; no fresh RED is appropriate for this measurement-only
   task and none is claimed. That report explicitly limits rollback evidence to a
   transactional double. Live CLI/database differential coverage remains unverified.
2. **“Investigate the empty-ambiguity fast path and minimal preflight projection
   before more invasive pass fusion; use one normalization and validation boundary.”**
   Existing rationale documents the fast path and deferred projection. No parser,
   normalization or validation change in this task.
3. **“Preserve every emitted field, source row index, name, PASO internal list,
   exclusion reason/category and partial/failure metric semantics; compare ordered
   rows and completeness/status/quarantine fingerprints.”** Fresh full-source ordered
   row and completeness/accounting fingerprints recorded for both sources, but no
   matched baseline comparison. Live persistence and partial/failure semantics remain
   unverified. The historic fingerprints cannot establish current-contract parity.
4. **“Include non-positive-only or NO ESCRUTADO mesas in completeness and ambiguity
   analysis as required by current contracts; do not prefilter rows just to accelerate
   parsing.”** Unchanged archives and unchanged parser measured; no prefilter added.
   Prior characterization evidence remains as documented; fresh measurements alone
   do not independently prove the non-positive/NO ESCRUTADO contract.
5. **“For any completeness/preflight fusion, measure simultaneous accumulator RSS
   and define error ordering; removing one scan does not imply lower peak memory or
   elimination of all completeness work.”** Not applicable: no fusion implemented.
   2025 still performs three scans. Reported RSS is not simultaneous fused-accumulator
   RSS and no such claim is made.
6. **“Measure CPU/wall/RSS and pass counts on unchanged 2025 and PASO sources, with
   repeat runs. Accept only a demonstrated improvement without full-source row
   materialization.”** Repeat measurement portion completed above. Streaming runner
   retained. Demonstrated current-contract improvement remains outstanding without
   a matched pre-optimization baseline.
7. **“Keep candidate changes reviewable and preserve the real CLI/archive lifetime
   and atomic publication boundary.”** Only research evidence/helpers added. Production
   entry point unchanged. Live CLI/archive atomic publication verification blocked at
   disposable schema setup; parser-only evidence does not substitute for it.

## Exact commands and reproduction

Environment inspection (repository root):

```sh
git status --short && df -h / && sysctl -n machdep.cpu.brand_string hw.ncpu hw.memsize && docker exec supabase_db_votus-plataforma-lla postgres --version
git rev-parse HEAD
```

PASO command actually executed (repository root):

```sh
df -h / && cd etl && PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=. /Users/nicolasmateoippoliti/dev/votus-plataforma-lla/etl/.venv/bin/python ../docs/research/482-run-measurements.py --archive /Users/nicolasmateoippoliti/dev/votus-plataforma-lla/archive/national/2023-paso-wayback.zip --output ../docs/research/482-paso-measurements.json --source national/2023-paso-wayback --year 2023 --round paso --repetitions 3
```

The wrapper prints/runs `df -h /` before each subprocess and raises below 3 GiB;
checks ZIP-directory extraction size against the reserve; intercepts only the runner's
subprocess and temp-directory calls; always cleans its own extracts. Output uses
exclusive-create: choose a new output name for reruns, do not overwrite raw evidence.

DB setup command actually executed twice (repository root):

```sh
df -h / && cd etl && PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=. /Users/nicolasmateoippoliti/dev/votus-plataforma-lla/etl/.venv/bin/python ../docs/research/482-probe-database.py
```

Exact 2025 command actually executed, before the reusable wrapper was saved:

```sh
df -h / && cd etl && PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=. /Users/nicolasmateoippoliti/dev/votus-plataforma-lla/etl/.venv/bin/python - <<'PY'
import runpy, shutil, subprocess, sys, tempfile
from pathlib import Path
created = []
original_mkdtemp = tempfile.mkdtemp
original_check_output = subprocess.check_output
def checked(*args, **kwargs):
    subprocess.run(['df', '-h', '/'], check=True)
    if shutil.disk_usage('/').free < 3 * 1024**3:
        raise RuntimeError('STOP: free disk below 3 GiB')
    return original_check_output(*args, **kwargs)
def owned(*args, **kwargs):
    path = original_mkdtemp(*args, **kwargs)
    created.append(path)
    return path
subprocess.check_output = checked
tempfile.mkdtemp = owned
sys.argv = ['../docs/research/national-preflight-benchmark.py', '--archive', '/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/archive/national/2025-legislativas.zip', '--output', '../docs/research/482-2025-measurements.json', '--source', 'national/2025-legislativas', '--year', '2025', '--round', 'legislativas', '--repetitions', '3']
try:
    if shutil.disk_usage('/').free < 3 * 1024**3:
        raise RuntimeError('STOP: free disk below 3 GiB')
    runpy.run_path(sys.argv[0], run_name='__main__')
finally:
    for path in created:
        if Path(path).parent == Path('/tmp') and Path(path).name.startswith('votus-482-'):
            shutil.rmtree(path)
            print('Removed task-owned extraction:', path)
PY
```

## Test discipline and limits

No production behavior changes: strict TDD RED/GREEN is inapplicable to measurement
collection. No historical RED or test pass is represented as newly observed. Functional
verification consists of the actual full-source runner executions (three timings plus
one fingerprint process per source), successful JSON publication, and DB probe failures.
No broad test suite, dependency installation, commit, push or hosted access was performed.
