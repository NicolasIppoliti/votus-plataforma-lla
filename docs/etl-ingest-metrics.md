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
| `exclusions` | Per reason: rows, sum of parseable votes, and unreadable-vote rows (a **subset** of excluded rows). Zero parseable votes does not assign zero to unknown votes. |
| `ambiguous_categories` | Per category: ambiguous rows, votes and keys; unknown until first-pass classification completes. |
| `companion_conflicts` | Null without observed companion metadata; otherwise separate input-exclusion rows per reason, unique conflicted input keys and keys per reason, plus affected result rows/votes/keys and result rows/votes per reason. Reason buckets can overlap. Result circuit ambiguities remain in `exclusions`. |

Unobserved counts are null; completed empty observations are zero or empty objects.
Partial counts describe only work observed so far. Do not sum these buckets into a
conservation formula. No raw rows, connection strings or exception messages are stored.
Synthetic CLI tests use only a PostgreSQL connection double: they prove reporting and
control flow, not real persistence, rollback, idempotency, RSS, performance, publisher
authenticity or full-source verification. No real archive ingestion is authorized here.
