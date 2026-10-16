# Workspace onboarding

The authenticated `/onboarding` route introduces the active organization, its
available official data, and the application modules before recording completion.
This guide describes the route; automatic entry and the account-menu integration
are delivered in the next onboarding slice.

## Route

| Step | URL | Behavior |
|---|---|---|
| Organization | `/onboarding?paso=organizacion` | Select an authorized organization using the current context revision. |
| Scope | `/onboarding?paso=alcance` | Group available elections, categories, districts, and sections; retain missing/conflicting names and per-reason exclusions. |
| Guide | `/onboarding?paso=guia` | Explain each existing module and the separation of official results from nonofficial evidence. |
| Enter | `/onboarding?paso=ingreso` | Record completion for the session's active organization, then navigate to a validated `returnTo` or `/`. |

Without an active organization, requests for later steps show organization
selection instead. The existing sole-organization bootstrap selects the only
membership and starts at scope. No available organization is an explicit access
state, not an empty electoral result.

Scope loading failure is unknown availability, never "no authorized data". Each
read goes through the existing claims-bound official-facets repository. The
scope display is an availability overview, not a promise of complete mesa coverage.

## Persistence and rollback

Completion is keyed by `(user_id, organization_id)`, survives new sessions, and
is independent of other users and organizations. Repeating completion does not
create a second row or success audit event. The client cannot directly access
the completion table; the no-argument RPC validates session/context authority.

Migration `20261017000000_workspace_onboarding_completion` adds the completion
table, contextual audit action, and current-workspace flag. Its down migration
**refuses after completion audit activity** rather than deleting audit history.
An unused installation can roll back normally. Follow
[the hosted migration procedure](hosted-migrations.md) before applying it hosted;
local visual review is not migration approval.

## Development review

Use an isolated Supabase instance and synthetic accounts/results. Do not connect
preview credentials or fixture writers to hosted data. Exercise organization →
scope → guide → completion through the real app, then revisit the guide and check
mobile layout. A rendered-page test or screenshot alone does not prove completion.
