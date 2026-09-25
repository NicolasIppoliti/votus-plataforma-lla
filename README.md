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

Use Node.js **24.20.0** from [.node-version](.node-version) and **pnpm 12.3.4**,
as declared in [the web package](apps/web/package.json). Each example explicitly selects pnpm so
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

Use Python **3.13.12** from [.python-version](.python-version) and uv **0.12.17**;
[pyproject.toml](etl/pyproject.toml) enforces the uv version and declares the
`etl-verify` entry point. The package remains compatible with Python 3.12+, but
local release verification and CI use the same exact interpreter. The [ETL package](etl/etl/) contains ingestion
and archive logic; [tests](etl/tests/) describe the source-shape contracts.

Database-independent checks are useful, but are not the disposable database gate:

```sh
uv run --project etl --locked ruff check etl
uv run --project etl --locked ruff format --check etl
uv --directory etl run --locked pytest tests/test_migration_sql.py -q
```

For full ETL verification, first obtain an approved **local disposable Postgres
service** with the roles and privileges specified by the `etl-release` job in
[release-gates.yml](.github/workflows/release-gates.yml). This is not a recipe for
modifying an existing application database.

`ETL_TEST_ADMIN_DATABASE_URL` must point to that service's `template1` maintenance
database with CREATE DATABASE privilege. Without a separately parent-provisioned
migration runner, direct CI-style verification also requires the existing
parent identity to be SUPERUSER; the verifier provisions one fixed-purpose
temporary runner and guards its cleanup by identity. Supply connection material
privately; never print or commit a DSN, or manually create the runner. With the
approved prerequisite satisfied:

```sh
uv run --project etl --locked etl-verify
```

The [runner](etl/etl/verify.py) creates its own UUID-named database, applies
migrations, runs tests, and cleans up its owned database. It does not ingest into
an existing database. CI also runs the separate `--migration-atomicity` cases
`success`, `ledger`, and `sql`; consult the workflow for their service setup.
Never substitute a hosted URL or an ingestion destination for the admin DSN.

The verifier selects ordinary and explicitly privileged tests into two disjoint,
exhaustive pytest processes. Ordinary tests receive only the restricted disposable
test-role DSN; privileged fixtures receive a verified owned-target maintenance
capability. The outer Supabase bootstrap identity is not passed to pytest; the
privileged maintenance capability remains administrative (SUPERUSER in CI). Two
migration-session tests sequentially reuse one parent-owned temporary runner in
a separate authenticated session, with SET but not ADMIN or INHERIT membership
on `postgres`; its identity and cleanup are parent-guarded. This is trusted
test infrastructure, **not a sandbox**:
`SET postgres` can reach SUPERUSER in CI. None of these test capabilities or
commands authorizes production access.

For the local Supabase-isolated path, run from `apps/web`:
`pnpm verify:etl-isolated --plan` inspects the planned gate without creating a
stack, database, or migration; `pnpm verify:etl-isolated --run` requires an
approved local Docker context and creates only its new owned stack, runs the
full ETL verification, then attempts guarded cleanup (retaining recovery
evidence if ownership is uncertain). A passing plan is not a passing ETL run.
`test:e2e:gate --plan` is not a supported substitute.

### CNE circuit reference replay (Slice 2)

From the repository root, with the checksum-addressed files present under
`archive/geography/`, replay the two local-only validation modes:

```sh
uv run --project etl --locked python -m etl validate-circuit-geometry --source geography/cne-pba-circuits
uv run --project etl --locked python -m etl validate-circuit-geometry --source geography/cne-pba-circuits --use reference-only
```

These commands read the registered CNE circuit and electoral-section snapshots
through the archive manifest and SHA-256 verifier; they do not fetch the live WFS
or ingest votes. The default `partition` mode exits **1** for the archived originals:
circuits `0248B` and `0248C` overlap in positive area. Do not interpret the
section matching their union as a disjoint partition. For these overlapping
originals, `--use reference-only` exits **0** only for the reviewed,
checksum-pinned pair and reports
`accepted_with_warning`, `reviewed_source_overlap`, and
`spatial_assignment=unsupported`. It does not repair or resolve the overlap;
arbitrary re-exports or other topology/identity failures remain blocked.
The report retains strict-partition counts (0 accepted, 8 eligible, 2 invalid,
10 selected and 1,136 excluded of 1,146 source features),
`geographic_coverage=unverified`, and
`election_applicability=unknown`. Neither mode establishes spatial vote
attribution, area totals, or applicability to the 2023/2025 elections.

The [source registry](etl/sources.yaml) records the CNE downloads-page-linked
resources and reference kinds. The [archive manifest](archive-manifest.json)
records retrieval timestamps and immutable digests: circuits
`215b9d53504b385db35825a1dead0af6c87494dbef541f0ab8acf61996852e71`
and sections `964af68999504c107c71eaccd8470055f990071eccba09f227e81b6dc31df673`.
The PBA catalog attributes CC BY 4.0 to the circuit resource; reuse terms for
the separate section layer have not been independently established. A changed
source requires a new provenance and geometry review, not a renamed archive file
or an inferred numerical tolerance.

**Separate ARBA comparison, informational only:** Against the archived ARBA
Coronel Rosales partido reference (SHA-256
`b502009185a5d6b1666312d2d91aa9b79053b2ee8a06f0aa683029b925c3ed13`),
the CNE electoral section has `0.0016520185839670064` degree² outside ARBA
(1.234992343% of the CNE section); ARBA has `0.0009691019666721974` degree²
outside CNE (0.728184906% of ARBA). Six CNE circuits cross the ARBA boundary:
`0248B`, `0249A`, `0249B`, `0248F`, `0249`, and `0248A`. These are planar
EPSG:4326 angular-area comparisons, **not** certified metric or legal areas.
ARBA is not the CNE validator's parent and its disagreement neither blocks nor
excuses the independent CNE circuit overlap. The source of the disagreement,
coordinate tolerance, legal boundary and election-year applicability are unknown;
do not modify either archived geometry to force agreement.

## Local CI and release verification

The [release workflow](.github/workflows/release-gates.yml) consumes the same
repository-owned pins as local development: `.node-version`, `.python-version`,
`apps/web/package.json` (pnpm and Supabase CLI **2.116.0**), and
`etl/pyproject.toml` (uv). The JavaScript Supabase SDK has its own independent
version; it is not the CLI. Use the web package runner to select the local CLI,
not a separately updated global installation. The gate rejects mismatching
Node, pnpm or CLI versions before provisioning its stack.

Commit both lockfiles. Use `pnpm install --frozen-lockfile` and `uv sync --project
etl --locked`; verification must not regenerate dependency resolutions. ETL
build requirements are included in the default `build` dependency group and
`uv.lock`. Do not exclude that group during a fresh install: only the ETL package
build runs without isolation, after its locked build dependencies are installed.

Update pins and locks together in a reviewed change, then run all release gates.
CI also fixes Action commit SHAs, the Postgres image digest and the Ubuntu 24.04
runner family. The hosted runner's patch image and local Docker/OS remain managed
prerequisites, not immutable copies of each other. Playwright controls its browser
revision through its locked package.

The workflow remains authoritative for job prerequisites and scope selection. Its
`verify` job checks that selected gates succeeded and unselected gates were skipped.

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
