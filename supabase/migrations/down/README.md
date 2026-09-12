# Current partial rollback coverage

This directory contains manually selected down scripts used by current release
proofs. It is **partial coverage**, not a paired down migration for every forward
migration and not a universal or one-command hosted rollback.

## Find the applicable contract

- [Forward migrations](../) are the canonical production SQL.
- [Results-exploration release proof](../../tests/results_exploration_release.sql)
  names the down/reapply sequence exercised in the disposable test database.
- [Migration contract tests](../../../etl/tests/test_migration_sql.py) check the
  release SQL references and specific rollback contracts.
- [Gate plan](../../../apps/web/scripts/e2e-gate-runtime.ts) selects the current
  rollback/reapply proofs; [the runner](../../../apps/web/scripts/e2e-release-gate.ts)
  executes them inside its owned disposable stack.

Inspect those sources and the exact SQL before proposing a rollback. File presence
alone does not prove lossless data recovery, compatibility with an older web
release, or coverage for later dependent migrations.

## Hosted use requires a separate plan

Do not bulk-run this directory or copy the test chain into a hosted session.
Agree the target, deployed migration history, dependency order, ETL write pause,
data consequences, access checks and forward recovery with the responsible
operator before any execution. No hosted command is authorized by this README.

The [0027 operations contract](../../../docs/results-exploration.md) describes its
specific index-only down/reapply boundary. That narrow contract is not permission
to remove explorer functions or to roll back the entire application.

Keep down SQL outside the top-level forward migration inventory. The
[legacy sibling directory](../../migrations_down/README.md) remains for historical
references; it is not the current release-proof entry point. Return to the
[root guide](../../../README.md) for development and local verification.
