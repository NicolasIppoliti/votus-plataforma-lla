# Mesa identity in the 2025 national file (#484)

**Finding:** `mesa_id` is not globally unique in the 2025 national results file. Neither is
`(distrito, mesa)`. Only the full `(distrito, seccion, circuito, establecimiento, mesa)`
lineage identifies a mesa. The earlier guidance in `AGENTS.md` said the opposite and
is corrected.

The production resolver already keys on the full lineage. This is a correction to the
documentation and the data-shape guidance. It does not report corrupted persisted data,
and it changes no identity, resolver or result.

## Evidence

| Field | Value |
| --- | --- |
| Archive | `archive/national/2025-legislativas.zip` (registered `national/2025-legislativas`) |
| SHA-256 | `5fb19bb280af8895dc0bc2ac19d79e836fb4053b713a135357743bf35371ee4b` |
| Member | `resultados2025.csv` |
| Parser revision | `2949afe` (`etl/etl/ingest/national.py`) |
| Measured | 2026-10-14 |

| Scope | Rows / identities | Distinct mesa numbers | Distinct `(distrito, mesa)` | Distinct full lineages |
| --- | ---: | ---: | ---: | ---: |
| Raw: every source row, before filtering | 108,992 identities | 9,262 | 73,264 | 108,992 (distrito/seccion/circuito/mesa) |
| Accepted: rows the production parser emits | 1,608,120 rows | 9,261 | 72,780 | 108,141 (with establecimiento) |

The counterexample has this shape: one mesa number appears in many distritos. Within a
single distrito, it repeats across different secciones. So `(distrito, mesa)` collapses
mesas that belong to different partidos. The synthetic fixture
`etl/tests/fixtures/national_2025_repeated_mesa_sample.csv` reproduces this shape, and
`test_2025_equal_mesa_numbers_in_different_lineages_stay_distinct` keeps the three
lineages apart.

Do not generalize this result to other files. Each source needs its own check.

## Reproduce

From `etl/`, with the pinned environment:

```sh
.venv/bin/python ../spikes/scripts/mesa_identity_scan.py \
  ../archive/national/2025-legislativas.zip "$(mktemp -d)"
```

The script prints the archive hash and the counts above. It prints no identifiers.
