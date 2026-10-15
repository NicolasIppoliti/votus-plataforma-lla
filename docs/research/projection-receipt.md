# Reuse only a verified national official projection

Issue #480 adds a receipt to the real `ingest` path. A matching receipt skips
national ZIP extraction, completeness parsing, result parsing, and replacement.
It still reads and verifies the immutable archive and scans the scoped database
projection. This is not a zero-I/O cache or a guarantee of corpus-scale speedup.

## Operator behavior

Run `python -m etl ingest` with the existing source, election and database options.
After commit the command explicitly reports `projection reused` or
`projection rebuilt`. Add `--force-rebuild` to bypass receipt reuse. Non-national
loaders retain their existing replacement behavior.

The Python `ingest_source` API continues returning the projection's result-row
count, including on reuse. That is **not** the number newly written. Optional
count reports distinguish:

| Field | Rebuild | Verified reuse |
| --- | --- | --- |
| `projection_outcome` | `rebuilt` | `reused` |
| `projection_rows` | Current result-row count | Verified current result-row count |
| `records_seen`, `rows_emitted` | Actual parser observations | `null` (parser not run) |
| `first_pass`, `iteration` | Actual parser state | `not_started` |
| `rows_written` | Writer's returned count before commit | 0 |
| `rows_committed` | Written count after commit returns normally | 0 |
| `commit_returned` | Observation of outer commit returning | Same |

Failed attempts do not gain a `rows_committed` observation. A returned commit is
an application observation, not proof about a later connection failure or storage
hardware. Performance reports also carry `projection_outcome`.

## Receipt identity

The key is `(archive_entry_id, election_id, source_kind)`; every key field is
non-null. Only `official` national receipts are supported. Identity SHA-256 covers:

- The verified complete source/archive bytes' SHA-256.
- The ordered ZIP member inventory (names, CRCs and lengths), or a bare-CSV marker.
  Together with the complete archive digest and selection implementation digest,
  this conservatively fixes the selected member and **all** potential companion
  dependencies, without re-extracting the ZIP to decide reuse. Even changing an
  unselected member invalidates reuse.
- Election year/round and source kind.
- Contract version and content digests of archive extraction/selection, national
  transformation, administrative normalization, numeric parsing, persistence and
  receipt implementations. Python and Psycopg runtime versions are included.

The implementation dependency list is explicit in `projection_receipt.py`:
new persisted-projection dependencies must be added there. File-level hashing is
intentionally conservative: unrelated edits in these files can cause a safe
rebuild. National official ingestion has no configurable projection filters;
election and source kind are its projection-affecting configuration. Curated party
maps and PBA crosswalks are deliberately excluded: national ingestion does not
consult them, and party mappings remain query-time state, never frozen in a receipt.

An archive ID remains immutable authority. Changing its archived bytes/provenance
is still refused, rather than authorizing a receipt-based overwrite. A new archive
identity follows the ordinary new-scope load path.

## Current-projection validity

For the receipt's archive/election scope, one SQL statement computes a count and an
order-independent checksum for each of:

1. Official `result_row` rows (explicit source-kind predicate).
2. `official_expected_mesa`.
3. `official_mesa_count_status`.
4. `official_mesa_completeness_quarantine`.

Every stored column, including IDs and nullable values, is encoded as PostgreSQL
JSONB text, SHA-256 hashed, split into four signed 64-bit words, and summed as exact
numeric values alongside the row count. Empty tables have count zero and four zero
sums. Duplicate rows retain multiplicity. Aggregate state is bounded, with no
corpus-sized `string_agg`, sorting, or client readback. An `OFFSET 0` subquery fence
keeps the row hash from being inlined into four separate hash computations.

All four signatures must equal the receipt. Missing, altered or malformed receipt
payloads and changed/deleted/added scoped projection rows cause a normal rebuild.
NULLs are serialized explicitly, not compared through nullable equality joins.
Mutable query-time party mappings are outside this validity contract. This is an
accidental-corruption detector, not tamper-proof attestation against a privileged
writer able to forge both projection and receipt. Representation/runtime changes
may conservatively cause unnecessary rebuilds.

## Atomicity and serialization

A transaction-scoped advisory lock on archive identity is acquired **before** the
first archive insert, so concurrent initial loads cannot race on absent provenance.
The existing archive source-authority row lock is also held. Result replacement
now explicitly deletes only the authoritative source kind as well as archive and
election, so an out-of-kind row cannot be erased by an official rebuild. The advisory lock is
broader than the receipt key: different elections for one archive serialize too.
Read-committed isolation is required so a waiter sees its predecessor's committed
receipt and rows. Other archive scopes retain independent locks.

Results, all completeness tables and the new receipt are written inside the same
outer `ingest_source` transaction. The loader's existing nested transaction remains
a savepoint, not independent publication. Failed first loads publish nothing;
failed forced replacements roll back to the old complete projection and receipt.
Empty results still replace prior rows and receive a verifiable zero-count receipt.
Unmanaged SQL writes are detected on the next reuse check; they are not serialized
by an advisory lock they do not acquire. The validity observation is the checksum
statement's MVCC snapshot, not a promise that no future writer can change the data.

Migration `20261015200000_projection_receipt.sql` adds one RLS-enabled table and an
explicit ETL-writer policy/grant. Supabase default grants are revoked behind
role-existence guards, including `service_role`; no superuser/BYPASSRLS changes are
made. The down migration removes only the receipt table: result/completeness data
remain intact. The mixed-version release rollback proof and both release inventory
expectations include the new migration.

## Measured local behavior

A focused production-entry-point test on the existing local Supabase PostgreSQL
17.6 stack, Python 3.13.12 / Psycopg 3.3.6, used a synthetic 301-byte ZIP with one
353-byte CSV member and two result rows. One warm forced rebuild and one subsequent
verified reuse were measured (no cold-cache control, no production data replay):

| Operation | Elapsed | Shared relation bytes before → after |
| --- | ---: | ---: |
| Forced rebuild | 0.088912 s | 2,570,493,952 → 2,570,493,952 |
| Verified reuse | 0.008728 s | 2,570,493,952 → 2,570,493,952 |

Disk figures sum `pg_total_relation_size` of the four projection tables plus the
receipt table, including their unrelated existing local data and indexes. These
are allocated relation bytes, not WAL, OS disk use, or filesystem high-water marks.
Both tiny operations fit existing pages: this does **not** show that large rebuilds
avoid bloat. A separate test makes ZIP extraction/parsing raise if reached during
reuse, proving that reuse avoids the temporary extracted member path. Reuse still
performs archive reads, row locks, checksum scans, and transaction commit.

No full 2023/PASO or 2025 national replay was measured here. Corpus-scale elapsed
time, WAL, buffer reads and temporary-file behavior remain to be measured before
claiming large-data savings; the checksum scan cost is intentionally paid for
projection integrity.

## Verification evidence

The initial production-entry-point test failed before implementation because no
explicit rebuild outcome existed. Focused database tests then passed for unchanged
ZIP replay without extraction, forced rebuild, changed transform dependency set,
missing/corrupt receipts, altered/deleted results, added completeness quarantine,
empty output, first-load/replacement late failures after receipt publication,
concurrent first-load decisions, other-scope/source-kind preservation, replacement
from nonempty to empty output, and real CLI flag wiring. The source-kind preservation
test initially failed because the existing delete lacked a source-kind predicate;
it passed after adding that predicate.
Additional identity tests cover companion bytes, selected-member renaming, election
and source kind. Imports are asserted to resolve inside this worktree.

The new table was installed by the focused test's local-only schema fixture; it
also reapplies this table's role-guarded revocations for incremental local setup.
Live checks verify that existing Supabase roles have no table privileges and that
`etl_writer` has the required CRUD privileges and can SELECT under its own role. No
stack reset/stop or hosted access was used. A clean-database migration replay and
live down/up grant proof are not established by the structural SQL tests or the
mocked web release-gate tests; use the owned release migration lane for those proofs.
