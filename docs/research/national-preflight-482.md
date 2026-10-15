# National preflight: issue #482 measurements

## Result and boundary

Retain only the empty-ambiguity fast path. Three fresh-process runs per revision
show lower median CPU and wall time on the registered 2025 archive; this is a
local observation, not a controlled causal estimate or PASO-wide speedup.
No pass fusion or minimal-projection refactor was implemented.

| Median | Before | After |
| --- | ---: | ---: |
| wall seconds | 70.084905 | 52.613605 |
| CPU seconds | 57.263462 | 44.543714 |
| peak RSS bytes | 745537536 | 818511872 |

Wall improved 24.9%; CPU improved 22.2%. Median peak RSS increased 9.8%.
Individual runs are noisy (before wall 49.9–94.2s, after 34.6–58.8s).
The change removes no retained state; do not claim a memory improvement.

## Exact conditions and reproduction

From this worktree's `etl/`, use Python
`/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/etl/.venv/bin/python`
(version 3.13.12, macOS 26.4.1 arm64):

```text
python ../docs/research/national-preflight-benchmark.py --archive /Users/nicolasmateoippoliti/dev/votus-plataforma-lla/archive/national/2025-legislativas.zip --output ../docs/research/national-preflight-before.json --source national/2025-legislativas --year 2025 --round legislativas --repetitions 3
```

After the production edit, repeat identically with output
`../docs/research/national-preflight-after.json`. JSON outputs contain every run,
source SHA-256, conditions, medians, and fingerprints. The script creates outputs
exclusively, so choose a new output filename for a subsequent experiment.
ZIP input is read-only; extracted public CSVs remain under `/tmp/votus-482-*`.
No full-source row list is retained. Extraction/imports are excluded from timings;
fresh child processes run sequentially with uncontrolled/warm OS cache, no DB,
no per-row metrics in timed runs. A separate untimed child computes fingerprints.

Every run emits 1,608,120 rows and scans results twice; separate completeness
adds a third results scan. Before/after ordered full-field row, completeness
(including statuses/quarantines), metrics, and stderr SHA-256 fingerprints match.
The archive SHA-256 matches the issue's registered source.

## Characterization and test-first evidence

Before editing production code, `pytest -q tests/test_national_preflight.py`
reported six passing characterizations and two intended failures: the empty-set
observable counted two unnecessary companion key conversions rather than zero,
with and without a companion. After the fast path all eight pass.

Fixtures cover EOF duplicate and circuito ambiguity (including blank-only and
NO ESCRUTADO evidence), ordered rows/source indices, complete dataclass fields,
PASO internal lists, completeness/status/quarantine/accounting fingerprints, and
late metadata conflict after earlier loader batches. The rollback test uses the
real loader and metadata merge boundary with a transactional double, not live
Postgres durability or the CLI archive/publication boundary.

Minimal projection was investigated: `_candidate_from_raw` currently shares all
filtering/validation between passes but allocates ResultRow, JurisdictionNames,
and NationalRow in preflight. Removing those allocations would change its return
contract or require a split validation/projection boundary. That additional
refactor is deferred in favor of the smallest measured change. No rows were
prefiltered and no normalization boundary changed.

## Validation and remaining issue acceptance work

- Focused tests: 8 passed.
- Full ETL: 2001 passed, 6 skipped, 23 known privileged-fixture setup errors,
  **two additional failures**: CLI completeness persistence encounters an existing
  expected-mesa primary key, and municipal ingest encounters existing conflicting
  jurisdiction metadata. These were not established as baseline failures and must
  not be represented as passing validation.
- Ruff check and format check pass after correcting the resumed fixture's bytes
  literal and formatting the production change.
- Web typecheck, 2049 tests across 99 files, and lint pass. Invoking the authorized
  pnpm typecheck unexpectedly populated node_modules from the local package store;
  no dependency edits were requested.
- Full unchanged PASO-source repeat benchmarks remain outstanding. Only fixture
  parity for PASO is covered here; issue #482 is not ready to close.
- CLI/live-DB differential atomic-publication coverage remains stronger follow-up
  work than the transactional loader double delivered here.
