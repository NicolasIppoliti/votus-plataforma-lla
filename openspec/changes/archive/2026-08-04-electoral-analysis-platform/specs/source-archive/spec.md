# source-archive

Provenance-tracked, immutable fetch/hash/manifest layer for official electoral sources
(national DINE ZIPs, PBA Junta Electoral pages/PDFs, PBA CKAN datasets). Raw archived files
are the ground truth for everything downstream; nothing derived from them is ever hand-edited.

## ADDED Requirements

### Requirement: Immutable raw fetch and storage
The system MUST fetch each registered source URL and store the retrieved bytes in a
local mirror without ever overwriting or mutating a previously stored copy of the same
fetch.

#### Scenario: First fetch of a registered source
- **GIVEN** a registered source URL that has never been fetched
- **WHEN** the archive process runs for that source
- **THEN** the system MUST store the fetched bytes as a new immutable archive entry
- **AND** the entry MUST record the source URL and the fetch timestamp

#### Scenario: Re-fetch never mutates a prior archive entry
- **GIVEN** a source URL that already has one or more archived fetch entries
- **WHEN** the archive process re-fetches that source URL
- **THEN** the system MUST create a new archive entry rather than overwrite any existing one
- **AND** every previously archived entry for that URL MUST remain byte-for-byte unchanged

### Requirement: Content hashing
The system MUST compute a sha256 digest of every archived file's bytes at fetch time and
persist that digest alongside the archive entry.

#### Scenario: sha256 recorded on fetch
- **GIVEN** a source file has been successfully fetched
- **WHEN** the system stores the archive entry
- **THEN** the system MUST compute and persist the sha256 digest of the exact bytes stored

### Requirement: Manifest of archived sources
The system MUST maintain a manifest recording, for every archived fetch: source URL,
sha256 digest, fetch timestamp, and byte size.

#### Scenario: Manifest entry created per fetch
- **GIVEN** a fetch of a registered source has completed successfully
- **WHEN** the archive entry is persisted
- **THEN** the manifest MUST gain a corresponding entry with URL, sha256, timestamp and size

#### Scenario: Manifest queryable by source
- **GIVEN** a source URL with one or more archive entries
- **WHEN** the manifest is queried for that URL
- **THEN** the system MUST return every archive entry recorded for it, in fetch order

### Requirement: Content-drift detection
When a source is re-fetched and its content sha256 differs from the sha256 of the most
recent prior archive entry for the same URL, the system MUST flag the fetch as content
drift rather than silently treating it as identical.

#### Scenario: Re-fetch with identical content
- **GIVEN** a source URL whose most recent archived sha256 is `H1`
- **WHEN** the source is re-fetched and the newly fetched bytes also hash to `H1`
- **THEN** the system MUST record the fetch as a no-drift re-fetch
- **AND** MUST NOT raise a drift flag

#### Scenario: Re-fetch with changed content
- **GIVEN** a source URL whose most recent archived sha256 is `H1`
- **WHEN** the source is re-fetched and the newly fetched bytes hash to `H2` where `H2 != H1`
- **THEN** the system MUST record the fetch as a new archive entry with sha256 `H2`
- **AND** MUST flag the URL as having experienced content drift
- **AND** MUST surface the drift flag to whoever reviews ingestion runs, not just log it silently

### Requirement: Fetch failure handling
When a fetch attempt fails (network error, non-2xx response, timeout), the system MUST
NOT create a partial or corrupt archive entry, and MUST leave the most recent successful
archive entry for that source untouched and usable.

#### Scenario: Source temporarily unreachable
- **GIVEN** a source URL with at least one prior successful archive entry
- **WHEN** a scheduled re-fetch of that URL fails (e.g. connection refused, HTTP 5xx, timeout)
- **THEN** the system MUST record the failure (URL, timestamp, error reason) without creating
  a new archive entry
- **AND** the last successful archive entry MUST remain the one used by downstream ingestion
- **AND** the failure MUST be surfaced as an actionable operational signal, not silently dropped

#### Scenario: Source has never been successfully fetched and is unreachable
- **GIVEN** a source URL with no prior successful archive entry
- **WHEN** the fetch fails
- **THEN** the system MUST record the failure
- **AND** any capability depending on that source's data MUST report the data as unavailable
  rather than substituting empty or default results
