# Observe one national ingestion

Add `--metrics-output /existing/writable/directory/new-report.json` to the existing
`python -m etl … ingest …` invocation. Only registered **national official** sources
are supported. Without the option, ingestion output, return values and data flow
are unchanged; `ingest_source` still returns an integer.

## File and failure contract

The destination must be new, outside the immutable archive root, and distinct from
source-registry, manifest, crosswalk and party-map inputs. Existing files (including
symlinks) are never overwritten; parent directories are not created. The file is
reserved exclusively before ingestion. Use a directory you control throughout the run.

One JSON object is written after ingestion unwinds, including on ordinary failures.
Publication is outside transaction handling. Publication failure returns an error
(or preserves an already-propagating ingestion exception) and reports the observed
`commit_returned` fact on stderr. It never initiates rollback. An ingestion success
line alone does **not** prove report publication succeeded. Publication is not atomic:
interruption or write/sync failure can leave an empty, incomplete or unsynced file.

## Version 1 fields

| Field | Meaning |
|---|---|
| `version`, `scope` | Version `1`; registered source ID, year, round, national capability and official kind. Scope is null until validated. |
| `status` | Ingestion invocation `succeeded` or `failed`, not report-publication status. |
| `commit_returned` | Only true after the application's `conn.commit()` returns normally. False means no such observation, **not** proof of rollback or absence of persistence. |
| `first_pass`, `iteration` | Independently `not_started`, `partial`, or `complete`; iteration completes only on exhaustion. |
| `records_seen` | Logical results-CSV records encountered once in pass one, excluding header; quoted newlines are not extra records. |
| `rows_emitted` | Rows yielded in pass two, not inserted or committed rows. |
| `candidate_keys` | Size of the existing first-pass natural-key map, before ambiguity exclusions; no additional per-key collection. |
| `exclusions` | Global totals per reason: rows, sum of parseable votes, and unreadable-vote rows (a **subset** of excluded rows). Zero parseable votes does not assign zero to unknown votes. |
| `categories` | Per raw source category: `records_seen` in pass one, `rows_emitted` in pass two, and `exclusions` with the same per-reason counters as the global field. Null means that observation phase has not started; completed empty observations are zero. Missing or truncated category values use the empty-string key so they remain visible. Source category names are otherwise preserved rather than trimmed, normalized or filtered. |
| `ambiguous_categories` | Per category: ambiguous rows, votes and keys; unknown until first-pass classification completes. |
| `companion_conflicts` | Null without observed companion metadata; otherwise separate input-exclusion rows per reason, unique conflicted input keys and keys per reason, plus affected result rows/votes/keys and result rows/votes per reason. Reason buckets can overlap. Result circuit ambiguities remain in `exclusions`. |

Unobserved counts are null; completed empty observations are zero or empty objects.
Partial counts describe only work observed so far. Category and global exclusion reasons
can overlap: one source row may contribute to more than one companion reason, and an
unreadable vote is a qualifier inside an exclusion rather than another excluded row.
`rows_emitted` describes parser output, not inserts or commits. Therefore neither the
category buckets nor the global fields form a universal conservation equation.

This report contains no list-identity field and therefore does not prove party mapping.
The ingest parser continues to emit PASO internal-list identities such as `135-3016`
without falling back to the parent agrupación. Category accounting likewise does not
assume `mesa_id` is globally unique. Natural-key, jurisdiction and election normalization
remain owned by the existing ingest boundaries.

No raw rows, connection strings or exception messages are stored. Synthetic CLI tests
use only a PostgreSQL connection double: they prove reporting and control flow, not real
persistence, rollback, idempotency, RSS, performance, publisher authenticity or
full-source verification.

## Deferred real PASO proof

A real `national/2023-paso-wayback` proof is a separate, explicitly authorized operation.
It requires an isolated local database, enough capacity for the 3.76 GB extracted CSV
plus PostgreSQL data, indexes and WAL, and two complete ingestions. Before running it,
record and approve:

- a minimum free-disk floor and an abort threshold;
- peak-RSS and elapsed-time limits;
- isolated database creation, ownership and cleanup commands;
- distinct new metrics paths for both runs;
- OS-level elapsed-time and peak-RSS capture;
- post-run SQL observations grouped by election, source kind and raw category; and
- equality checks across both runs for scoped row counts, vote aggregates and uniqueness.

Aggregate equality is evidence of idempotent outcomes, not a cryptographic row-by-row
proof. The proof must surface unmapped PASO `agrupación-lista` IDs through the existing
validation path; never collapse them to the parent agrupación to make the proof pass.
