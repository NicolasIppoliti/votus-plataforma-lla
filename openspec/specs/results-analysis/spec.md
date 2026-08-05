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
