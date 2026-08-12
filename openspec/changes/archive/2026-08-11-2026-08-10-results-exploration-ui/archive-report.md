# Archive Report: Results Exploration UI

**Status**: Archived with local release readiness verified
**Date**: 2026-08-11
**Artifact store**: Hybrid (OpenSpec + Engram)
**Branch at archive**: `feat/43-results-release-proof`
**Review authority**: Ordinary repository policy; native status contained no `reviewGate` because RDD review mode is disabled

## Outcome

The change is complete against its five requirements and ten scenarios. The
official explorer and fiscalización coverage explorer are merged to `main`; the
release-proof candidate remains staged locally and was not committed, pushed,
merged, deployed, or applied to production during archive.

## Source of truth sync

| Domain | Action | Delta |
|---|---|---:|
| `results-analysis` | Updated | 3 requirements and 6 scenarios added |
| `fiscalizacion-analysis` | Updated | 2 requirements and 4 scenarios added |

Updated main specs:

- `openspec/specs/results-analysis/spec.md`
- `openspec/specs/fiscalizacion-analysis/spec.md`

No requirements were modified, renamed, or removed.

## Final delivery state

| Slice | Final state |
|---|---|
| PR1 — official explorer | Merged as PR #45 at `ef077788a24850970ef1b65c8db200dd09a413c7`; main CI and Vercel deployment succeeded. |
| PR2 — coverage explorer | Merged as PR #47 at `b9d29c3`; this commit is the current `main`/`origin/main` base, and PR2 checks passed before merge. |
| PR3 — release, scale, and proof | Staged candidate remains 22 paths, 1,386 additions, and 43 deletions before archive-only paths. All local gates pass. No delivery or production mutation is claimed. |

## Verification authority

Authoritative evidence revision
`sha256:1e9c5de6d928cfc392595aba0423cc4c0d3b9871980863ecd59794b68987df92`
passed **5/5 requirements**, **10/10 scenarios**, with **0 blockers** and **0
critical findings**.

| Check | Final local result |
|---|---:|
| Static SQL contracts | 34 passed |
| Focused web and harness tests | 171 passed |
| Full web regression | 374 passed |
| pgTAP | 56/56 passed |
| Scale plans | 4/4 passed |
| Playwright | 8/8 passed, 0 skipped |
| Rollback/reapply | Passed for migrations 0020–0022 |
| Lint | Passed with zero warnings/errors |
| TypeScript | 7.0.2, passed |
| Production build | Passed |
| Disposable residue | Zero owned containers, volumes, and workdirs |

The real authenticated cold-start selector traversal reached mesa through the
complete parent hierarchy. The 2025 section-wide school table independently
rendered composite circuit/school identities, official party votes, mesa counts,
coverage links, provenance, and refusal behavior.

## Historical failure and remediation trace

Failed verification evidence
`sha256:4904053b85e727537fc91205a783f2ac4fff96b9b9a116b219d4b1841f29d655`
is superseded, not erased. It recorded two distinct blockers:

1. The browser path bypassed the selector hierarchy.
2. The 2025 section-wide official school party-vote breakdown was absent.

Remediation RED/GREEN/VERIFY history remains in `tasks.md`, `apply-progress.md`,
and `verify-report.md`. The later authoritative PASS independently reverified
both corrections. Earlier apply-progress statements that independent reverify
was pending describe their intermediate state and are not current closure facts.

## Native archive gate

Native `gentle-ai.sdd-status` reported:

- task progress: 12/12 complete, 0 pending;
- verify dependency: `all_done`;
- archive dependency: `ready`;
- next recommended action: `archive`;
- blocked reasons: none;
- action context: `repo-local` with this repository as the allowed edit root;
- `reviewGate`: structurally absent.

No review transaction, ledger, receipt, or gate-context artifact was read or
required.

## Engram traceability

Full observations read for this archive:

| Artifact | Observation |
|---|---:|
| Proposal | #2051 |
| Delta specs | #2052 |
| Design | #1969 |
| Tasks | #1972 |
| Apply progress | #1976 |
| Verify report | #2041 |

The proposal and combined delta-spec topics were mechanically restored from the
canonical OpenSpec artifacts before closure because their Engram mirrors were
missing. No artifact content or requirement was changed by that persistence
repair.

## Explicitly pending production evidence

This archive establishes local readiness only for PR3. The following remain
pending and unclaimed until PR3 delivery and deployment:

- hosted production migrations 0020–0022;
- hosted authenticated/anonymous RPC smoke checks;
- production `EXPLAIN (ANALYZE, BUFFERS)`, timings, buffers, and index use;
- the actual hosted 93-of-153 coverage denominator;
- production Vercel behavior and UI verification for the complete change.

The existing Next.js `middleware` deprecation warning remains unrelated and is
deferred to a separate change.

## Archive integrity

The active change folder was moved mechanically to
`openspec/changes/archive/2026-08-11-2026-08-10-results-exploration-ui/`.
Recursive `diff -r` comparison against the pre-move snapshot produced no
differences. This report is additive and was created only after that comparison.
