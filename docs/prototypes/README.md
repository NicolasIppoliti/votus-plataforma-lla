# Votus UI page prototypes

Five isolated, map-first page prototypes designed between 2026-09-30 and 2026-10-01.
They are design references for the prototype integration program
(`odd/tasks/prototype-integration.md`), **not production routes**: none is wired into `apps/web`, and every number, coverage relation and deep unit in
them is fictional demo data, never product evidence.

Shared approved style: one 218px navy sidebar, cyan focus/selection, IBM Plex Sans and
Mono, readable opaque surfaces, the map at the centre and a right detail panel with a
visible next-level navigator.

| Prototype | Target page | Status | Open with |
| --- | --- | --- | --- |
| [`territorial-exploration/`](territorial-exploration/) | Explore (`/drilldown`) | Visual design approved 2026-09-30; reference in [`APPROVED-DESIGN.md`](territorial-exploration/APPROVED-DESIGN.md) | `node serve.mjs` after regenerating its map assets (below) |
| [`temporal-comparison/`](temporal-comparison/) | Compare (`/compare`) | Approved, with accepted enhancements (child coverage, selected-group pp) | `node serve.mjs` (serves Exploration's assets read-only) |
| [`seat-simulation/`](seat-simulation/) | Simulation (`/simulate`) | Accepted, including a verified keyboard repair | `node serve.mjs` after rebuilding `kernel.js` (below) |
| [`evidence-quality/`](evidence-quality/) | Evidence and data quality (new) | Accepted ("está bien"); not a data or WCAG certification | `node serve.mjs` |
| [`panorama/`](panorama/) | Overview / landing (`/`) | Accepted 2026-10-01 ("todo ok", recorded in `odd/tasks/panorama-prototype.md`) | `node serve.mjs` |

Each folder keeps its own `README.md` with the exact scope and limits recorded when it
was built. Exploration's README notes that geographic reuse permissions are unverified.

## What was left out, and how to regenerate it

Only design sources are versioned here: Markdown, HTML, CSS, JavaScript and small assets
(58 files, 1,096,762 bytes). Excluded:

| Excluded | Size | Why | Regenerate |
| --- | ---: | --- | --- |
| `*/checks/` | ~31 MB | Process evidence: screenshots, browser reports, logs | Not needed to open a prototype |
| `territorial-exploration/assets/winner-reference-paths.json` | 6,267,496 B | Generated from the versioned CNE PBA sections GeoJSON | `node generate-winner-reference-assets.mjs` |
| `territorial-exploration/assets/reference-paths.json` | 581,707 B | Generated from versioned geography archives | `node generate-reference-assets.mjs` |
| `seat-simulation/kernel.js` | 787,202 B | esbuild bundle of `apps/web/src/domain/seat-allocation/allocate.ts` | `node build.mjs` |
| `design-refinement-checks/` | ~100 MB | Cross-prototype screenshots and review reports | Not needed to open a prototype |

The generators and `verify*.mjs` scripts still contain the absolute checkout paths they
were written with (`/Users/.../votus-plataforma-lla`); adjust them before running
elsewhere. They read the repository's archived geography and `apps/web` sources;
they write only inside their own prototype folder.

## Full backup

The complete original set (480 files, 141 MB, including every excluded file) lives
outside Git at `~/dev/votus-backups/ui-prototypes-20260930/`, copied from the Codex
clean-install backup of 2026-10-07. Integrity: SHA-256 of the sorted list of per-file
SHA-256 sums is `37905b44c7632a62ecc9ef2456969d021ee8af8d2e03bb20181eecc4461f6fb0`.
