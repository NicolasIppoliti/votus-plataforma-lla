# Seat simulation prototype

An isolated, single-screen design artifact for Votus. It does not modify or connect
to the production application, archive, database, authentication or ETL. Approved
Exploration and Comparison artifacts remain unchanged. Navigation links only open
their existing local previews. There is no scenario persistence.

## Design

The existing midnight-navy/cyan/Plex visual language is retained. A territorial map
is the primary work surface, with a compact fixed-total transfer editor and renewal
seat impact to its right. Exact vote/share/seat figures and deterministic sensitivity
remain available below the map rather than competing with its hierarchy. Winner
colors encode fictional A–D identities, never strength or probability.

## Synthetic baseline and electoral scope

The baseline is the immutable fictional Council partition from the Exploration
fixture. The 2025 four-list totals are A21,482/B18,736/C6,924/D2,158 (49,300 total).
The 2023 fictional total is 48,800. Neither sample represents official results or
establishes a forecast for 2027. Shares use modeled positive votes only: turnout,
blank/annulled votes and voter-level behavior are not modeled.

The complete Rosales municipal aggregate retains its original demonstration
allocation, with nine renewal seats and eighteen total council seats. The other
nine retained seats have **unknown composition**; the prototype does not infer a
full council majority. Circuit, establishment and mesa inspection exposes each
unit's own exact baseline votes, not a legislature or spatially distributed transfer.
There are no coordinates for these fictional deep units. Their map remains a
neutral Rosales ancestor outline; no fabricated pins or polygons are added.

Argentina and Buenos Aires are overview views, never single allocation pools.
Without a selected unit the editor remains context-only. The separate immutable
`assets/scenario-contexts.json` contains 80 complete fictional samples: 24 national
districts × 2 illustrative years, and 8 PBA sections × 2 independent legislative
categories × 2 illustrative years. District selection supplies explicitly authored
votes, register and seats; section selection supplies votes and seats. These are
assumptions, not verified historical parameters or future convocatorias. PBA
deputies and senators remain independent categories, not a combined chamber.

The overview sums independent unit allocations, with exact per-unit and aggregate
A–D base/scenario seat counts. Only the selected unit receives a transfer; every
other unit stays at its baseline. Missing/blocked units remain visible with reasons
and dashes. An incomplete set has no complete aggregate total. Country/province
aggregate vote pools and partido subdivisions are never substituted for allocation
districts. Changing unit, year, category or scope resets the volatile transfer and
samples; category/year changes preserve the selected unit.

Read-only CNE/IGN geographic references are display references, **not an official
electoral crosswalk**. The national reference is a continental frame, not proof of
full territorial coverage. Approved source geometry/diagnostics are not repaired,
dropped or transformed by this artifact. Rosales and a selected national district
can receive a winner fill only with valid reference geometry. Observed national
references remain neutral, even when their textual fictional result is valid.
There is no validated section polygon binding: PBA retains a neutral Buenos Aires
ancestor outline plus textual selection. The archived membership reference records
135 partidos in 8 sections (counts 24/15/19/19/27/22/8/1); those counts do not prove
ingested electoral-result coverage. No child inherits a hypothetical transfer.

## Actual capabilities versus demonstration assumptions

`assets/capability-policy.json` is a dated, read-only code/local-archive observation,
not a live coverage probe. All facts are visible in the capability panel; dated
source locators and scope are available in its progressive details. Production
already has reachable manual national and PBA scenario forms. This extension does
not claim those runtimes or national/provincial data are absent.

The trusted historical Simulation loader remains unconnected. National archives
contain register and provincial-section fields, but the inspected normalized
result models do not transport them into historical Simulation inputs: source
presence and integration readiness are different claims. The **PBA 2025 HTML
parser/registry** allows only Rosales and Tigre; this is not a limitation on every
provincial category in national CSV sources. Four Rosales PDFs are archive-only
references, not parsed results. The snapshot observed four national ZIPs and
Rosales references locally, with Tigre HTML missing at its registered path despite
an ok manifest. No hosted database/API was queried; live coverage remains unknown.
Fictional votes/register/seats do not verify a 2027 election or chamber composition.

## Mathematics and failure boundaries

`simulation-model.js` imports `allocateSeats` from the root-owned `kernel.js`, an
external bundle of the existing production pure allocator. Hare and D'Hondt rules
are not reimplemented here. The strict allocator input contains projection fields
only; category/unit/source/prototype metadata stays outside that boundary. PBA
receives valid-vote evidence (plus council total only for Rosales). National input
receives `totalVotes`, `padron`, and `threshold: {value: 3, basis: 'padron'}`. National
results use `seats`; PBA results use `totalSeats`. The evidence panel distinguishes
the padrón threshold from positive-vote shares and exposes D'Hondt quotient values.

Allocation is withheld on kernel exceptions, unsupported majority branches,
incomplete coverage/awards, or any decisive `simulation_convention` tie trace. A
lower list identifier is not presented as an authoritative resolution of equal
votes and residues. Invalid inputs clear scenario figures, trace, seat strip and
winner fill. Exact baseline figures may remain only under their explicit base label.
Loading and source failures do not retain a previous calculation.

Transfer amounts are nonempty, safe, nonnegative integers between zero and the
donor's available votes. Origin and target must be distinct existing lists. Only
those two vote counts change, by the same count; total stays fixed. Zero/reset
reproduce the exact baseline. Changing any transfer draft clears the applied
scenario and sensitivity; changing unit, category, base or scope resets to zero.

Sensitivity uses deterministic samples with zero and maximum included exactly
once, including a shorter final interval when needed. Bounds are checked **before**
enumeration: at most 21 samples and `samples × seats × lists <= 600`. With 9 seats
and 4 lists the Rosales effective bound is 16 samples; the bound changes with the
selected unit's assumed seats. This is a conservative, unmeasured
prototype limit, not a universal performance guarantee. Blocked samples remain
visible with their reasons; no sample is silently dropped. No probability,
continuous crossing threshold, causal flow or extrapolated forecast is inferred.

Seat drawing is separately bounded to 60 seats and 600 positions (seats × lists).
Exceeding a drawing bound leaves the exact valid allocation and numeric summary
intact, with a visible drawing limitation; it does not relabel allocation as invalid.

## Interaction and verification

Native select/input/forms/details/dialogs, visible focus, skip link and dialog
Escape/focus restoration support keyboard access. Tables scroll in their own
regions at narrow widths; the viewport must not overflow at 320/390 px. All runtime
requests are local read-only assets. Reduced-motion styling suppresses effects.

Root owns `serve.mjs`, `build.mjs`, `kernel.js`, both immutable extension fixtures,
`verify.mjs`, `verify-scales.mjs`, the task document and
all verification reports/captures. Strict TDD applies: root observed a genuine
real-entry 404 before UI implementation. Implementation completion is not itself
proof that later rendered, accessibility, mobile or independent checks passed;
use root's observed reports in `checks/` for their actual status. This is not a
native review receipt or human approval of the design. Extension RED was separately
observed at the existing HTTP 200 entry before the Unit of allocation control
existed. Retained and new rendered checks must pass after the extension; old evidence
alone does not verify these new contexts. All asset loads are required: failed or
malformed extension assets expose unavailable state, without an implicit fallback
to the older screen or retained results.

## Primary statutory references

- [Ley 5109, arts. 109–110](https://normas.gba.gob.ar/documentos/VGW7pIWV.html): PBA
  electoral allocation rules and municipal application.
- [Código Electoral Nacional, arts. 158–163](https://www.argentina.gob.ar/normativa/nacional/ley-19945-19442/actualizacion):
  national deputy election and allocation within electoral districts.

These references describe legal rules, not the authority of fictional inputs or
the completeness of any unmodeled future convocatoria.
