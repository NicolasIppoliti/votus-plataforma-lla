# SPIKE 005 — curated-table loaders (Phase 15, tasks 15.1-15.14)

> Before this phase, `curated/party_map.yaml` and `curated/crosswalk.yaml` were
> validated and parsed by `etl.party_map`/`etl.crosswalk`, but nothing loaded
> them into Postgres. Verified live at the start of this phase: `party_mapping`,
> `party_canonical`, `list_identity`, `jurisdiction_crosswalk` and
> `mesa_crosswalk` all held **0 rows**. Consequence: the fiscalización page
> rendered `list 110: 161 votes` instead of a party name, and LLA carried three
> different `agrupacion_id`s across the archived corpus with no reconciliation
> — `135` in the 2023 PASO, `20135` in the 2023 generales (a 5-digit id space),
> and `110` in 2025.

## 15a/15b — `load_party_map_rows` / `load_crosswalk_rows` (`etl/etl/db.py`)

Both are plain `ON CONFLICT` upserts, idempotent by natural key (unlike
`upsert_jurisdiction`, none of `party_canonical`/`list_identity`/
`party_mapping`/`jurisdiction_crosswalk`/`mesa_crosswalk`'s unique keys
contain a nullable column, so the `IS NOT DISTINCT FROM` workaround that table
needs does not apply here). RED/GREEN evidence: `etl/tests/test_load_curated.py`
(6 tests, run against a real ephemeral Postgres).

**Reconciliation (task 15.3)**: `curated/party_map.yaml`'s national 2025 entry
for `agrupacion_id` 110 was changed from canonical party `LLA_PRO_ALLIANCE` to
`LLA`, and a new entry for the 2023 generales 5-digit id `20135` was added
(measured live against `archive/national/2023-generales.zip ->
2023_Generales/ResultadoElectorales_2023_Generales.csv`, distrito 2: list
20135 carried 2,327,998 votes). `135`, `20135` and `110` (all national,
category `DIPUTADO NACIONAL`) now resolve to the same canonical party `LLA`.
The `coronel_rosales_municipal` 2025 entry (list `2206`) is UNCHANGED and
stays a distinct canonical party `LLA_PRO_ALLIANCE` — that is a different
`(jurisdiction, category)` key, matching the `party-identity-mapping` spec's
"LLA+PRO alliance mapped separately for 2025" scenario, which this
reconciliation does not touch.

## 15c — `load-curated` CLI subcommand (`etl/etl/__main__.py`)

Wired into `build_parser` alongside `fetch`, `ingest`, `validate-crosswalk`
and `validate-curated`. RED evidence drives it through `main()` (the real
argv-parsing entrypoint), never by importing the loader functions directly —
`etl/tests/test_cli.py::test_load_curated_populates_every_curated_table`.

**Discovery during the real run**: the first real run against
`curated/crosswalk.yaml` loaded `jurisdiction_crosswalk` correctly but
`mesa_crosswalk` came back with **0 rows**. Root cause: `curated/crosswalk.yaml`
uses zero-padded DINE-convention codes (`"02"`, `"027"`), but the raw national
CSVs' `distrito_id`/`seccion_id` columns are UNPADDED (`"2"`, `"27"`) —
measured directly against `archive/national/2023-generales.zip` and
`archive/national/2025-legislativas.zip`. `collect_national_mesa_codes`'s
naive string comparison silently matched nothing. Fixed with
`_normalize_administrative_code` (zero-padding-independent, same pattern as
`ingest.national._normalize_mesa_id`) applied to both sides of the
comparison. The CLI reachability test was strengthened to use different
padding on each side of the fixture (curated `"090"`/`"001"` vs raw CSV
`"90"`/`"1"`) specifically to catch a regression of this bug, rather than a
fixture that coincidentally matches on both sides.

## 15.11 — real run against the real curated files

```
ETL_DATABASE_URL=postgresql://etl_writer:etl_writer_local_dev_only@127.0.0.1:54322/postgres \
  uv run python -m etl load-curated
```

```
quarantined 51409 rows across 5051 ambiguous natural keys (CONCEJAL 2672, INTENDENTE 2379) -- indistinguishable in the source except by vote count, so no row was loaded for them
quarantined 6462906 rows across 2666412 ambiguous natural keys (PRESIDENTE/A 679644, PARLAMENTO MERCOSUR NACIONAL 573696, PARLAMENTO MERCOSUR REGIONAL 444547, DIPUTADOS/AS NACIONALES 410331, SENADORES/AS NACIONALES 289095, INTENDENTE/A 97930, GOBERNADOR/A 84193, DIPUTADOS/AS PROVINCIALES 44689, SENADORES/AS PROVINCIALES 40380, CONCEJAL 1907) -- indistinguishable in the source except by vote count, so no row was loaded for them
loaded 20 row(s) into party_canonical
loaded 28 row(s) into list_identity
loaded 28 row(s) into party_mapping
loaded 1 row(s) into jurisdiction_crosswalk
loaded 155 row(s) into mesa_crosswalk
```

(The two "quarantined" lines are `ingest_national`'s existing, unrelated
ambiguous-natural-key warning — `collect_national_mesa_codes` parses the
already-archived 2023 generales and 2023 balotaje files to build
`mesa_crosswalk`'s per-year presence, and both files carry this pre-existing,
already-documented ambiguity for `CONCEJAL`/`INTENDENTE`-family categories,
Phase 3. It does not affect `DIPUTADO NACIONAL`, the only category any
curated party mapping resolves against.)

**Row counts, verified directly against Postgres after the run**:

| Table | Rows |
|---|---|
| `party_canonical` | 20 |
| `list_identity` | 28 |
| `party_mapping` | 28 |
| `jurisdiction_crosswalk` | 1 |
| `mesa_crosswalk` | 155 (151 stable across 2023/2025, 4 discontinuous) |

**Idempotency**: ran a second time immediately after — same 5 counts, byte-
identical `mesa_crosswalk` stability flags (verified via `ON CONFLICT ...
DO UPDATE`, no duplicate rows).

## 15d — party names in the read path

`ResultsRepository` gained an optional `PartyNameSource` seam
(`SupabasePartyNameSource` in production, a fake in
`repository.test.ts`) that joins `party_mapping` -> `party_canonical` for
a caller-supplied `PartyMappingContext` (`year`/`jurisdiction`/`category` —
the curated free-text key, a different namespace from `BaseQuery`'s opaque
UUID foreign keys, so the caller supplies it explicitly rather than the
repository inferring it). `ResultRow.partyName` is `null` for an unmapped
`listId` — never left for the page to render the bare id — and the
`/fiscalizacion` page's list rendering now shows `{partyName ?? "unmapped
(list {listId})"}` instead of always `list {listId}`.

RED/GREEN: `apps/web/src/lib/fiscalizacion/repository.test.ts`
(`test_rows_carry_a_resolved_party_name_when_a_mapping_exists`,
`test_unmapped_list_id_renders_as_unmapped_not_as_a_bare_number`).

## Forward gaps (not this phase's scope)

- `find_unmapped_jurisdictions`/`validate-crosswalk` (Phase 12, pre-existing)
  compares raw archived-file distrito/seccion codes against curated
  `crosswalk.yaml` codes the same un-normalized way `collect_national_mesa_codes`
  did before this phase's fix — not re-verified against the real corpus in this
  session; worth checking whether it silently reports 0 unmapped jurisdictions
  for the wrong reason (never actually matching anything) rather than genuinely
  resolving every code.
- `party_mapping`/`list_identity`/`jurisdiction_crosswalk`/`mesa_crosswalk` are
  loaded but still have no reachable operator-facing read path other than the
  `/fiscalizacion` page's `DIPUTADO NACIONAL`/national-jurisdiction lookup —
  the PBA-municipal `coronel_rosales_municipal` party mappings (Concejales)
  are curated and loaded but nothing queries them yet.
