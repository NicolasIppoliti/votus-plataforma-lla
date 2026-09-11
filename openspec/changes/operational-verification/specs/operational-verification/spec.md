# Operational Verification Specification

## Purpose

Provide responsible internal operators a usable, bounded procedure for private diagnosis of selected deployed-state evidence without converting incomplete observation into readiness, security, or release certification.

## Requirements

### Requirement: Constructible bounded procedure

The system MUST provide a clear operator entrypoint, usable procedure, and sanitized evidence template. Procedure construction and review MAY be accepted without live execution; every live execution SHALL require separate later authorization.

The procedure MUST NOT prescribe or require a new runtime, architecture, table, CLI, ledger, telemetry service, deployment, repair, ingestion, account creation, permission widening, fabricated JWT, service key, or bypass path.

#### Scenario: Procedure is accepted without execution

- GIVEN the procedure and template are complete
- WHEN no live execution is authorized
- THEN they MAY be accepted without hosted contact or a readiness claim

#### Scenario: Live execution lacks authority

- GIVEN an operator requests execution without required approvals
- WHEN the procedure is invoked
- THEN it MUST refuse and record the result as refused or not ready

### Requirement: Approved scope precedes observation

Before any future observation, the procedure MUST require the exact target, expected revision, existing approved accounts, selected official 2023/2025 sources and categories, and compatible granularity for Coronel Rosales, national distrito `02`, sección `027`.

It MUST preserve source, category, and granularity provenance and MUST NOT include fiscalización, raw rows or payloads, unapproved targets, or target enumeration. Negative cases MUST use only approved accounts and targets; an unavailable approved case MUST be not verified.

#### Scenario: Approved selected reconciliation

- GIVEN all selected-scope approvals are present
- WHEN an operator reconciles an authorized aggregate
- THEN evidence MUST identify source, category, and compatible granularity
- AND it MUST NOT infer availability from a manifest, mapping count, or CI

#### Scenario: Required scope is absent

- GIVEN a required approval or selected input is unavailable
- WHEN the affected observation is reached
- THEN it MUST be unknown, not observed, or not verified, never zero or certified

### Requirement: Bounded observation semantics and safe stop

Every attempted observation MUST distinguish observed, mismatch, unknown, and refused/not-ready outcomes, with reasons and limitations. A valid empty result MAY be zero only when an authorized, supported aggregate establishes it; missing or unauthorized evidence MUST NOT become zero.

Deployment evidence MUST distinguish approved revision from served target/domain provenance. Migration evidence MUST be limited to timestamp-inventory alignment, not SQL identity or schema-drift absence. JWT validation, Auth-server session validity, entitlement, grants, RLS, function execution, API exposure, and route/status/cache behavior MUST be distinct claims.

#### Scenario: Evidence supports only a bounded claim

- GIVEN an authorized scoped observation
- WHEN its outcome is recorded
- THEN the record MUST state only the supported claim and retain other claims as unknown

#### Scenario: Mismatch or unsafe result occurs

- GIVEN a mismatch, leakage risk, or missing authority
- WHEN the affected check is evaluated
- THEN the procedure MUST stop that check, record its scope and limitation, and perform no repair, deployment, ingestion, access broadening, or passing inference

### Requirement: Private, sanitized, human-evaluated evidence

Each evidence record MUST contain observation time, scoped provenance, opaque actor or approval reference, outcome, and mismatch or unknown reason; it MUST exclude personal data, credentials, tokens, cookies, raw payloads, and logs.

Evidence MUST remain private and outside Git for 30 days, then be deleted by the responsible internal operator. Repository materials MUST contain only sanitized templates and synthetic examples. Refused, not-ready, and rejected-payload counts MUST NOT be exposed by evidence records or their UI; this MUST NOT change existing API transport contracts. Outcomes MUST remain subject to human evaluation and MUST NOT automatically approve or block releases.

#### Scenario: Private evidence is retained

- GIVEN an authorized observation completes
- WHEN its evidence is recorded
- THEN it MUST be sanitized, privately retained for no more than 30 days, and include its required outcome and provenance

#### Scenario: Repository template is prepared

- GIVEN a repository-facing procedure or template
- WHEN it includes an example
- THEN the example MUST be synthetic and MUST NOT contain live evidence or rejected-payload counts

### Requirement: Aggregate and ownership limits

Authorized official aggregate reconciliation MUST retain meaningful permitted exclusion breakdowns by category or reason and label results as approved selected scope. It MUST NOT hide allowed category or reason results or treat an exclusion total as a global prohibition on legitimate official exclusion counts.

Storage retention/encryption and telemetry ownership MUST be observed or unknown only. Metadata access, Data API GET/HEAD read-only behavior, or a successful provider observation MUST NOT prove zero provider/Auth state effects, effective route authorization, or permission to access sensitive catalogs or function definitions.

#### Scenario: Authorized exclusions are meaningful

- GIVEN an approved aggregate includes permitted exclusions
- WHEN reconciliation evidence is recorded
- THEN it MUST retain the allowed category or reason breakdown

#### Scenario: Ownership evidence is unavailable

- GIVEN no authorized ownership evidence exists
- WHEN the procedure reaches storage or telemetry ownership
- THEN it MUST record unknown and MUST NOT obtain broader metadata or make an unsafe claim