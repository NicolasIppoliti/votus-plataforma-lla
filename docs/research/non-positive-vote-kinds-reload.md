# Reloading national non-positive vote evidence (#408)

**Do not reload until the vote-kind migration, ingestion, positive-only query guards,
and RPC/UI changes have passed verification together.** This is an operational plan,
not evidence that a full-source reload has run. Hosted reloads require
separate authorization; this plan authorizes none.

## Why a reload is necessary

Existing national projections excluded EN BLANCO, NULO, IMPUGNADO, RECURRIDO and
COMANDO. A schema default for historical rows can label them POSITIVO but cannot
recover missing evidence. Reparse the immutable archive rather than inventing zeroes.
Keep non-positive rows party-less and retain each kind independently of positive
party/list totals. Provincial JEBA ingestion is outside this change.

The [measured PASO run](paso-scale-evidence.md) emitted 13,627,397 positive rows and
excluded 2,973,480 non-positive rows. Persisting all six kinds would emit 16,600,877
rows on that same archive if no other exclusions change. These are **row counts**,
not vote totals. Changes to other exclusion reasons must be reconciled separately,
per category and reason, before accepting a reload.

## Persisted contract

Migration `20261015300000_non_positive_vote_kinds.sql` labels existing rows
`POSITIVO`. The natural key includes archive, election, jurisdiction, category,
nullable list identity, source kind and vote kind, using `NULLS NOT DISTINCT`.
Other kinds have NULL list identity and official source kind. National parsing
accepts empty/`0` source party/list sentinels, retains measured zeroes, and reports
unknown kinds or contradictory party identities per reason (including the kind).
The shape regression tests use synthetic probes based on the committed 2023 and
2025 fixture headers; they are not independent full-source shape measurements.

Existing result-read functions gain explicit positive-only predicates without
changing their source-kind predicates, owners, OIDs, ACLs or RLS boundary. Internas
returns `non_positive.status = available` with five separate `totals` entries;
it returns `unavailable/not_reloaded` until all kinds are present, never inferred
zeroes. Competing archives for a kind/jurisdiction produce an explicit
`conflicting_non_positive_identity` refusal for that evidence.

## Local-only preflight and execution

1. Verify the archive SHA-256 and election/round against the registry and manifest.
   Apply and verify migration `20261015300000` and its query guards first. Do not use
   a database reset, stop the shared container, or delete an existing projection to
   manufacture space.
2. Budget for **at least twice the new loaded database footprint**, plus extracted
   source bytes, WAL, index build/temporary space and a free-space safety margin.
   Measure available host **and container volume** space. The previous positive-only
   PASO load occupied 8.34 GB initially and 14.12 GB after its transactional reload;
   extraction needed another 3.76 GB. The new row count is about 22% larger, so the
   old 8.34 GB figure is not a safe estimate of the new loaded size. Measure the new
   footprint on an authorized local target before planning a full reload.
3. Use the existing ingest entrypoint and its one-transaction archive/election
   replacement. Retain the current projection on failure. Do not split delete and
   insert into separate commits to reduce disk usage: that sacrifices the measured
   rollback guarantee. Do not run concurrent reloads of the same scope.
4. Monitor free disk, memory and elapsed time. The measured experiment used a 5 GiB
   minimum free-space margin, 10 GiB RSS ceiling and 120-minute deadline, and an
   interrupted run rolled back. These are operator watchdog limits, not built-in
   CLI safeguards or new performance guarantees. Allow more than the measured
   positive-only 110-minute rerun before agreeing a new deadline.
5. Validate the evidence below before considering the reload successful. After the
   transaction commits, allow ordinary vacuum to reclaim dead tuples for reuse;
   it does not necessarily shrink the filesystem. Do not assume disk is reclaimed
   immediately or use a destructive rewrite as part of this plan.

## Acceptance evidence

| Check | Required evidence |
| --- | --- |
| Accounting | Records seen equal emitted plus exclusions/quarantines, with per-kind, per-category and per-reason counts; no unexplained loss. |
| Positive compatibility | Positive row/vote totals and mapped party/list aggregates equal the pre-reload baseline for the same archive/election scope. |
| Non-positive separation | Each supported kind has separate rows/totals and no party/list attribution; official and fiscalización evidence never combine. |
| PASO Rosales reference | PRESIDENTE/A, distrito 02, seccion 027: EN BLANCO 2,121; NULO 319; IMPUGNADO 12; RECURRIDO 4; COMANDO 12, from the issue's archive evidence. Preserve 33,250 positive votes separately. |
| Idempotency | A second identical ingest leaves logical rows/totals unchanged. Receipt reuse is valid only with the current transform fingerprint and matching complete projection checksum. |
| Receipt coverage | Changing a persisted vote kind must invalidate reuse. The receipt hashes full persisted rows (`to_jsonb(t)`), covering the vote-kind column; parser/write changes are fingerprint dependencies. The transactional integration test mutates only vote kind and verifies receipt reuse is rejected. |
| Product reachability | The authorized Internas RPC and rendered page show each real kind, not zeroes inferred from missing historical data or the old unavailable marker. |
| Interruption | On an authorized local test target, interruption leaves the previous scope intact; no partial reload is accepted. |

## Rollback boundary

The down migration refuses while any non-positive evidence is persisted; it never
deletes that evidence or collapses kinds into the old natural key. With positive-only
data it restores the old function definitions and key and removes the discriminator.
Before any downgrade, inspect these preconditions and use a separately authorized
recovery plan. This document
does not authorize dropping non-positive rows or performing a hosted reload.
