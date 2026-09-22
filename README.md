# Votus maintainer guide

Votus is an internal electoral-analysis platform: a Python/uv ETL archives public
2023/2025 official results and projects them into Supabase Postgres; a Next.js web
application reads through Auth and authorization boundaries. Official results and
opt-in fiscalización must remain separate.

## Product direction and documentation

Votus targets map-first territorial electoral intelligence: territorial dominance
and election comparison, with separate specialized modules. Today's application is
still selector/chart/table-first; the map is not yet delivered.

- [Product](PRODUCT.md): purpose, capability hierarchy and hard boundaries.
- [Design](DESIGN.md): current presentation and target map-first workspace.
- [Glossary](CONTEXT.md): shared domain vocabulary.
- [Territorial 3D proposal](docs/proposals/2026-09-22-3d-electoral-heroes-and-navigation.md): proposed scope and research gates.
- [Roadmap](docs/roadmap.md): priorities, not implementation authorization.
- [Delivery slices](docs/plans/territorial-intelligence-slices.md): sequential, independently reviewed and merge-gated PRs.

## Choose your task

| Task | Start here |
| --- | --- |
| Run or check the web application | [Web development and disposable E2E](apps/web/README.md) |
| Work on ingestion or ETL verification | [ETL below](#etl-development-and-verification) |
| Reproduce repository release checks | [Local CI below](#local-ci-and-release-verification) |
| Understand priorities and deferred work | [Roadmap](docs/roadmap.md) |
| Plan a separately authorized hosted observation | [Private operational verification](docs/operational-verification.md) |
| Understand the historical 0027 index release | [Results-explorer operations](docs/results-exploration.md) |
| Find partial down scripts and their limits | [Current rollback guidance](supabase/migrations/down/README.md) |

Run examples from the repository root. They are local development instructions,
not permission to contact a hosted project, ingest data, or deploy a release.

## Web quick path

Use Node.js 24 (the CI major) and **pnpm 12.3.4**, as declared in
[the web package](apps/web/package.json). Each example explicitly selects pnpm so
later commands do not fall back to an older global installation:

```sh
npm exec --yes --package=pnpm@12.3.4 -- pnpm --dir apps/web install --frozen-lockfile
npm exec --yes --package=pnpm@12.3.4 -- pnpm --dir apps/web dev
```

The npm invocation can download the pinned tool. Do not regenerate the lockfile
to accommodate global pnpm 10: use the declared version. Development requires
separately approved local application configuration; it does not provision a
Supabase stack. See the [web guide](apps/web/README.md) before running E2E.

## ETL development and verification

Use Python 3.12 or newer and uv; [pyproject.toml](etl/pyproject.toml) declares the
runtime and `etl-verify` entry point. The [ETL package](etl/etl/) contains ingestion
and archive logic; [tests](etl/tests/) describe the source-shape contracts.

Database-independent checks are useful, but are not the disposable database gate:

```sh
uv run --project etl --frozen ruff check etl
uv run --project etl --frozen ruff format --check etl
uv --directory etl run --frozen pytest tests/test_migration_sql.py -q
```

For full ETL verification, first obtain an approved **local disposable Postgres
service** with the roles and privileges specified by the `etl-release` job in
[release-gates.yml](.github/workflows/release-gates.yml). This is not a recipe for
modifying an existing application database.

`ETL_TEST_ADMIN_DATABASE_URL` must point to that service's `template1` maintenance
database with CREATE DATABASE privilege. Supply it privately; never print or
commit a DSN. With that prerequisite already satisfied:

```sh
uv run --project etl etl-verify
```

The [runner](etl/etl/verify.py) creates its own UUID-named database, applies
migrations, runs tests, and cleans up its owned database. It does not ingest into
an existing database. CI also runs the separate `--migration-atomicity` cases
`success`, `ledger`, and `sql`; consult the workflow for their service setup.
Never substitute a hosted URL or an ingestion destination for the admin DSN.

## Local CI and release verification

The [release workflow](.github/workflows/release-gates.yml) is authoritative for
job prerequisites, tool versions and scope selection. Its `verify` job checks
that the selected gates succeeded and unselected gates were skipped.

- **Web static:** `lint`, `typecheck`, and `test`; commands are in the web guide.
- **ETL release:** disposable `etl-verify`, including migration-atomicity cases.
- **E2E release:** `test:e2e:gate` owns the isolated stack, SQL proofs and browser run.
- **Focused feedback:** `test:e2e:focused` selects canonical browser specs; it is
  not a replacement for the full release gate.

A development server, a standalone unit test, or a successful local build is not
proof that all CI gates passed. Local proofs also do not establish deployed
migration state, authorized access, or hosted data completeness.

## Hosted deployment and rollback are separate manual operations

There is no root one-command hosted deploy or universal rollback here. Repository
publication, web deployment, database migration, and archive replay are separate
boundaries requiring explicit target/revision approval and responsible operators.

Use the [operational procedure](docs/operational-verification.md) for its bounded
observation gate and private evidence rules, not as a deployment or repair script.
The [results-explorer guide](docs/results-exploration.md) preserves the historical
0027 preflight, ETL write-pause and index recovery contract; it does not establish
current hosted state or authorize applying later migrations.

For a proposed rollback, start with [partial down coverage](supabase/migrations/down/README.md)
and verify the exact migration, dependencies, data effects, application
compatibility and recovery plan before seeking execution approval. Do not run a
disposable test's full down/reapply chain against a hosted database.
