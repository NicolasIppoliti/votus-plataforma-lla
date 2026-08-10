# Fix-05 local delivery history

> **Status:** Completed locally. The implementation chain and subsequent corrective work are
> committed on `fix-05-one-jurisdiction-per-mesa`. No push or pull request was performed in this
> documentation session, and the GitHub-hosted workflow has not yet run remotely.

## Final branch boundary

| Boundary | Commit | Meaning |
|---|---|---|
| Original prerequisite | `eebb314` | Existing web/database prerequisite retained under its accepted unit-00 size exception |
| Prepared chain tip | `ac93243` | 23 local review units materialized from the approved cumulative snapshots |
| Verified implementation tip | `fae210d` | Current application, migration, and fail-closed gate state before documentation refresh |
| Final-state handoff | `2cada92` | Current evidence, tasks, handoff, and archived-spec status notices |

The original plan was a construction document for an uncommitted 40-path candidate. That work is
now ordinary Git history. This file records what happened; it is not authorization to recreate,
retarget, push, or open the former proposed chain.

## Prepared chain

The approved map became 23 commits after `eebb314`, in the exact dependency order below. Every
new prepared unit stayed at or below 800 authored additions plus deletions; the largest was 778.
The accepted 4,775-line exception remained scoped to pre-existing commit `eebb314` only.

```text
87d5cdf  chore(repo): align verification tools and review guidance
e70203d  fix(archive): reject unsafe and colliding extraction targets
104ce7e  fix(archive): verify immutable captures by content digest
cae8131  fix(etl): canonicalize source identities without permissive parsing
f8d6920  fix(etl): enforce measured national election row shapes
0a3d754  fix(etl): refuse unverifiable PBA cache and schema drift
5004e0a  fix(etl): refuse ambiguous fiscalizacion mesa attribution
c2bfc63  fix(db): add circuito to mesa crosswalk identity
8ab1eb1  fix(etl): key mesa crosswalks by circuito and replace stale rows
f867490  fix(etl): preserve idempotency across loader replacements
d460f0c  fix(db): repair jurisdiction reconciliation without rewriting history
7941ada  fix(db): reconcile fiscalizacion mesas with official identities
5674efd  test(db): prove jurisdiction repairs on disposable history
a7332d3  fix(cli): report malformed source and manifest records
08eaa22  fix(cli): route fetches through verified archive records
79ffdd8  fix(cli): keep ingest source identity and review outcomes exact
51c63e4  test(cli): cover curated validation failure surfaces
3e466c0  fix(cli): validate and replace curated electoral projections
9de654b  fix(cli): backfill curated mesa type projections
b63d86e  fix(cli): refuse incomplete fiscalizacion comparison baselines
6393531  fix(cli): enforce circuito-aware official comparison vectors
ca64a57  test(cli): prove fiscalizacion validation scope bindings
ac93243  docs(openspec): record fix-05 verification and delivery chain
```

The cumulative snapshot map, split-hunk audit coordinates, and ignored-file staging instructions
served construction only. They are intentionally retired now that each resulting tree and commit
is directly inspectable in Git.

## Subsequent local commits

The prepared chain was followed by these committed corrections and release gates:

| Commit | Outcome |
|---|---|
| `4a38196` | Refreshed OpenSpec testing configuration |
| `71f2b61` | Added fail-closed disposable ETL verification |
| `8ff505d` | Projected archive provenance before ingestion |
| `c6f8ba0` | Exposed PBA granularity degradation |
| `1b7a71b` | Classified fiscalización source re-exports |
| `bb97ae2` | Preserved national establishment lineage |
| `f9b80db` | Used exact statutory simulation arithmetic |
| `f205e9d` | Restored the Codex GGA provider |
| `0a8c4d4` | Retained complete source-fetch history |
| `b57e61b` | Stripped personal columns before parsing |
| `9290451` | Aligned canonical Hare eligibility with statute |
| `e639385` | Required trusted simulation provenance boundaries |
| `15df6c8` | Validated council state before allocation |
| `c9d501c` | Preserved simulation vote-evidence breakdowns |
| `1801c73` | Added fail-closed ESLint |
| `0fbd34d` | Added the fail-closed E2E release gate and hosted workflow |
| `7c11314` | Covered all eight operator routes/specs |
| `fae210d` | Isolated and cleaned the disposable ETL verification role |

## Final local evidence

- Canonical requirements: 50/50 satisfied at the prior audit.
- ETL: 19 migrations, 670 passed, 0 skipped; disposable database and role counts zero.
- ESLint 9.39.2: 0 warnings/errors.
- TypeScript 7.0.2: pass; TypeScript 6.0.3 API only for typescript-eslint.
- Web unit tests: 325 passed after WU3.
- Production build: pass.
- Playwright release gate: exact 8/8 passed, 0 skipped/failures; owned residue zero.
- GitHub-hosted workflow: present but not yet run remotely.

## Current policy

- RDD is clone-local disabled/unmanaged. Ordinary repository hooks and review policy apply.
- Delivery remains `auto-chain` with `feature-branch-chain` when future work exceeds one reviewable
  unit.
- The current authored review budget is 1200 lines. Configured lockfile/build-artifact exclusions
  and recorded size exceptions remain literal; this history does not widen them.
- Verification uses disposable owned infrastructure. The protected project database is never a
  rehearsal or test target.
- Historical reports and commits are immutable evidence. Later corrections are additive and
  labelled with their actual boundary.

## Review and rollback boundaries

| Work unit | Review boundary | Rollback boundary |
|---|---|---|
| Prepared implementation chain | `eebb314..ac93243` in commit order | Revert only the affected prepared commit(s), preserving later dependency order |
| Subsequent corrective work | `ac93243..fae210d` in commit order | Revert the smallest corrective commit whose behavior is being withdrawn |
| Final-state documentation | The two documentation/config commits after `fae210d` | Revert either documentation commit independently; never edit historical reports to simulate rollback |
| Live deployment or migration | Not performed and not authorized by this history | Requires a separate operational plan, backup, approval, and verified rollback |

No branch retargeting, push, pull request, merge, live migration, or remote CI result is implied by
this completed local history.
