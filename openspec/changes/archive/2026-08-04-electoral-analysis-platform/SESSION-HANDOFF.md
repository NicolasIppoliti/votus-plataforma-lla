# Session handoff: verified electoral analysis platform

## Current state

Votus is implemented as a Python/uv ETL with an immutable sha256 archive, a Supabase
Postgres/Auth/RLS projection, and an authenticated Next.js App Router UI. The verified
implementation boundary before this documentation refresh is `fae210d` on
`fix-05-one-jurisdiction-per-mesa`.

| Setting | Current value |
|---|---|
| SDD execution | `auto` |
| Artifact store | `hybrid` (OpenSpec + Engram) |
| Delivery | `auto-chain`, `feature-branch-chain` |
| Review budget | 1200 authored additions + deletions; configured exclusions and explicit size exceptions remain authoritative |
| Strict TDD | `true` |
| RDD | clone-local disabled/unmanaged; ordinary repository policy applies |
| Canonical specs | `openspec/specs/`, 50/50 requirements satisfied at the prior audit |

This is not a greenfield repository. The local implementation and its reviewable chain are
complete. No push or pull request was performed in this documentation session.

## Verified commands

Run from the repository root unless a command changes directory:

```bash
uv --directory etl run etl-verify
cd apps/web && pnpm lint
cd apps/web && pnpm typecheck
cd apps/web && pnpm test
cd apps/web && pnpm build
cd apps/web && pnpm test:e2e:gate
```

Observed final implementation evidence:

- ETL: 19 migrations, 670 passed, 0 skipped; disposable database and role residue zero.
- ESLint 9.39.2: 0 warnings/errors.
- TypeScript 7.0.2: pass. TypeScript 6.0.3 exists only as the API required by typescript-eslint.
- Web unit tests: 325 passed after WU3; the later ETL fix did not change web bytes.
- Production build: pass.
- Playwright release gate: exact 8/8 passed, 0 skipped/failures; owned residue zero.
- GitHub workflow: present, not yet run remotely.

## Load-bearing rules

- PBA municipal and provincial seat allocation uses Hare quota with largest remainder under
  Ley 5109 Arts. 109-110. National diputados uses D'Hondt under Ley 19.945 Art. 161.
- Coronel Rosales has 18 council seats total and renews 9 per election; 9 is the Hare divisor.
- National and PBA administrative code schemes differ. Normalize at the single jurisdiction
  boundary and preserve the seccion needed to identify Coronel Rosales.
- `source_kind` defaults to `official`. Fiscalización is explicit opt-in, never mixed into an
  official figure, and always carries its non-random coverage denominator.
- Personal columns are stripped before parsing and never enter persistence, fixtures, logs, or
  documentation.
- Quarantine, skip, and exclusion paths report reasons and distributions. Never silently drop or
  silently pick conflicting data.
- A test-only caller is not reachability evidence. Exercise CLI commands and rendered routes.
- Verification gates own uniquely identified disposable infrastructure and must prove cleanup.

## Evidence integrity

- `openspec/specs` is the current source of truth.
- Archived spec copies are historical snapshots, not canonical alternatives.
- `verify-report.md` and the original archive report remain historical evidence and must not be
  edited to make later work appear to have happened earlier.
- `post-archive-fix-05-verification.md` records the final observed state without changing those
  snapshots.

## Next actions

1. Review the two local documentation/config commits as separate work units.
2. If delivery is later authorized, push the existing branch and open the review chain without
   rewriting historical commits.
3. Treat the first GitHub-hosted workflow run as new remote evidence; do not infer it from local
   success.
4. Keep live migration and protected-database operations outside routine verification and subject
   to separate operational approval.
