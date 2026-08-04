# electoral-ingestion

Parsing of archived national ZIPs and PBA sources into the normalized electoral data model
(see `jurisdiction-model`). Ingestion is idempotent and produces a rebuildable projection:
it MAY always be dropped and regenerated from the immutable archive.

## ADDED Requirements

### Requirement: Idempotent, rebuildable ingestion
Re-running ingestion against the same set of archived source files MUST produce an
identical normalized dataset. The normalized layer MUST always be fully derivable by
rebuilding from the archive, with no hand-edited data mixed into it.

#### Scenario: Re-running ingestion twice yields the same data
- **GIVEN** an archived national results ZIP that has already been ingested once
- **WHEN** ingestion is run again against the same archive entry
- **THEN** the resulting normalized dataset MUST be identical to the result of the first run
- **AND** no duplicate result rows MUST be created

#### Scenario: Full rebuild from archive
- **GIVEN** an existing normalized dataset built from a set of archive entries
- **WHEN** the normalized layer is dropped and ingestion is re-run from those same archive
  entries
- **THEN** the rebuilt normalized dataset MUST be identical to the dataset before the drop

### Requirement: National ZIP ingestion (2023 and 2025)
The system MUST parse the archived 2023 (PASO, Generales, Balotaje) and 2025 (Legislativas)
national results ZIPs into the normalized jurisdiction/results model at the finest
granularity present in each file (mesa, per the national preservation standard).

#### Scenario: 2023 Generales mesa rows ingested
- **GIVEN** the archived 2023 Generales ZIP is available
- **WHEN** national ingestion runs for that archive entry
- **THEN** the system MUST produce one normalized result row per (mesa, list/agrupación,
  category) combination present in the source file
- **AND** each row MUST record its granularity as `mesa`

#### Scenario: BUP-era 2025 format handled or explicitly rejected
- **GIVEN** the archived 2025 Legislativas ZIP, produced under the Boleta Única de Papel
  ballot format
- **WHEN** national ingestion runs for that archive entry
- **THEN** the system MUST either parse it successfully into the same normalized model as
  2023, or MUST fail loudly with a schema-mismatch error identifying the unrecognized
  structure, rather than silently ingesting partial or misaligned data

### Requirement: PBA provincial and municipal ingestion at maximum available granularity
The system MUST ingest PBA provincial (2025) and PBA municipal (2023 and 2025, Coronel
Rosales) results at the finest granularity confirmed available for that (year, jurisdiction,
category) combination, which MAY be distrito-level aggregate per the accepted fallback
(see proposal "Resolved Product Questions" #1). PDF/telegrama OCR extraction is explicitly
OUT OF SCOPE; the system MUST NOT attempt it.

#### Scenario: Distrito-level PBA municipal totals ingested
- **GIVEN** an archived PBA municipal source (e.g. the Coronel Rosales 2023 escrutinio
  definitivo PDF-derived data) that publishes only distrito-level totals
- **WHEN** ingestion runs for that archive entry
- **THEN** the system MUST produce normalized result rows at `distrito` granularity for the
  intendente/concejales/consejeros escolares categories
- **AND** MUST NOT fabricate mesa- or circuito-level rows

#### Scenario: No PBA source available for a given category
- **GIVEN** no archived source exists yet for a given (year, jurisdiction, category)
  combination in scope
- **WHEN** a query requests results for that combination
- **THEN** the system MUST report the data as unavailable, and MUST NOT return zero-filled
  or estimated figures

### Requirement: Unmapped party/list identifier handling
When ingestion encounters a list or alliance identifier with no entry in the curated
party-identity-mapping table (see `party-identity-mapping`) for the applicable
(year, jurisdiction, category), the system MUST NOT silently attribute it to any canonical
party.

#### Scenario: Unmapped list id encountered during ingestion
- **GIVEN** a source row referencing list id `999` for `(2025, PBA provincial, Legisladores)`
- **AND** no curated mapping entry exists for that key
- **WHEN** ingestion processes that row
- **THEN** the system MUST store the result row with its raw list id and mark it as
  unmapped, rather than dropping it or guessing a canonical party
- **AND** unmapped rows MUST be excluded from any canonical-party rollup or comparison until
  a curator adds the mapping
- **AND** the unmapped condition MUST be surfaced as requiring curator attention

### Requirement: Granularity degradation is explicit, never silent
For any (year, jurisdiction, category) combination, when the requested granularity level is
unavailable, the system MUST degrade to the finest level actually available and MUST record
that degradation as a first-class attribute of the resulting data, not merely in a log.

#### Scenario: Mesa level requested but only distrito available
- **GIVEN** a query requests mesa-level PBA municipal results for Coronel Rosales, 2023
- **AND** only distrito-level totals were ingested for that combination
- **WHEN** the query is served
- **THEN** the system MUST return the distrito-level data
- **AND** MUST mark the response as degraded from the requested granularity, identifying the
  granularity actually returned
