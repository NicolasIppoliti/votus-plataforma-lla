# fiscalizacion-analysis

## ADDED Requirements

### Requirement: Fiscalización is presented as coverage, not as a rival tally
The system MUST present the fiscalización corpus as a map of where the party had
a fiscal present, reporting the mesas and escuelas it covers and, explicitly,
the ones it does not.

The fiscalización-versus-official tally comparison remains available through the
review queue and MUST NOT be the entry point to fiscalización data.

#### Scenario: Coverage for a sección names the uncovered mesas
- **GIVEN** fiscalización rows exist for 93 of the 153 mesas of one sección for
  an election
- **WHEN** an operator opens fiscalización coverage for that sección
- **THEN** the system MUST report 93 covered and 60 uncovered mesas
- **AND** MUST identify the uncovered mesas
- **AND** MUST state that absence of coverage is not absence of votes

#### Scenario: Coverage is not read as a result
- **GIVEN** a mesa with no fiscalización row
- **WHEN** an operator views that mesa's coverage
- **THEN** the system MUST distinguish "no fiscal was present" from "the party
  received no votes"

### Requirement: Coverage denominator declares the scope it describes
Coverage MUST state the jurisdiction and election its denominator describes, and
MUST derive that denominator from the official rows ingested for the same scope
rather than from a separately configured identifier.

#### Scenario: Denominator follows the selected sección
- **GIVEN** an operator selects a sección with 153 official mesas for an election
- **WHEN** coverage is reported
- **THEN** the denominator MUST be those 153 mesas
- **AND** MUST be labelled with that sección and election

#### Scenario: Denominator cannot be stated
- **GIVEN** no official rows are ingested for the selected scope
- **WHEN** an operator opens coverage
- **THEN** the system MUST refuse and say the denominator cannot be derived
- **AND** MUST NOT present a covered count with no denominator
