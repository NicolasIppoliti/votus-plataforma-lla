# R5 visual evidence — #499, #500, #501

## Retrieve the captures

Open the **release-gates** Actions run for the candidate commit, select the
`e2e-release` job, and download **visual-evidence-r5** from the run's Artifacts.
Retention is 14 days. The upload runs unless cancelled and fails if no files
exist. A failed run can contain partial evidence: check the job results and the
measurement files before treating the capture set as complete.

Each approved pair has `prototype-<name>-<width>.png` and
`production-<name>-<width>.png`, at 1440, 390 and 320 px (900 px viewport height):

| Pair | Approved prototype directory | Production route |
| --- | --- | --- |
| Panorama | panorama | `/` |
| Exploración | territorial-exploration | `/drilldown` |
| Comparación | temporal-comparison | `/compare` |
| Evidencia | evidence-quality | `/evidencia` |
| Simulación | seat-simulation | seeded scenario editor reached through `/scenarios` |

`/municipal` and `/fiscalizacion` have **no approved prototype**. They receive
production-only captures at 390 and 320 px. In run 38928330948 Municipal is
in official mode; Fiscalización explicitly shows non-official opt-in coverage,
with its denominator and not-random warning. Do not combine those source kinds.
All production captures
use the release gate's disposable synthetic fixture database, not live data.
Screenshots are explicitly scoped to this spec, not enabled globally.

The complete run produces 34 PNGs across 19 tests. Each test directory also
contains `visual-evidence-r5-heights.json` recording viewport and document
heights, scroll width, route and pair identity. Preserve artifact directory
structure when extracting: these JSON basenames intentionally repeat.

## Runtime prerequisites

CI installs the existing pinned Shapely version (2.1.2), generates the two
territorial reference path bundles, and bundles the unchanged seat-allocation
kernel before running the browser gate. Generators resolve the checkout relative
to their own module; Python defaults to `python3` and accepts a `PYTHON` executable
override. Preview servers resolve shared assets using current directory names.
Generated bundles and build fingerprints are runtime outputs, not source changes
to commit. Approved prototype HTML/CSS remain unchanged.

## Evidence status

Current inventory: [develop 2196d8f2](current-2196d8f2.md), from green develop
push run **38928330948** after #589/#590. All 15 same-scale pairs (1440/390/320)
and four production-only mobile images were viewed for that inventory. It records
S1/S4/S5/S6a–f/S7, owner decisions, lower-section matches/deviations and limitations.
Independent no-blocking disposition and issue closure remain pending parent review.

`findings.md` preserves the prior main `7ceb0b0` audit; `NOTES.md` preserves the
initial blocked local attempt. Neither is the current visual verdict. The manifest
locates external evidence; PNGs are not copied into the repository. No controlled
historical production-before set is newly asserted. Automated checks alone do not
establish visual parity.
