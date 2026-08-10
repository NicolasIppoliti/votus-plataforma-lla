# provenance-display

Every figure shown to an operator MUST carry a visible granularity indicator. Every
historical figure MUST be traceable to an archived source with its sha256. A hypothetical
projection is exempt from archived-source linkage only when it is explicitly labelled as a
projection and bound to a stable trace of its supplied input. The tool MUST carry a
persistent "not an official electoral source" disclaimer.

## ADDED Requirements

### Requirement: Every displayed historical figure is traceable to its archived source
For every historical electoral figure rendered to an operator (vote count, share, seat
count, swing, flip status), the system MUST provide a way to trace that figure back to the
specific archived source file, its sha256 digest, its original source URL, and its fetch
timestamp. This requirement applies to every figure except a qualifying hypothetical
projection under the projection exception below.

#### Scenario: Operator traces a displayed vote count to its source
- **GIVEN** a displayed mesa-level vote count for a canonical party
- **WHEN** the operator requests the provenance of that figure
- **THEN** the system MUST return the archived source file's identifier, sha256 digest,
  original source URL, and fetch timestamp that the figure was derived from

#### Scenario: A derived figure (e.g. swing) discloses all contributing sources
- **GIVEN** a displayed swing figure computed from a 2023 and a 2025 archived source
- **WHEN** the operator requests the provenance of that figure
- **THEN** the system MUST list both contributing archive entries with their sha256 digests

#### Scenario: Historical simulation provenance is loaded from trusted storage
- **GIVEN** a displayed seat allocation is labelled as historical
- **WHEN** the operator requests its provenance
- **THEN** the system MUST show the validated archive entry identifier, sha256 digest,
  original source URL, fetch timestamp, and normalized input granularity loaded server-side
- **AND** MUST NOT source any of those fields or the historical vote totals from caller JSON

### Requirement: Hypothetical projections use a supplied-input trace, not archive provenance
A hypothetical projection MAY omit archived-source linkage only when the display labels it
as a projection, shows its normalized input granularity, and binds the exact validated input
to a stable canonical digest. The digest MUST be labelled as a supplied-input trace and MUST
NOT be presented as an archive sha256 or evidence of historical provenance.

#### Scenario: Projection is identifiable without claiming archived provenance
- **GIVEN** an operator supplies a valid hypothetical seat-allocation scenario
- **WHEN** the projection is rendered
- **THEN** the display MUST label it as a hypothetical projection
- **AND** MUST show the normalized input granularity
- **AND** MUST show a stable canonical digest labelled as a supplied-input trace, not archive
  provenance
- **AND** equivalent JSON object-key orderings MUST produce the same digest
- **AND** a changed validated input value MUST produce a different digest

### Requirement: Visible granularity indicator on every figure
Every displayed figure MUST carry a visible indicator of the granularity level it was
computed at (e.g. `mesa`, `establecimiento`, `circuito`, `distrito`), and MUST indicate when
that granularity is a degradation from a finer level that was requested but unavailable.

#### Scenario: Mesa-level figure shows a mesa indicator
- **GIVEN** a figure computed from mesa-level normalized data
- **WHEN** it is rendered to the operator
- **THEN** the display MUST include a visible `mesa`-level indicator

#### Scenario: Degraded-granularity figure discloses the degradation
- **GIVEN** an operator requested mesa-level municipal results
- **AND** the system degraded to distrito-level per `electoral-ingestion`'s degradation rule
- **WHEN** the resulting figure is rendered
- **THEN** the display MUST show the `distrito`-level indicator
- **AND** MUST visibly note that this is a degradation from the requested mesa-level view

### Requirement: Persistent non-official-source disclaimer
The system MUST display a visible "not an official electoral source" disclaimer to every
authenticated user viewing electoral figures, and MUST NOT allow this disclaimer to be
permanently dismissed such that it never appears again.

#### Scenario: Disclaimer present on every results view
- **GIVEN** an authenticated operator viewing any page or view presenting electoral figures
- **WHEN** the view is rendered
- **THEN** the system MUST display the "not an official electoral source" disclaimer
  somewhere visible on that view

#### Scenario: Mixed-granularity comparison is flagged in the display, not just the API
- **GIVEN** a mixed-granularity comparison per `results-analysis`'s flagging requirement
- **WHEN** the comparison is rendered to the operator
- **THEN** the display MUST visibly flag the mixed-granularity condition, not merely
  encode it in an API response field the UI ignores
