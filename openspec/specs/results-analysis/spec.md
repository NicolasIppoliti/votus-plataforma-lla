# results-analysis

Cross-year (2023 vs 2025) comparison, swing/flip detection, and 2027 scenario projection
inputs, operating at the finest granularity available per (jurisdiction, category), and
using canonical parties from `party-identity-mapping`.

## ADDED Requirements

### Requirement: Cross-year comparison at finest available granularity
For a given jurisdiction and category, the system MUST compare 2023 and 2025 results at the
finest granularity level for which both years have ingested data, and MUST state that
granularity level alongside the comparison.

#### Scenario: Mesa-level comparison available for a national category
- **GIVEN** mesa-level 2023 and 2025 national results exist for the same mesa under the same
  distrito/sección/circuito
- **WHEN** an operator requests a 2023 vs 2025 comparison for that mesa
- **THEN** the system MUST return per-mesa vote counts and shares for both years
- **AND** MUST label the comparison as `mesa`-level

#### Scenario: Only distrito-level data available for a municipal category
- **GIVEN** only distrito-level 2023 and 2025 PBA municipal results exist for Coronel Rosales
- **WHEN** an operator requests a 2023 vs 2025 municipal comparison
- **THEN** the system MUST return the distrito-level comparison
- **AND** MUST label it as `distrito`-level, not imply mesa-level detail

### Requirement: Mixed-granularity comparisons are flagged, never silently averaged
When the requested comparison would require combining data from two different granularity
levels (e.g. mesa-level 2023 vs distrito-level 2025 for the same category), the system MUST
flag the mismatch and MUST NOT silently aggregate or average across the mismatch.

#### Scenario: 2023 mesa-level data vs 2025 distrito-only data
- **GIVEN** 2023 data exists at mesa granularity for a category
- **AND** 2025 data for the same jurisdiction/category exists only at distrito granularity
- **WHEN** an operator requests a 2023 vs 2025 comparison for that category
- **THEN** the system MUST either aggregate the 2023 mesa data up to distrito level and
  clearly label the comparison as `distrito`-level for both years, or refuse to auto-combine
  and require the operator to choose the aggregation explicitly
- **AND** the system MUST NOT present the result as if both years were natively at the same
  granularity without disclosing the aggregation

### Requirement: Swing and flip detection
The system MUST compute vote-share swing between 2023 and 2025 for each canonical party at
the finest available comparable granularity, and MUST identify jurisdictions where the
leading canonical party changed ("flips").

#### Scenario: A mesa flips from one leading party to another
- **GIVEN** mesa `X` had canonical party `A` leading in 2023
- **AND** mesa `X` has canonical party `B` leading in 2025
- **WHEN** flip detection runs for that mesa
- **THEN** the system MUST report mesa `X` as flipped, from `A` to `B`, with both years'
  vote shares

#### Scenario: A mesa does not flip
- **GIVEN** mesa `Y` had canonical party `A` leading in both 2023 and 2025
- **WHEN** flip detection runs for that mesa
- **THEN** the system MUST report mesa `Y` as not flipped
- **AND** MUST still report the vote-share swing for `A` and other canonical parties present

### Requirement: Discontinuous mesa handling in comparisons
When a mesa code exists in only one of the two years being compared (per
`jurisdiction-model`'s cross-year stability tracking), the system MUST exclude it from
per-mesa swing/flip computation and MUST report it separately as a discontinuity rather than
treating a missing year as zero votes.

#### Scenario: Mesa absent in 2025 is excluded from swing computation, not zeroed
- **GIVEN** a mesa present in 2023 with no confirmed 2025 counterpart
- **WHEN** swing/flip detection runs across the affected jurisdiction
- **THEN** the system MUST exclude that mesa from the swing/flip result set
- **AND** MUST list it in a separate discontinuity report identifying it by 2023 code and
  lineage

### Requirement: Operators navigate to a result without knowing an identifier
The system MUST let an operator reach any ingested result by selecting from the
elections, jurisdictions and categories that exist in the corpus. No analysis
view may require the operator to supply a UUID it did not offer them.

Identifiers MUST remain accepted as query parameters so a reached view stays
linkable and shareable.

#### Scenario: Operator reaches a mesa result from a cold start
- **GIVEN** an authenticated operator opens the exploration surface with no
  query parameters
- **WHEN** they select an election, then a distrito, then a sección, then a mesa
- **THEN** the system MUST show votes and vote share per canonical party for
  that mesa
- **AND** the resulting URL MUST carry the selected identifiers so the same view
  can be reopened directly

#### Scenario: An unreachable combination is refused with its reason
- **GIVEN** an operator has selected an election and a jurisdiction
- **WHEN** no ingested rows exist for that combination and category
- **THEN** the system MUST state that the combination has no ingested rows
- **AND** MUST NOT render a zero-vote breakdown that is indistinguishable from a
  real result of zero

### Requirement: Vote breakdown at the selected administrative level
For a selected election, category and jurisdiction, the system MUST report votes
and vote share per canonical party at the selected level, and MUST name the
level it is reporting at.

Aggregation to a coarser level MUST sum only rows whose lineage falls under the
selected jurisdiction, and MUST NOT fabricate a finer level than the source
published.

#### Scenario: Sección total aggregates its mesas
- **GIVEN** mesa-level rows exist under one distrito/sección for an election and
  category
- **WHEN** an operator selects that sección
- **THEN** the system MUST report the summed votes per canonical party
- **AND** MUST label the report as `sección`-level
- **AND** MUST state how many mesas the total covers

#### Scenario: A distrito-only source is not projected onto mesas
- **GIVEN** a source published only a distrito total, such as
  `pba/2025-distrito-027`
- **WHEN** an operator selects a mesa under that distrito
- **THEN** the system MUST NOT attribute any part of the distrito total to that
  mesa

### Requirement: Escuela breakdown states the years it can answer for
The system MUST offer an escuela (establecimiento) breakdown only for elections
whose ingested rows carry `establecimiento_code`, and MUST state, when an
election lacks it, that the source published no establecimiento data rather than
rendering an empty breakdown.

`national/2025-legislativas` carries `establecimiento_code` on every row.
`national/2023-generales` and `national/2023-balotaje` carry none, because the
registered 2023 sources ship no establecimiento companion.

#### Scenario: Escuela breakdown for 2025
- **GIVEN** an operator selected `national/2025-legislativas` and a sección
- **WHEN** they request the escuela breakdown
- **THEN** the system MUST list each establecimiento with its votes per canonical
  party and the number of mesas it covers

#### Scenario: Escuela breakdown requested for a 2023 election
- **GIVEN** an operator selected a 2023 election
- **WHEN** they request the escuela breakdown
- **THEN** the system MUST state that the registered 2023 sources publish no
  establecimiento data
- **AND** MUST NOT present an empty list as though no votes were cast
