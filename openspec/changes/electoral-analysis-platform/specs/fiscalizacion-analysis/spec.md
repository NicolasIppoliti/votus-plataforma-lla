# fiscalizacion-analysis

Ingestion, storage, and query-time isolation of the party-internal fiscalización
spreadsheet (26 Oct 2025 national legislative election, Coronel Rosales) as a distinct,
non-official, partial-coverage source class. Never merged with official figures. See
design ADR D9 for the source evidence and D6/D7's mixed-granularity and review-queue
mechanisms this capability extends.

## Purpose

Party operators supplied a hand-maintained fiscalización sheet mid-change. It is useful
signal but structurally different from official results: self-selected coverage (only
mesas where a fiscal was present), personal data in the raw source, and hand-maintained
re-export drift. This spec makes that difference a queryable, testable contract rather
than tribal knowledge.

## Requirements

### Requirement: Fiscalización is a distinct, opt-in-only source class
Every archived entry and every stored result row derived from the fiscalización sheet
MUST carry `source_kind = 'fiscalizacion'`, distinct from `source_kind = 'official'`. The
system MUST default every query to `source_kind = 'official'` and MUST return
fiscalización rows only when the caller supplies an explicit, per-request opt-in.
Fiscalización rows MUST NEVER be combined with official rows inside one returned figure.

#### Scenario: Default query excludes fiscalización
- **GIVEN** `result_row` contains both official and fiscalización rows for the same
  jurisdiction/category
- **WHEN** a caller queries without an explicit unofficial opt-in
- **THEN** the system MUST return only `source_kind = 'official'` rows

#### Scenario: Aggregate excludes fiscalización without opt-in
- **GIVEN** the same mixed `result_row` set
- **WHEN** a caller requests an aggregate total without an explicit opt-in
- **THEN** the aggregate MUST include only official votes
- **AND** the aggregate MUST report `sourceKind: 'official'`

#### Scenario: Rendered page excludes fiscalización without opt-in
- **GIVEN** an authenticated operator viewing the default comparison page
- **AND** the underlying database contains fiscalización rows
- **WHEN** the page is rendered without an explicit unofficial opt-in
- **THEN** the rendered HTML MUST NOT contain any fiscalización/unofficial-source marker

#### Scenario: Fiscalización query refused without an explicit opt-in
- **GIVEN** a caller invokes the fiscalización-specific query path
- **WHEN** no opt-in is supplied
- **THEN** the system MUST refuse with a status identifying that an explicit unofficial
  opt-in is required, and MUST return no rows

### Requirement: Fiscalización figures carry a mandatory, non-random coverage denominator
Every fiscalización aggregate or figure MUST carry a `Coverage` value (observed units,
denominator, basis) and MUST be refused without one. `Coverage.isRandomSample` MUST be
the literal type `false` — the covered set (93 of 153 mesas) is exactly where the party
had a fiscal present, which is not missing at random, and the system MUST make the
"this is a representative sample" claim unrepresentable rather than merely discouraged.

#### Scenario: Fiscalización query accepted with a valid coverage opt-in
- **GIVEN** a caller supplies an opt-in carrying `observedUnits: 93`,
  `denominatorUnits: 153`, and `isRandomSample: false`
- **WHEN** the fiscalización query path is invoked
- **THEN** the system MUST return fiscalización rows
- **AND** MUST NOT also return official rows in that same response

#### Scenario: Coverage cannot assert randomness
- **GIVEN** the `Coverage` type used by any fiscalización figure
- **WHEN** a caller attempts to construct a `Coverage` value with `isRandomSample: true`
- **THEN** the system MUST reject it at the type level (compile error) or, at any runtime
  boundary accepting external input, at validation time

### Requirement: Personal data is stripped before any value is persisted or logged
Fiscal names (`Nombre`/`Apellido`) MUST be removed from the raw fiscalización text before
any row is parsed into a value, so no database column, review-queue note, log line, or
committed fixture can ever carry a name. `source_row_index` is retained for review-queue
lineage in place of any name-based identifier. `Escuela` MUST be retained — it is an
establecimiento label, not personal data.

#### Scenario: No loaded column or review-queue note contains a name
- **GIVEN** the raw fiscalización CSV containing `Nombre`/`Apellido` columns
- **WHEN** the sheet is ingested end to end, including any row that generates a
  review-queue note
- **THEN** no resulting row, column, or note MUST contain a fiscal's name
- **AND** `Escuela` values MUST still be present and unmodified in their raw form

#### Scenario: Committed fixtures are personal-data-stripped
- **GIVEN** a fiscalización CSV fixture committed to the repository for tests
- **WHEN** the fixture's header row is inspected
- **THEN** it MUST NOT contain a `Nombre` or `Apellido` column

#### Scenario: Fiscalización entries never reach a shared upload target
- **GIVEN** a fiscalización source entry
- **WHEN** the archive layer considers it for upload to any remote/shared destination
- **THEN** the system MUST refuse the upload; fiscalización entries MUST stay in the
  local mirror only

### Requirement: Ordered ingestion contract for the hand-maintained spreadsheet
Ingestion of the fiscalización sheet MUST apply, in this order: (1) merge a row whose
`Mesa` is empty into the immediately preceding row when their non-blank columns are
disjoint, never quarantining on an empty `Mesa` key first; (2) collapse residual
duplicate `Mesa` rows whose vote vectors are identical into one row; (3) quarantine —
never drop — any row that is still an unresolved conflict (differing duplicate vote
vectors, or an empty-`Mesa` row that could not be merged); (4) treat a blank vote cell
as MISSING, never as zero.

#### Scenario: Wrapped continuation row is merged, not quarantined
- **GIVEN** a row with an empty `Mesa` whose non-blank columns are disjoint from the
  preceding row's non-blank columns
- **AND** both rows carry the same `Escuela`
- **WHEN** ingestion runs
- **THEN** the system MUST merge it into the preceding row
- **AND** MUST NOT quarantine it

#### Scenario: Continuation row from a different establecimiento is never merged
- **GIVEN** a row with an empty `Mesa` whose non-blank columns are disjoint from the
  preceding row's, but whose `Escuela` differs
- **WHEN** ingestion runs
- **THEN** the system MUST NOT merge it into the preceding row, because doing so would
  attribute one establecimiento's votes to another
- **AND** MUST quarantine it as unmergeable rather than dropping it

#### Scenario: Identical duplicate rows collapse to one
- **GIVEN** two or more rows for the same `Mesa` with identical vote vectors
- **WHEN** ingestion runs
- **THEN** the system MUST produce exactly one row for that `Mesa`

#### Scenario: Conflicting duplicate is quarantined, never dropped
- **GIVEN** two rows for the same `Mesa` whose vote vectors differ
- **WHEN** ingestion runs
- **THEN** the system MUST quarantine both rows rather than silently picking one or
  discarding either

#### Scenario: Blank vote cell is missing, not zero
- **GIVEN** a row with a blank cell in a vote column
- **WHEN** ingestion runs
- **THEN** the resulting value for that column MUST be recorded as missing/absent
- **AND** MUST NOT be recorded as `0`

#### Scenario: End-to-end row count matches the measured source
- **GIVEN** the real 105-raw-row fiscalización source
- **WHEN** merge, then collapse, then quarantine run in that order
- **THEN** the system MUST converge to 93 unique mesa rows

### Requirement: Mesa-level join to official results; tally divergence is informational
Fiscalización rows MUST join to official results at mesa level within the same
distrito/sección. A tally divergence between a fiscalización row and its official
counterpart MUST be recorded as an informational review item and MUST NOT be treated as
a join failure or block ingestion. A category-definition difference between an
`Impugnado`/`En blanco` fiscal judgement and the definitive escrutinio's resolution of
the same category MUST NOT be classified as drift.

#### Scenario: Mesa join succeeds despite tally divergence
- **GIVEN** a fiscalización mesa row and its same-numbered official mesa row with
  differing `Impugnado` counts
- **WHEN** the join runs
- **THEN** the system MUST join the two rows successfully
- **AND** MUST record the divergence as an informational review item, not an error

### Requirement: Re-export drift on the fiscalización source is informational, not a warning
A changed sha256 on re-fetch of the fiscalización source MUST be classified as
`(kind: source_reexported, severity: info)`, distinct from the `content_drift` warning
used for official archived sources, because the hand-maintained sheet is expected to
change over time.

#### Scenario: Fiscalización re-export does not raise a content-drift warning
- **GIVEN** a previously archived fiscalización entry
- **WHEN** a re-fetch returns a different sha256
- **THEN** the system MUST classify the change as `source_reexported` with severity `info`
- **AND** MUST NOT classify it as `content_drift`

### Requirement: Cross-election juxtaposition against a different election's official figure is structurally hard
Fiscalización covers the 26 Oct 2025 national legislative election. Any rendered view that
presents a fiscalización figure alongside an official figure from a DIFFERENT election
(e.g. the 2023 municipal result) MUST carry both the unofficial-source badge and the
coverage badge on the fiscalización figure, and MUST NOT present the pair as a
like-for-like comparison. The system MUST NOT offer a code path that produces such a
juxtaposition without both badges attached.

#### Scenario: Fiscalización figure shown beside a different election's official figure
- **GIVEN** a view renders the 2025 fiscalización LLA share next to the 2023 municipal
  official LLA share
- **WHEN** the view is rendered
- **THEN** the fiscalización figure MUST carry both the unofficial-source badge and the
  coverage badge
- **AND** the view MUST NOT imply the two figures are directly comparable without
  disclosing the different elections and the non-random coverage

## RESOLVED — the operator route is IN SCOPE for this change

The product owner has decided: an operator-facing fiscalización view belongs in THIS
change. The requirements below are therefore mandatory, not deferred.

### Requirement: An operator route reaches fiscalización through the opt-in path
The system MUST provide an authenticated operator route that renders fiscalización figures,
and that route MUST obtain them through the same explicit opt-in path every other consumer
uses. It MUST NOT introduce a second query path that bypasses the source-kind default.

#### Scenario: The route requests fiscalización explicitly
- **GIVEN** an authenticated operator opens the fiscalización view
- **WHEN** the page loads its data
- **THEN** it MUST call the opt-in query path with a coverage argument
- **AND** MUST NOT read fiscalización rows through the default official-only path

#### Scenario: The route refuses to render without coverage
- **GIVEN** a request for the fiscalización view that supplies no coverage
- **WHEN** the page loads
- **THEN** it MUST render the refusal state, not an unlabelled figure

#### Scenario: Every rendered fiscalización figure is labelled unofficial
- **GIVEN** the fiscalización view has rendered figures
- **WHEN** an operator reads any one of them
- **THEN** each MUST carry a visible unofficial-source indicator and its coverage
  denominator, stating the covered and total mesa counts
- **AND** the coverage indicator MUST state that the covered mesas are not a random sample

#### Scenario: Official figures are never rendered inside the fiscalización view without their own label
- **GIVEN** the fiscalización view also displays an official figure for context
- **WHEN** the page renders
- **THEN** the official figure MUST carry its own official-source indicator, so the two
  source kinds are never visually interchangeable

### Requirement: The cross-election juxtaposition badge is reachable and exercised
Requirement 7's juxtaposition rule was previously unimplementable because no route rendered
a fiscalización figure at all. With the route in scope, it becomes testable and MUST be
covered by a test that fails if either badge is removed.

#### Scenario: A fiscalización figure beside a different election's official figure
- **GIVEN** the view shows a fiscalización figure from the 26 Oct 2025 election beside an
  official figure from a different election
- **WHEN** the page renders
- **THEN** both figures MUST carry their election identity and their source kind
- **AND** the non-random coverage of the fiscalización figure MUST be stated adjacent to it,
  not only in a page-level footnote
