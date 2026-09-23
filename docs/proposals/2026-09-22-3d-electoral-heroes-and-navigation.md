# Territorial Electoral Workspace

**Status: Target proposed; Slice 1 feasibility is an unmerged implementation candidate.**
Product direction is approved; the partido archive/CLI and standalone evaluator are
not a production map. Final whole-candidate verification and merge remain pending.
The filename is retained for existing references; a decorative “3D hero” is superseded.

## Decision

Make the map the primary workspace for territorial dominance and election comparison.
Use **deck.gl + MapLibre**, with real geographic anchors for Argentina nationally,
Buenos Aires Province provincially and Coronel Rosales municipally. Keep exact tables
and provenance as canonical verification and fully accessible alternatives.
See [Product](../../PRODUCT.md), [Design](../../DESIGN.md) and the
[merge-gated delivery plan](../plans/territorial-intelligence-slices.md).

## Current behavior, not target capability

| Entry point | Current boundary |
| --- | --- |
| Explore `/drilldown` | Selector/chart/table-first official exploration requires an exact section for result evidence; district-only/national aggregate scenes are not current capabilities. Optional circuit/establishment/mesa filters and school evidence do not constitute a reusable child-unit spatial series. |
| Compare `/compare` | Paired aggregate evidence with shared district/section selection; no complete paired geographic child-unit contract. |
| Municipal `/municipal` | Fixed, server-validated Coronel Rosales 2025 provincial Concejales briefing at national codes `02/027`, not a generic municipal browser. |

Selector depth is not proof of available geometry, child-unit results or geographic
coverage. One checksum-backed partido reference exists in the Slice 1 candidate; complete
source-backed child geography, terrain and production scene contracts remain future work.

## Workspace and navigation

Explore owns geographic exploration, Compare owns paired-election analysis, and
Municipal retains a saved local entry. Do not create empty national/provincial routes.
Fiscalización, Simulación and future Análisis/Prospectiva remain separate modules.

| Anchor/depth | Truthful representation gate |
| --- | --- |
| Argentina | Verified national anchor and supported child jurisdictions, not a claim of complete national coverage |
| Buenos Aires Province | Verified provincial boundary and supported municipal units |
| Coronel Rosales | Verified municipal boundary and supported circuits |
| Circuit → establishment | Source-backed boundaries or coordinates, with declared precision and matching results |
| Establishment → mesa | Verified geographic evidence if available; otherwise an explicitly non-geographic mesa sublayout anchored to the establishment |

This is a geographic anchor chain, not a replacement for jurisdiction-code schemes.
Electoral granularity can exceed geographic granularity. Never invent mesa polygons
or imply that sublayout distance/area is geographic. Stop at unsupported depth and
explain what is missing; retain available authorized exact evidence.

Selecting or keyboard-focusing a unit synchronizes detail and exact results. Explicit
drilldown changes validated served scope and camera together; breadcrumbs, back and
reset-view preserve orientation. Draft/pending/stale selections never display old
figures as current. Preserve existing URLs, normalization, focus and access guards.
Camera flights are optional; reduced motion uses immediate transitions.

## Layers and factual encoding

- **Physical terrain:** sourced land elevation, with its own provenance, resolution
  and availability. It is independently enabled and never an electoral metric.
- **Electoral extrusion:** height encodes a declared electoral metric with units,
  denominator and scale visible without hover. Terrain and electoral height are
  independently explained; disable either without changing the other's meaning.
- **Party identity:** geographic units use canonical winning party/alliance color,
  paired with text/legend and election-specific ballot label. Curated identity,
  never color or a bare list ID, establishes cross-election correspondence.
- **Semantic separation:** party colors never mean official, unofficial, success,
  warning, selection or UI action. Selection uses a separate non-color cue.

| State | Required meaning and presentation |
| --- | --- |
| Tie | No unique winner; name tied identities, use a labelled neutral/patterned treatment |
| Unmapped | Identity unresolved; retain electoral label and explicit unmapped cue, never pick a party |
| Missing | Expected observation absent; no zero-fill or winner inference |
| Unavailable | Evidence or geometry cannot answer this view; explain why and offer exact evidence where valid |
| Incomplete | Coverage/omissions are bounded and disclosed by category/reason; no complete-total or definitive-winner claim |

Denied, technical error and empty remain distinct existing evidence states. Never
render unauthorized figures or let geographic context leak protected evidence.

## Core comparison

Use synchronized scenes with a common camera and comparable scales, or an explicitly
labelled delta layer. Do not obscure one election with perspective-overlaid towers.
Pair only verified comparable territories and metric bases; boundary changes require
explicit correspondence evidence or a refusal to compare. Preserve each election's
ballot labels, denominator, provenance and exclusions. Missing/left-only/right-only
units remain visible as such, not zero votes. Exact paired tables remain reachable
without using the map. Current aggregate comparison does not prove this contract.

## Specialized modules

| Module | Separate analytical contract |
| --- | --- |
| Fiscalización | Operational coverage/heat, explicit opt-in, denominator and literal `isRandomSample: false`; never numerically mixed with official results |
| Simulación | Hypothetical 3D council/seat scenarios; Hare for PBA (Ley 5109 Arts. 109–110), D'Hondt nationally (Ley 19.945 Art. 161); distinguish 18 total council seats from 9 renewed in Coronel Rosales; conditional vote ranges, not false exact thresholds |
| Future Análisis/Prospectiva | Probabilistic, evidence-bound foundations before municipal/intra-municipal recommendations; explicit assumptions, confidence and limitations, never deterministic prediction |

## Data and evidence boundaries

Geometry is reference evidence, not election results. Archive provenance, checksum,
version, license, resolution and jurisdiction correspondence must be validated before
use. Geography need not have the election's publication date, but its applicability
to that election must be proven. Do not silently join incompatible boundary versions.

Preserve existing auth/RLS, immutable archives, transactional/idempotent ingestion,
single normalization boundary, source isolation, refusal, provenance and statutory
contracts. Report every exclusion/quarantine by reason/category. Personal fiscal names
never enter archives intended for projection, databases, fixtures, logs or documents.
No client-side identity inference, source merging or duplicate allocation algorithm.

## Accessibility and performance gates

- Keyboard and screen-reader users can select scope, inspect units and reach exact
  results without WebGL, hover, dragging or camera motion. Provide a 2D/table fallback.
- Retain WCAG 2.2 AA, visible focus, non-color meaning, 320px layouts, 200% zoom and
  44×44px touch controls. Mobile retains all analytical actions.
- Lazy-load the renderer, bound visible detail and measure real desktop/mobile costs.
  Establish load, interaction, memory and bundle budgets during feasibility, before
  integration; the existing initial-JavaScript growth gate still applies.
- WebGL failure or absent terrain must not remove valid exact evidence. Any simplified
  geometry preserves unit identity and makes precision limitations explicit.

## Research gates before implementation specifications

Maintainer evidence: [Slice 1 feasibility report](../research/territorial-source-geometry-terrain-feasibility.md)
— Slice 1 feasibility evidence complete as an implementation candidate pending final
whole-candidate verification and later merge; not proof of delivered map coverage.

1. Verify authoritative boundaries, coordinates and terrain sources, licenses,
   versions, election applicability and coverage per level; no assumed complete coverage.
2. Prove joinability against canonical administrative identities and child-unit results;
   record missing, conflicting and incomplete units rather than manufacturing continuity.
3. Evaluate terrain/extrusion legibility, device performance, accessibility and graceful
   degradation with the chosen stack; do not reopen the renderer choice silently.
4. After Slice 1 merges, start only a Coronel Rosales partido-boundary municipal
   workspace using existing authorized exact results and table/text fallback. Circuit,
   establishment, mesa and terrain remain unsupported. The user explicitly absorbed
   the partido-only archive/CLI part of planned Slice 2 into Slice 1; each newly
   accepted child/terrain source still requires its own archive/validation gate.
   The standalone evaluator passes accepted lab budgets, not production SLOs or
   physical-device/native-zoom proof. Production APIs/schemas require separate scope.

Reference starting points, **not proof of coverage or a completed source audit**:
[DNE results standard](https://www.argentina.gob.ar/sites/default/files/preservacionresultadoselectorales_1.0.8.pdf),
[IGN SIG layers](https://www.ign.gob.ar/NuestrasActividades/InformacionGeoespacial/CapasSIG),
[deck.gl GeoJsonLayer](https://deck.gl/docs/api-reference/layers/geojson-layer),
[deck.gl + MapLibre](https://deck.gl/docs/developer-guide/base-maps/using-with-maplibre).

## Acceptance boundary

A delivered slice is reachable from a real route or CLI, uses only validated served
scope, exposes metric/source/granularity limitations, and preserves exact alternatives.
Strict TDD must exercise that entry point before implementation, including refusal,
stale scope and unsupported geometry. A green helper test is not reachability proof.
Each independently useful slice needs its own reviewed, merged PR before the next starts.
