# seat-simulation

Real seat-allocation simulation for Coronel Rosales concejales and PBA provincial
legislators, modelling the PBA municipal council rule of an 18-seat Concejo Deliberante
renewing 9 seats per election, for 2027 what-if scenario analysis. Per the resolved product
questions, this is a genuine allocation simulation, not merely a vote-trend comparison.

**Method is set by statute and is NOT uniform across levels.** Coronel Rosales concejales
and PBA provincial legislators use the Hare quota with largest remainder (Ley 5109, Arts.
109–110). National diputados (if ever simulated) use D'Hondt (Ley 19.945, Art. 161).

## ADDED Requirements

### Requirement: Allocation method is selected by level, not configuration
The system MUST select the allocation algorithm from the level being simulated (PBA
municipal concejales, PBA provincial legislators, or national diputados) and MUST NOT
expose the algorithm choice as an operator preference or a global toggle. A run targeting
a PBA level MUST NOT be able to apply the national D'Hondt method, and a run targeting the
national level MUST NOT be able to apply the Hare quota method.

#### Scenario: PBA level always resolves to Hare quota
- **GIVEN** a simulation run targeting Coronel Rosales concejales or PBA provincial
  legislators
- **WHEN** the run executes
- **THEN** the system MUST apply the Hare quota with largest-remainder method
- **AND** MUST NOT accept an operator-supplied override selecting D'Hondt for that run

#### Scenario: National level always resolves to D'Hondt
- **GIVEN** a simulation run targeting national diputados
- **WHEN** the run executes
- **THEN** the system MUST apply the D'Hondt method
- **AND** MUST NOT accept an operator-supplied override selecting Hare quota for that run

### Requirement: Hare quota (cuociente electoral) computation for PBA levels
For Coronel Rosales concejales and PBA provincial legislators, the system MUST compute the
`cuociente electoral` per Ley 5109 Art. 109(a) as valid votes divided by the number of
seats to fill for that election, where valid votes EXCLUDES blank and annulled votes (Art.
109 final paragraph). The system MUST NOT use the total vote count (including blank and
annulled) as the denominator.

#### Scenario: Cuociente denominator excludes blank and annulled votes
- **GIVEN** a category with a total vote count, a blank-vote count, and an annulled-vote
  count
- **WHEN** the system computes the cuociente electoral
- **THEN** the system MUST subtract blank and annulled votes from the total before dividing
  by the number of seats to fill
- **AND** MUST record the valid-vote denominator used, separately from the total vote count

### Requirement: Hare quota seat allocation by list
The system MUST allocate each list's initial seats per Ley 5109 Art. 109(b): a list's votes
divided by the cuociente electoral (integer part) is its seat count. A list whose votes do
not reach the cuociente MUST receive zero seats from this step.

#### Scenario: List below the cuociente gets no representation
- **GIVEN** a list whose vote total is below the computed cuociente electoral
- **WHEN** the Hare allocation step runs
- **THEN** the system MUST assign that list zero seats
- **AND** MUST exclude that list from the largest-remainder step because Ley 5109 Art.
  109(b) states that lists below the cuociente receive no representation

### Requirement: Largest-remainder top-up for PBA levels
The system MUST allocate any seats remaining after the initial cuociente division among
lists that reached the cuociente, per Ley 5109 Art. 109(c): one additional seat to each
eligible list in descending order of remainder (votes minus seats-already-awarded times
cuociente) until all seats are assigned. Where two eligible lists have an equal remainder,
the system MUST award the seat to the list with the higher raw vote total — this is a
statutory rule (Art. 109(c)), not a simulation convention, and MUST NOT be labelled as one
in output or documentation.

#### Scenario: Remaining seats go to the largest eligible remainders
- **GIVEN** seats remain unallocated after the initial cuociente division across eligible lists
- **WHEN** the largest-remainder step runs
- **THEN** the system MUST award one additional seat per eligible list in descending
  remainder order until no seats remain
- **AND** MUST record each list's remainder value used in that ordering

#### Scenario: Equal remainders resolve deterministically by vote total, per statute
- **GIVEN** two lists have an identical remainder and only one seat remains
- **WHEN** the largest-remainder step reaches that tie
- **THEN** the system MUST award the seat to the list with the higher raw vote total per
  Art. 109(c)
- **AND** MUST record that this statutory tie rule was invoked
- **AND** MUST NOT present this rule as a discretionary simulation convention

### Requirement: Repeated 50% halving when no list reaches the cuociente
Per Ley 5109 Art. 110, if no list reaches the cuociente electoral, the system MUST recompute
using 50% of the cuociente; if still no list reaches that halved value, the system MUST
repeat the halving until at least one list qualifies and allocation completes.

#### Scenario: No list reaches the initial cuociente
- **GIVEN** every list's votes are below the computed cuociente electoral
- **WHEN** the allocation runs
- **THEN** the system MUST recompute eligibility against 50% of the cuociente electoral
- **AND** MUST repeat halving as many times as Art. 110 requires until allocation completes
- **AND** MUST record each halving iteration applied

### Requirement: Over-subscription handling per Art. 110
Per Ley 5109 Art. 110, if more lists reach the cuociente electoral than there are seats to
fill, the system MUST award the available seats to the lists with the most votes among
those that reached the cuociente.

#### Scenario: More qualifying lists than seats available
- **GIVEN** more lists reach the cuociente electoral than there are seats to allocate
- **WHEN** the allocation runs
- **THEN** the system MUST award seats to the highest-voted qualifying lists, up to the
  number of available seats
- **AND** MUST report which qualifying lists received no seat due to the seat limit

### Requirement: D'Hondt seat allocation for national diputados
For national diputados, the system MUST allocate seats using the D'Hondt method (Ley
19.945 Art. 161(a)): for a given set of `(canonical party, vote count)` pairs and a number
of seats to allocate, the system MUST compute successive quotients (votes / 1, votes / 2,
votes / 3, ...) per party and assign seats to the highest quotients across all parties
until the seat count is exhausted.

#### Scenario: D'Hondt allocation over supplied vote totals
- **GIVEN** vote totals for each canonical party competing for national diputados in a
  category
- **AND** a threshold parameter applied per the national threshold requirement below
- **WHEN** D'Hondt allocation runs for the seats to be filled
- **THEN** the system MUST produce a seat distribution based purely on D'Hondt quotients
  over the supplied vote totals
- **AND** the computation and its inputs MUST be traceable (the specific quotients used to
  award each seat)

#### Scenario: Tied D'Hondt quotient is a declared convention, not statute
- **GIVEN** two parties have an identical highest remaining D'Hondt quotient, equal total
  votes, and only one seat remains to be allocated
- **WHEN** the allocation reaches that tie
- **THEN** the system MUST apply a documented, deterministic tie-breaking rule
- **AND** MUST label that rule explicitly as a simulation convention, not a reproduction of
  the statute — Ley 19.945 Art. 161(c) resolves this case by sorteo, which the system does
  not perform
- **AND** MUST NOT allocate the seat silently or non-deterministically

### Requirement: National electoral threshold (piso) based on the padrón
For national diputados only, the system MUST apply an electoral threshold parameter per
Ley 19.945 Art. 160: a list MUST reach a minimum percentage of the padrón electoral of the
distrito (not of valid votes) to participate in D'Hondt allocation. The default threshold
value MUST be configurable per run and MUST be documented as measured against the padrón.

#### Scenario: List below the national threshold is excluded from D'Hondt
- **GIVEN** a national diputados simulation run with a threshold percentage and a padrón
  electoral figure for the distrito
- **AND** a list's votes are below that percentage of the padrón
- **WHEN** the simulation executes
- **THEN** the system MUST exclude that list from the D'Hondt quotient computation
- **AND** MUST still report the excluded list's raw vote share for transparency
- **AND** MUST report the threshold as a percentage of the padrón, not of valid votes

### Requirement: PBA levels have no percentage threshold parameter
For Coronel Rosales concejales and PBA provincial legislators, the system MUST NOT expose
or apply a percentage-based electoral threshold parameter. Ley 5109 contains no
fixed-percentage piso for these allocations; the cuociente electoral computed per Art.
109(a) is itself the qualifying bar. The system MUST NOT present a percentage threshold as
if it modelled the PBA rule.

#### Scenario: PBA simulation run rejects a percentage threshold parameter
- **GIVEN** a simulation run targeting Coronel Rosales concejales or PBA provincial
  legislators
- **WHEN** the run is configured
- **THEN** the system MUST NOT accept a percentage-threshold input for that run
- **AND** the only qualifying bar applied MUST be the derived cuociente electoral

### Requirement: Council total and seats per election are distinct quantities
The Coronel Rosales Concejo Deliberante has **18 seats in total** and renews **9 seats per
election**, every two years. These are two distinct quantities and the system MUST represent
them as two separate values; it MUST NOT derive one by assuming the other, and MUST NOT use
a single "council size" figure to mean both.

Basis: Decreto-Ley 6769/58 (Ley Orgánica de las Municipalidades) Art. 2 sets council size by
population bracket, placing a partido of 40.000–80.000 inhabitants at 18 concejales; Coronel
Rosales had 67.503 inhabitants per the INDEC definitive Censo 2022 results. Art. 3 sets
four-year terms with the council renewing by halves every two years.

The seats-per-election value is the divisor of the Hare cuociente (`valid votes ÷ seats to
fill`), so an incorrect value silently changes the cuociente and therefore which lists clear
the bar.

#### Scenario: Allocation uses seats-per-election, never the council total, as the divisor
- **GIVEN** a Coronel Rosales concejal simulation for a single election
- **WHEN** the cuociente electoral is computed
- **THEN** the divisor MUST be 9 (the seats up for renewal), NOT 18 (the council total)
- **AND** the computed cuociente MUST be traceable to that divisor

#### Scenario: Council total is rejected as a substitute for seats per election
- **GIVEN** a simulation configured with a seats-to-fill value of 18 for a single Coronel
  Rosales concejal election
- **WHEN** the simulation is validated
- **THEN** the system MUST reject the run rather than allocate 18 seats in one election

### Requirement: Council renewal by halves
The system MUST allocate only the seats up for renewal in a given simulated election, and
MUST track which seats are up for renewal rather than reallocating the full 18-seat council
every time.

#### Scenario: A half-renewal election allocates only the seats up for renewal
- **GIVEN** a simulated election in which the 9 seats up for renewal (per the half-renewal
  cycle) are contested and the other 9 are held over
- **WHEN** the simulation runs
- **THEN** the system MUST allocate only those 9 seats via the Hare quota method
- **AND** MUST report the resulting full 18-seat council composition by combining the newly
  allocated seats with the 9 seats not up for renewal that election
- **AND** MUST report the held-over seats as input distinguishable from the seats it allocated
- **AND** for a historical composition, MUST derive those seats from a trusted prior-election
  source with archived provenance
- **AND** for a hypothetical composition, MUST label caller-supplied held-over seats as
  projection input rather than prior-election evidence

### Requirement: What-if vote inputs for 2027 projection
The system MUST allow an operator to supply hypothetical vote totals or vote-share inputs
(rather than only historical archived results) as input to a seat-allocation simulation,
for 2027 scenario planning. Caller-supplied JSON MUST always be treated as projection input,
MUST declare a normalized input granularity, and MUST NOT establish historical status or
archived provenance.

#### Scenario: Operator runs a hypothetical 2027 scenario
- **GIVEN** an operator supplies hypothetical vote totals for each canonical party for a
  future Coronel Rosales concejal election
- **WHEN** the operator runs the seat simulation against those hypothetical inputs
- **THEN** the system MUST produce a Hare-quota seat allocation based on the supplied
  hypothetical votes
- **AND** MUST clearly label the result as a hypothetical projection, not an archived
  historical result
- **AND** MUST display the normalized input granularity
- **AND** MUST bind the validated scenario to a stable canonical supplied-input digest that
  is explicitly labelled as not being archive provenance

#### Scenario: Caller JSON cannot forge a historical allocation
- **GIVEN** caller-supplied simulation JSON declares `isProjection: false` or supplies archive
  identifiers, hashes, source URLs, or fetch timestamps
- **WHEN** the `/simulate` route validates the request
- **THEN** the route MUST NOT display an allocation as historical
- **AND** MUST NOT display any caller-supplied field as archived provenance
- **AND** MUST fail closed with an actionable diagnostic when trusted historical loading is
  unavailable at that route

### Requirement: Historical simulations use trusted archived vote rows
A historical simulation MUST derive vote totals and normalized granularity from trusted
archived/database source rows loaded server-side. Its displayed source references MUST
include the validated archive entry identifier, sha256 digest, original source URL, and fetch
timestamp. A route without a complete trusted historical loader MUST refuse historical mode
rather than decorate caller-supplied totals with an archive identifier.

#### Scenario: Historical mode is unavailable without a trusted loader
- **GIVEN** a simulation route accepts public query JSON but has no complete server-side
  historical loader
- **WHEN** a caller requests a historical allocation
- **THEN** the route MUST refuse the request with an actionable diagnostic
- **AND** MUST NOT render any allocation derived from the caller's vote totals

### Requirement: Full computation traceability
The system MUST make the intermediate computation of every allocation run inspectable: the
cuociente electoral (or, for national runs, each D'Hondt quotient), each list's or party's
quotient and remainder values, and which specific rule (cuociente division, largest
remainder, halving iteration, D'Hondt quotient, or tie-break) awarded each individual seat.

#### Scenario: Operator inspects how each seat was awarded
- **GIVEN** a completed allocation run at any level
- **WHEN** the operator requests the computation detail
- **THEN** the system MUST show, per seat, which rule awarded it and the numeric values
  that rule used
- **AND** MUST show the cuociente electoral (PBA levels) or the full quotient table
  (national level) used to reach that result

### Requirement: Official Coronel Rosales validation scenarios under Hare quota
The system MUST reproduce the documented Coronel Rosales concejales results for both 2023 and
2025 under the Hare quota method as regression checks. Both valid-vote denominators are
SOURCED from official Junta Electoral documents, recovered by dividing each published
`cuociente electoral` by the 9 seats allocated per election. The total-vote figure MUST NEVER
be used as the denominator; it may only be reported alongside.

#### Scenario: Known 2023 distrito 027 concejales result reproduces 3/3/3/0
- **GIVEN** the officially published `COCIENTE CONCEJALES` of 3.928,777777 for 2023
- **AND** 9 concejal seats allocated in that election (the council totals 18 and renews by
  halves), giving a valid-vote denominator of 3.928,777777 × 9 = **35.359**
- **AND** the vote totals UxP 12.507, JxC 10.630, LLA 10.365, Agrupación Municipal Primero
  Rosales 1.857, against 39.273 TOTAL votes cast — from which 39.273 − 35.359 = 3.914 blank
  and annulled votes were excluded per Art. 109's final paragraph
- **WHEN** Hare quota allocation is run for the 9 seats using the 35.359 denominator
- **THEN** the system MUST produce the documented outcome: UxP 3, JxC 3, LLA 3, Agrupación
  Municipal Primero Rosales 0 — summing to 9
- **AND** the derived share LLA 10.365 / 35.359 MUST equal 29,31 %, reproducing the recorded
  figure and confirming the denominator is correct

#### Scenario: Known 2025 distrito 027 concejales result reproduces the full published computation
- **GIVEN** the officially published `Cociente: 3.587,8888880` for 2025, giving a valid-vote
  denominator of 3.587,8888880 × 9 = **32.291**
- **AND** the published per-list figures: ALIANZA LA LIBERTAD AVANZA 14.550 votes,
  ALIANZA FUERZA PATRIA 7.300, ALIANZA POTENCIA 4.540
- **WHEN** Hare quota allocation with largest remainder is run for the 9 seats
- **THEN** the computed quotients MUST match the published values: 4,055310 / 2,034620 /
  1,265370 respectively
- **AND** the seat split MUST match the published breakdown by award reason, not merely the
  totals: LLA 5 seats (4 by cuociente + 1 by residuo), Fuerza Patria 2 (2 + 0), Potencia 2
  (1 + 1), summing to 9
- **AND** because the three qualifying lists total 26.390 votes, the remaining 5.901 valid
  votes belonging to sub-cuociente lists MUST receive zero representation per Art. 109(b)

#### Scenario: Total votes are never accepted as the cuociente denominator
- **GIVEN** a simulation configured with 39.273 (the 2023 total vote count) as the denominator
- **WHEN** the run is validated
- **THEN** the system MUST reject it, because Art. 109 requires blank and annulled votes to be
  excluded first
- **AND** the rejection message MUST state that a valid-vote denominator is required
