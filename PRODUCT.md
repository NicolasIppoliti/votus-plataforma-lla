# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is an internal electoral analyst/operator who repeatedly inspects official results, fiscalización coverage, cross-election comparisons, municipal detail, review queues, and hypothetical scenarios. Leadership is a secondary audience that consumes summarized findings rather than governing the operator workflow.

## Product Purpose

Votus supports internal electoral analysis for 2023 and 2025 public official results at national, Buenos Aires provincial, and municipal levels, plus explicitly separated fiscalización evidence and hypothetical 2027 scenarios. Success means an analyst can move quickly from a question to an exact, reproducible result without losing authorization, source, jurisdiction, election, or granularity boundaries.

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

The product name is Votus. Product language is direct, neutral, operational Spanish. Party identity may appear as factual institutional context but never becomes a semantic color or interface assumption.

## Evidence on Hand

- Immutable official archive and `archive-manifest.json` checksums.
- Curated party, crosswalk, election, and jurisdiction mappings.
- Exact result tables, provenance, coverage, granularity, exclusion, and source metadata.
- Real route-level unit, SQL, and browser release gates.
- Historical CI/CD research and operational-verification documentation.

Evidence is trusted by the internal users and should not dominate every primary view. It must remain available through a clear dedicated detail surface and stay attached to degraded or disputed results where omission would change interpretation.

## Product Principles

1. Optimize for the analyst/operator's repeated task, not a public-facing presentation.
2. Preserve exact electoral meaning and source boundaries before visual consistency.
3. Keep primary views fast and legible; move trusted supporting evidence into an obvious detail layer rather than deleting it.
4. Replace interface primitives progressively, with behavioral parity before workflow redesign.
5. Surface degraded, denied, conflicting, truncated, or unmapped states truthfully and actionably.

## Accessibility & Inclusion

WCAG 2.2 AA is a release requirement. Primary workflows must remain keyboard-operable, retain visible focus, support 320px layouts and 200% browser zoom, expose semantic tables and labelled scroll regions, avoid color-only meaning, and provide at least 44×44px touch targets where controls are used on mobile.
