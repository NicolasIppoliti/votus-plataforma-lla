# jurisdiction-model

The normalized jurisdiction hierarchy (distrito / sección / circuito / establecimiento /
mesa) and the curated crosswalk reconciling national and PBA numbering schemes, and 2023
vs 2025 code stability, that all other capabilities depend on for granularity-aware queries.

## ADDED Requirements

### Requirement: Explicit jurisdiction hierarchy
The system MUST model electoral jurisdictions as an explicit hierarchy of levels: distrito,
sección (provincial/electoral), circuito, establecimiento, mesa. Every stored result MUST be
attributable to exactly one level of this hierarchy — never an ambiguous or implicit level.

#### Scenario: A mesa-level result is stored with full lineage
- **GIVEN** a normalized result row at mesa granularity
- **WHEN** the row is persisted
- **THEN** the system MUST record its distrito, sección, circuito, establecimiento and mesa
  identifiers
- **AND** the row's granularity level MUST be recorded as `mesa`

#### Scenario: A distrito-level aggregate is stored without inventing lower levels
- **GIVEN** a normalized result row whose source only publishes distrito totals
- **WHEN** the row is persisted
- **THEN** the system MUST record only the distrito identifier and the granularity level as
  `distrito`
- **AND** MUST NOT populate sección, circuito, establecimiento or mesa fields with
  fabricated or inferred values

### Requirement: National-to-PBA code crosswalk
The system MUST maintain a curated, human-reviewed crosswalk table mapping PBA-issued
distrito/sección/circuito codes to the corresponding national (DINE) codes for every
jurisdiction covered by this change. The crosswalk MUST NOT be inferred automatically from
name-matching alone.

#### Scenario: Coronel Rosales resolves across both numbering schemes
- **GIVEN** the curated crosswalk contains an entry for PBA distrito `027` (Coronel Rosales)
- **WHEN** a query requests Coronel Rosales results from either the national or the PBA
  source
- **THEN** the system MUST resolve both sources to the same canonical jurisdiction record

#### Scenario: An unmapped jurisdiction code is encountered
- **GIVEN** an ingested result row carries a distrito/sección/circuito code with no entry in
  the curated crosswalk
- **WHEN** the row is ingested
- **THEN** the system MUST reject or quarantine the row rather than silently assigning it to
  an unrelated jurisdiction
- **AND** MUST record the unmapped code as requiring curator attention

### Requirement: Cross-year code stability tracking
The system MUST track, per jurisdiction code, whether that code has been confirmed stable
between the 2023 and 2025 elections, and MUST NOT assume stability by default.

#### Scenario: A mesa code confirmed present in both years
- **GIVEN** a mesa code that appears in both the 2023 and 2025 archived national sources
  under the same distrito/sección/circuito lineage
- **WHEN** the crosswalk is built or refreshed
- **THEN** the system MUST mark that mesa code as stable across 2023 → 2025

#### Scenario: A mesa code present in one year but absent in the other
- **GIVEN** a mesa code present in the 2023 archived source under a given
  distrito/sección/circuito
- **AND** no mesa with that code exists under the same lineage in the 2025 archived source
- **WHEN** a cross-year comparison is requested for that mesa
- **THEN** the system MUST report the mesa as having no 2025 counterpart (or vice versa)
- **AND** MUST NOT substitute a different mesa's data as if it were a continuation
- **AND** MUST surface this as a data-continuity gap to the operator, not omit it silently
