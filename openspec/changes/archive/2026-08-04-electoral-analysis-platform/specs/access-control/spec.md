# access-control

Authenticated, single-role internal access. No anonymous access. Per the resolved product
questions, a single authenticated role is sufficient for this change; separate
viewer/curator roles are a non-goal.

## ADDED Requirements

### Requirement: Authentication required for all access
The system MUST require successful authentication before granting access to any electoral
data, analysis, or simulation feature. No feature in scope MUST be reachable without
authentication.

#### Scenario: Unauthenticated request is rejected
- **GIVEN** a request that carries no valid authentication credential
- **WHEN** the request targets any data, analysis, or simulation endpoint in scope
- **THEN** the system MUST reject the request without returning any electoral data
- **AND** MUST respond in a way that identifies the failure as an authentication requirement

#### Scenario: Authenticated request succeeds
- **GIVEN** a request carrying a valid authentication credential for a registered user
- **WHEN** the request targets a data, analysis, or simulation endpoint in scope
- **THEN** the system MUST process the request and MAY return the requested data

### Requirement: Single authenticated role
The system MUST support exactly one authenticated role for this change: any authenticated
user has the same access to all in-scope data, analysis, and simulation features. The system
MUST NOT implement or expose a public/anonymous tier.

#### Scenario: Any authenticated user reaches every in-scope feature
- **GIVEN** two distinct authenticated users, neither with any special privilege flag
- **WHEN** each requests any in-scope data, analysis, or simulation feature
- **THEN** the system MUST grant both users identical access to that feature

#### Scenario: No anonymous read path exists
- **GIVEN** the system as delivered by this change
- **WHEN** any route or query serving electoral data, analysis or simulation results is
  invoked without authentication
- **THEN** the system MUST NOT return data through any code path, including cached or
  pre-rendered content
