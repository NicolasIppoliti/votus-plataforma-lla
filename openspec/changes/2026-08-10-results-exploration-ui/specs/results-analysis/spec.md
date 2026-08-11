# results-analysis

## ADDED Requirements

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
