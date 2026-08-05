# party-identity-mapping

A curated, human-reviewed mapping of source list/alliance identifiers to a canonical party
concept, keyed by year, jurisdiction and category, so that cross-year comparisons (e.g. LLA
solo list `135` in 2023 municipal vs. the LLA+PRO alliance in 2025) are meaningful.

## ADDED Requirements

### Requirement: Curated mapping keyed by year, jurisdiction, category and list id
The system MUST maintain a mapping table whose key is the tuple
`(year, jurisdiction, category, list_id)` and whose value is a canonical party identifier.
The mapping MUST be curated (human-authored/reviewed) and MUST NOT be inferred
automatically from list names or numbers at query time.

#### Scenario: LLA solo list mapped for 2023 municipal
- **GIVEN** the curated mapping contains an entry for
  `(2023, Coronel Rosales, Concejales, list 135) → LLA`
- **WHEN** a 2023 municipal result row referencing list 135 is queried
- **THEN** the system MUST attribute that row's votes to canonical party `LLA`

#### Scenario: LLA+PRO alliance mapped separately for 2025
- **GIVEN** the curated mapping contains an entry for
  `(2025, PBA provincial, Legisladores, "Alianza La Libertad Avanza") → LLA_PRO_ALLIANCE`
- **AND** a distinct entry maps `2023` list `135` to canonical party `LLA` (not
  `LLA_PRO_ALLIANCE`)
- **WHEN** an operator requests a 2023 vs 2025 comparison for "LLA lineage"
- **THEN** the system MUST distinguish the two canonical parties in the comparison rather
  than merging them, unless the operator explicitly opts into a lineage rollup
- **AND** if a lineage rollup is used, the system MUST disclose which canonical parties were
  combined

### Requirement: Local-only lists are representable
The mapping MUST support list identifiers that exist in only one jurisdiction/year and have
no national or cross-jurisdiction counterpart (e.g. `962 — Agrupación Municipal Primero
Rosales`).

#### Scenario: Purely local list mapped without a forced national counterpart
- **GIVEN** list `962` exists only in the 2023 Coronel Rosales municipal category
- **WHEN** the curated mapping is authored for that list
- **THEN** the system MUST accept a canonical party entry for it without requiring a link to
  any national or provincial party

### Requirement: Unmapped identifiers block canonical-party attribution
The system MUST NOT resolve a list/alliance id to a canonical party without a mapping entry
covering the exact `(year, jurisdiction, category, list_id)` key.

#### Scenario: Query encounters an unmapped list id
- **GIVEN** a normalized result row exists for list id `701` under
  `(2025, national, Legislativas)`
- **AND** no mapping entry exists for that exact key
- **WHEN** the row is included in a canonical-party analysis
- **THEN** the system MUST exclude the row from canonical-party rollups
- **AND** MUST surface the row as unmapped and requiring curator action
- **AND** MUST NOT fall back to a same-list-id mapping from a different year, jurisdiction or
  category
