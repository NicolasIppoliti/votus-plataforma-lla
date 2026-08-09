# Post-archive fix-05 verification addendum

> **Verdict:** Implementation evidence **PASS** for the final fix-05 candidate. Delivery has **not** been performed.
>
> Candidate: branch `fix-05-one-jurisdiction-per-mesa`, HEAD `eebb314`, native target `sha256:b1856fe5600a55db12097e490e79f47b6b286b05206238e650bf18cc82d399af` after final normalization.

## Status at a glance

| Area | Status | Meaning |
|---|---|---|
| Implementation evidence | **PASS** | Migration, Python, pgTAP, candidate-workflow Ruff lint, candidate patch whitespace, and GGA gates passed on the normalized candidate. Repository-wide Ruff formatting is not green because an out-of-target pre-existing file would be reformatted. |
| Protected local database | **SAFE** | The protected 18M-row database was never reset, migrated, truncated, dropped, or reingested. |
| Native review receipt | **NOT AVAILABLE** | Consent binding failed; no lineage or receipt was created. No approval is inferred. |
| Delivery authority | **Disabled/unmanaged** | The user disabled receipt-driven development globally after the consent failure. |
| Commit/push/PR/live migration | **NOT PERFORMED** | This addendum records readiness; it does not deliver the change. |

## Relationship to the archived verification report

The historical [`verify-report.md`](verify-report.md), dated 2026-08-04, remains valid for the candidate it examined. It is an archive record and is not rewritten or replaced by this document.

That report is stale for the current fix-05 candidate: it describes an earlier branch, commit, test count, and runtime state. This addendum records only the post-archive fix-05 corrections and their current evidence. Where the two documents differ, each governs its own candidate; this addendum does not retroactively alter the historical verdict.

## Exact candidate boundary

- Branch: `fix-05-one-jurisdiction-per-mesa`
- HEAD: `eebb314` (`fix(web): read every identity and every row from the database`), one commit ahead of `main`
- Uncommitted implementation target: 27 tracked modifications plus 13 intended untracked files (40 paths)
- Final normalized native target identity: `sha256:b1856fe5600a55db12097e490e79f47b6b286b05206238e650bf18cc82d399af`
- The three paths committed in `eebb314` but absent from the 40-path uncommitted target are:
  - `supabase/migrations/0013_merge_fiscalizacion_mesas_into_official.sql`
  - `supabase/migrations/0014_drop_result_row_is_unmapped.sql`
  - `supabase/migrations/0015_review_item_unreadable_vote_cell.sql`
- This addendum and [`fix-05-delivery-plan.md`](fix-05-delivery-plan.md) are post-verification closure documents. They were created after the native target identity was frozen and are not claimed to be covered by that hash.

## Final evidence on normalized candidate bytes

The following results were recorded after final normalization. Where the closure context retained a command shape, it is shown; no missing argv or credential value is reconstructed.

| Gate | Invocation or scenario | Observed result |
|---|---|---|
| Migration history | Disposable unique sibling database; apply migrations `0001` through `0018`; trap cleanup | **PASS**, complete chain applied; sibling database cleaned up |
| Python tests | `cd etl && uv run pytest` | **568 passed**; one expected ZIP duplicate-name warning |
| Database tests | `supabase test db` against the disposable verification database | **22/22 pgTAP passed** |
| Ruff lint | Candidate workflow, with Ruff cache disabled | **PASS** |
| Repository-wide Ruff formatting | `cd etl && uv run --frozen --no-sync ruff format --check .` | **NOT GREEN** (exit 1): `etl/http_client.py` would be reformatted; that pre-existing path is outside the documented 40-path candidate. No candidate-only format pass is claimed. |
| Candidate patch whitespace | `git diff --check` on the normalized implementation candidate | **PASS** |
| Independent AI review | GGA `v2.10.1`, provider Codex, cache disabled | `STATUS PASSED` / `CODE REVIEW PASSED` |
| Native identity | Native target capture after normalization | `sha256:b1856fe5600a55db12097e490e79f47b6b286b05206238e650bf18cc82d399af` |

The expected ZIP warning is Python's duplicate-member-name warning from a test that deliberately constructs a duplicate ZIP target. The behavior under test rejects that archive; the warning is not an ignored implementation failure.

No cached Lens result is used as current evidence. The accepted GGA run explicitly disabled cache. Any older Lens/cache material is stale by construction and must not be substituted for the normalized candidate result.

## Protected database safety

The local database containing roughly 18 million rows was treated as protected state throughout verification.

- It was **never** reset.
- It was **never** migrated.
- It was **never** truncated or dropped.
- It was **never** reingested.
- Migration verification used unique sibling database names.
- Cleanup was trap-protected so the disposable sibling was removed even on failure.

This differs materially from the historical verification report, which records a reset and reingest for its own earlier candidate. That historical action must not be read as an action performed for fix-05.

## Capability-level mapping to archived specifications

| Archived capability | Fix-05 correction and evidence relationship | Current status |
|---|---|---|
| [`jurisdiction-model`](specs/jurisdiction-model/spec.md) | Makes `(distrito, sección, circuito, mesa)` the exact mesa identity; separates PBA three-digit distrito codes from national distrito codes; canonicalizes numeric and alphanumeric circuito forms; repairs existing jurisdiction aliases without silently choosing conflicting metadata. Migrations `0016`–`0018`, unit/integration tests, and the full migration chain cover the correction. | **Covered by current ETL/SQL evidence** |
| [`electoral-ingestion`](specs/electoral-ingestion/spec.md) | Enforces measured election/source shapes, strict source-cell numeric parsing, archive-entry consistency, empty-reingest replacement, and explicit rejection/quarantine reasons. National, PBA, fiscalización, CLI, idempotency, and migration tests cover the touched paths. | **Covered by current ETL evidence** |
| [`source-archive`](specs/source-archive/spec.md) | Adds content-addressed archive paths, verified reads, typed manifest validation, unique drift-history ids, safe path components, collision-resistant ZIP extraction, bounded streaming, and cleanup on extraction failure. | **Covered by current archive/storage tests** |
| [`fiscalizacion-analysis`](specs/fiscalizacion-analysis/spec.md) | Reconciles fiscalización rows only to same-election official mesas; refuses ambiguous/absent destinations without guessing; preserves review-item reasons; rejects incomplete official comparison vectors; keeps source scope explicit. | **Covered by current ETL, SQL, and pgTAP evidence** |
| [`party-identity-mapping`](specs/party-identity-mapping/spec.md) | Validates curated YAML types and duplicate natural keys and replaces stale curated projections, including the empty-input case, without touching normalized result rows. | **Covered by current loader and database tests** |
| [`access-control`](specs/access-control/spec.md) | No web/auth code is part of the 40-path uncommitted ETL target. Database migrations remain subject to existing grants/RLS behavior, exercised by pgTAP, but no new web access-control claim is made. | **No regression observed; no web gate claimed** |
| Idempotency (cross-cutting) | Loader boundaries reject foreign archive ids before SQL, replace stale curated rows, preserve election-scoped delete/insert semantics, and prove migration row counts remain unchanged. | **Covered by Python/database/migration evidence** |

Fix-05 did not rerun Vitest, TypeScript, Playwright, or other web gates for the ETL-only uncommitted workspace. This addendum therefore makes **no** claim that those web gates were rerun. The existing `eebb314` web commit is a separate, already-committed prerequisite and is handled separately in the delivery plan.

## Procedural caveats and tooling-state debt

### Native review consent failure

Native review did not complete. The consent follow-up failed because the binding was reported as unknown, expired, or consumed. A subsequent status query showed zero lineages and reoffered START. The user then disabled receipt-driven development globally.

Consequences:

- There is no native review lineage for this candidate.
- There is no native review receipt.
- There is no native delivery approval.
- Delivery status is **disabled/unmanaged**, not approved.
- The GGA pass is implementation evidence; it is not a fabricated substitute receipt.

### Stale native SDD attempt

The native SDD runtime ledger still exposes an active generation-15, phase-14 attempt from an older candidate, but status exposes no settle token. It was not reset, settled, repaired, or used as current evidence. This is tooling-state debt, not an implementation failure.

### Historical and cached evidence

- The archived 2026-08-04 report remains historical evidence only.
- Older Lens/cache results are not current evidence.
- Only the no-cache GGA result and the final normalized target identity are asserted for fix-05.

## Delivery readiness

The implementation is ready for delivery planning under the following constraints:

- Use the mandatory feature-branch chain in [`fix-05-delivery-plan.md`](fix-05-delivery-plan.md).
- Product owner accepted a `size:exception` for existing commit `eebb314` / unit 00 only: **4,023 additions + 752 deletions = 4,775 changed lines**. The exception preserves existing history and current evidence instead of rewriting commit identity and requiring full revalidation.
- Keep every new uncommitted authored slice at or below the planned 800 additions plus deletions; confirm each limit from staged `numstat` before delivery. Any overage blocks delivery pending repartition or its own separate explicit `size:exception`.
- Preserve the protected database; use disposable sibling databases for migration verification.
- Include every intended untracked implementation file in its assigned slice.
- Keep local `.env` and `.next` content excluded.
- Treat delivery as disabled/unmanaged unless the user explicitly changes that state in a later session.

## Remaining actions

1. Review and approve the proposed work-unit/hunk split.
2. Preserve `eebb314` unchanged under the recorded unit-00-only `size:exception`; do not treat it as authority for any new slice.
3. Stage one work unit at a time, including intended untracked files, and verify the staged diff matches the plan.
4. Re-run the focused evidence assigned to each slice after staging changes candidate bytes.
5. Create commits/branches/PRs only after explicit delivery authorization.
6. If documentation delivery is later authorized, force-add only this file and [`fix-05-delivery-plan.md`](fix-05-delivery-plan.md), because both remain ignored.
7. Plan any live migration separately, with backup and operational approval; no live migration has occurred.
