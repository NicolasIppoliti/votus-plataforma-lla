# Product

<!-- impeccable:product-schema 1 -->

## Product Purpose

Votus is an internal **territorial electoral intelligence platform**. The primary
outcome is to understand where electoral support dominates, how it changes between
elections, and which conclusions the evidence can support. The map is the target
analytical workspace, not a decorative hero; exact tables and provenance remain
canonical verification and accessible alternatives.

## Delivery state and capability hierarchy

**Current:** selector/chart/table-first analysis of public official 2023/2025 results.
Slice 1 has one checksum-backed ARBA Coronel Rosales partido reference and a standalone non-production evaluator, not a delivered map. Child-unit geometry, terrain and historical boundary applicability remain unsupported or unverified.
**Target:** map-first territorial dominance and election comparison using deck.gl +
MapLibre, delivered through the [merge-gated slice plan](docs/plans/territorial-intelligence-slices.md).
This direction does not claim a delivered map or authorize implementation.

| Priority | Capability and boundary |
| --- | --- |
| Core | Territorial dominance and election comparison: Argentina → Buenos Aires Province → Coronel Rosales, then circuits, establishments and mesas only where source-backed. |
| Separate module | Fiscalización: operational coverage/heat, with its denominator and non-random sample; never an official-results aggregate. |
| Separate module | Simulación: hypothetical 3D council/seat scenarios with statutory allocation and conditional vote ranges, not false exact thresholds. |
| Future module | Análisis/Prospectiva: probabilistic, evidence-bound analysis with explicit assumptions, confidence and limitations; municipal/intra-municipal recommendations, not deterministic prediction. |

Modules share geographic and evidence foundations, not blended numerical outputs.
Physical terrain and electoral extrusion are independent layers. Height expresses a
declared electoral metric, not physical elevation. Canonical winning party/alliance
colors encode factual identity while election-specific ballot labels stay visible.
Tie, unmapped, missing, unavailable and incomplete states are explicit and never
color-only. Electoral detail may exceed geographic detail: establishment-anchored,
labelled non-geographic mesa layouts are permitted, never invented boundaries.

## Platform

web

## Users

The primary user is an internal electoral analyst/operator who repeatedly inspects official results, fiscalización coverage, cross-election comparisons, municipal detail, review queues, and hypothetical scenarios. Leadership is a secondary audience that consumes summarized findings rather than governing the operator workflow.

## Positioning

Votus combines an immutable, checksum-verified official-results archive with an authenticated analytical projection, explicit official/fiscalización separation, statutory seat allocation, and scenario comparison. It is not a public election-results portal or a generic dashboard.

## Operating Context

Analysts work inside an authenticated workspace, moving among operational briefing, official exploration, comparison, municipal analysis, fiscalización, review, and simulation. They use dense tables, filters, deep links, administrative codes, source metadata, coverage qualifiers, and reproducible scenario inputs. The product must support repeated keyboard and desktop use while retaining full mobile capability.

## Capabilities and Constraints

- Official data is the default source. Fiscalización data is request-opt-in and never combines with official figures in one number.
- Fiscalización coverage is non-random and always retains its denominator and literal `isRandomSample: false` meaning.
- Review is currently read-only; resolution is a separate future workflow.
- PBA seat allocation uses Hare quota with largest remainder; national allocation uses D'Hondt, according to the applicable statutes.
- Administrative-code normalization has one boundary and preserves national/PBA scheme distinctions.
- Archive entries are immutable and checksum-verified. Ingestion is transactional, idempotent by archive entry, election, and natural key, and reports exclusions by category and reason.
- Conflicting, unmappable, truncated, denied, unavailable, and empty data remain distinct states; values are never silently dropped or selected.
- Personal fiscal names never enter the database, fixtures, logs, or documentation.
- Existing authentication, authorization, URL, query, deep-link, source, calculation, and persistence contracts survive UI component migration unchanged unless a later work unit explicitly changes one.

## Brand Commitments

The product name is Votus. Product language is direct, neutral, operational Spanish. Canonical party/alliance color may encode factual electoral identity, never UI actions, source kinds or status semantics; labels and non-color cues are mandatory.

## Evidence on Hand

- Immutable official archive and `archive-manifest.json` checksums.
- Curated party, crosswalk, election, and jurisdiction mappings.
- Exact result tables, provenance, coverage, granularity, exclusion, and source metadata.
- Real route-level unit, SQL, and browser release gates.
- Slice 1 candidate: 69,544-byte ARBA WFS partido MultiPolygon (SHA-256 `b502009185a5d6b1666312d2d91aa9b79053b2ee8a06f0aa683029b925c3ed13`), PBA `027` → national `(02,027)`; standalone renderer lab budgets pass, pending final whole-candidate verification and merge.
- Historical CI/CD research and operational-verification documentation.

Evidence is trusted by the internal users and should not dominate every primary view. It must remain available through a clear dedicated detail surface and stay attached to degraded or disputed results where omission would change interpretation.

## Product Principles

1. Optimize for the analyst/operator's repeated task, not a public-facing presentation.
2. Preserve exact electoral meaning and source boundaries before visual consistency.
3. Keep primary views fast and legible; move trusted supporting evidence into an obvious detail layer rather than deleting it.
4. Deliver reachable territorial workflows progressively, preserving existing evidence and access contracts.
5. Surface degraded, denied, conflicting, truncated, or unmapped states truthfully and actionably.

## Accessibility & Inclusion

WCAG 2.2 AA is a release requirement. Primary workflows must remain keyboard-operable, retain visible focus, support 320px layouts and 200% browser zoom, expose semantic tables and labelled scroll regions, avoid color-only meaning, and provide at least 44×44px touch targets where controls are used on mobile.
