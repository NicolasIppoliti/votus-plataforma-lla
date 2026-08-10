# Code review rules — Votus

Internal electoral analysis tool. Ingests PUBLIC official results for 2023 and 2025 at
national, PBA-provincial and municipal level to support scenario comparison for 2027.
Two runtimes: a Python/uv ETL producing an immutable sha256 archive, feeding a Supabase
Postgres projection behind Auth/RLS, with a Next.js App Router UI.

These rules are not generic advice. Every numbered rule exists because the failure it
describes actually happened in this repository. Apply the engineering approach below to
new work, then use the numbered rules as repository-specific rejection criteria.

## Engineering approach

- Prefer the simplest implementation that fully meets the current requirements. Avoid
  speculative abstractions, configuration, and indirection.
- Grow the system in working end-to-end layers. Start with the smallest complete path,
  then add capability without replacing a working product with unfinished complexity.
- Keep components modular and concerns clearly separated.
- Study how established products solve the problem before designing a solution. Adopt
  proven patterns and conventions instead of inventing an approach from scratch.
- Prefer established, well-maintained libraries when they reduce total complexity or
  improve reliability. Check the dependencies already installed, their documentation,
  and their types before writing custom code or adding another package.
- Remove obsolete internal paths instead of adding compatibility layers, fallbacks, or
  parallel implementations. This does **not** authorize breaking persisted database,
  archive, public interface, or migration contracts; change those only through an
  explicit, verified migration.
- Make architectural decisions for the long term. Reject stopgaps whose intended future
  replacement is already known.

## 1. Reachability is a separate property from correctness

The recurring defect here is **correct, tested, unreachable code**. It has happened at
least eight times: a whole capability with no page calling it; a badge whose production
call site hardcoded `comparison: undefined`; a guard function whose only call sites were
its own tests; a CLI promised in the task table and never built; two validate commands
whose four tests exercised downstream pure functions and bypassed the archive-reading
path they existed to cover; a crosswalk resolver with zero production callers.

Every time, the suite was green.

**Reject** a new function, component, guard or subcommand whose only callers are tests.
A test that imports the unit is not evidence that anything reaches it. Ask for a test
that drives the real entry point — the CLI parser, the rendered page, the ingest path.

## 2. Data-shape assumptions must be stated and checked

Code correct against one file's shape and wrong against another's has caused the most
damage here. Real examples:

- `mesa_id` is globally unique in the 2025 national file and NOT in the 2023 one.
- `lista_numero` is empty throughout the 2023 generales file, populated throughout the
  PASO, and never populated on a POSITIVO row in 2025.
- The 2023 national file bundles ten categories, from PRESIDENTE Y VICE down to
  MIEMBROS DE JUNTA COMUNAL; the 2025 file carries only national ones.
- The same party has three ids: `135` (2023 PASO), `20135` (2023 generales), `110` (2025).

**Reject** a parser or key derivation that assumes one shape without saying which files
it was verified against. Ask for the check, not the assumption.

## 3. A quarantine, skip or exclusion is a silent-data-loss primitive

An ambiguity quarantine written for genuinely indistinguishable municipal rows discarded
**6.462.906 legitimate rows** — every internal list in the PASO, which is the entire point
of a primary election — and reported them as "indistinguishable in the source" when the
source distinguished them perfectly.

No test caught it. What caught it was reading the counts and noticing the distribution
did not fit.

**Require** that any quarantine, skip, filter or exclusion reports a per-category or
per-reason breakdown, not just a total. A large, plausible total is exactly how a
destructive filter survives review.

## 4. Never silently drop or silently pick

Conflicting or unmappable rows are quarantined and surfaced, never dropped and never
resolved by picking the first or summing. Granularity degradation MUST be visible.
Unmapped list ids render as unmapped, never as a bare number.

## 5. Source kinds never mix

`source_kind` defaults to `official`. Internal fiscalización data is opt-in per request
and MUST NEVER be combined with official figures in one number. The leakage guard has
three independent paths — the default query, the aggregate, and the rendered page —
and blocking one is not blocking the others.

Every fiscalización aggregate carries its coverage denominator, and `isRandomSample` is
typed as the literal `false`: coverage is 93 of 153 mesas, and the missing ~40 % is
exactly the set where the party had a fiscal present, so it is not missing at random.

## 6. Personal data

Fiscal names are stripped at ingestion and never reach the database, a fixture, a log or
a document. This repository has already leaked one real name into a design document.
When describing the problem, describe its SHAPE — never paste the values as illustration.

## 7. Statutes are the specification

Seat allocation uses **two statutory algorithms selected by level**: Hare quota with
largest remainder for PBA (Ley 5109 Arts. 109–110), D'Hondt for national (Ley 19.945
Art. 161). A journalistic explainer claiming D'Hondt governs PBA is wrong and the statute
overrides it.

The council has **18 seats total and 9 per election** — two distinct numbers, and the
seats-per-election figure is the Hare divisor. Golden-case figures come from official
documents, never from a remembered textbook example: a hand-assumed D'Hondt result of
3/2/2/0 disagreed with the computed 3/3/1/0 for identical vote totals.

## 8. One normalization boundary

Administrative codes are normalized behind a single boundary, never per call site.
Normalizing per call site produced Coronel Rosales as three separate jurisdiction
identities joined by nothing, and the same padding bug in two independent functions.

Beware the scheme collision: PBA's "distrito" `027` is a PARTIDO, while the national
scheme's distrito `02` is the PROVINCE and Coronel Rosales is its seccion `027`. A
partido total is a **seccion-level** figure. Dropping the seccion attributed 32.291
Coronel Rosales votes to the whole province.

## 9. When a test's name and its assertion disagree, the name is the specification

A test named `..._resolves_through_the_crosswalk_to_the_national_pair` asserted a single
value rather than a pair. The name described the correct behaviour; the assertion
encoded the bug.

## 10. Idempotency and Postgres specifics

- Ingestion is idempotent by `(archive_entry, election, natural key)`. The natural key
  omitting `election_id` was a live corruption path.
- Postgres never treats `NULL = NULL` as a match for `ON CONFLICT`, so a key with
  nullable columns needs an `IS NOT DISTINCT FROM` lookup.
- `IS NOT DISTINCT FROM` across several nullable columns is not hash-joinable and
  silently degrades to a nested loop; collapse to one NULL-safe key for large joins.
- `service_role` bypasses RLS but NOT object-level `GRANT`/`REVOKE`.

## 11. Strict TDD

`strict_tdd: true`. RED must be produced BEFORE the implementation exists. A RED produced
by deleting, renaming or moving finished code is a gate failure, not evidence.
