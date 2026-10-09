# CNE Rosales source archive

## Status and scope

Seven original files were incorporated into the immutable **local** archive on
2026-10-09: 225,879,680 bytes in total. This unit archives evidence only; it does
not import votes, update coordinates, register sources, or change the application.

`archive-manifest.json` contains the seven content-addressed records. Their
`archive_only` and `ingestion_eligible` fields document intent, not an implemented
runtime guard. None of these IDs was added to `etl/sources.yaml`. Existing records,
canonical geography references, and all 17 previous fetch events remain unchanged.
No HTTP fetch event was invented for a verified local copy.

## Originals and provenance

| Archive ID | Original | Bytes | Acquisition |
| --- | --- | ---: | --- |
| `national/cne-pba-2025-results` | Buenos Aires 2025 TXT | 217,607,097 | Public Drive link supplied in institutional correspondence |
| `geography/cne-rosales-2025-attachments` | Outer ZIP | 24,917 | User-provided container, not itself a verified email attachment |
| `geography/cne-rosales-2025-locales` | Original XLSX | 12,463 | Institutional attachment extracted from the container |
| `geography/cne-rosales-2025-supplied-geojson` | Original Rosales GeoJSON | 26,110 | Institutional attachment extracted from the container |
| `geography/cne-rosales-2025-supplied-shp` | Original Rosales Shapefile ZIP | 6,953 | Institutional attachment extracted from the container |
| `geography/cne-pba-circuits-observation-20261009-geojson` | Public PBA circuit GeoJSON | 5,892,089 | Public cartography download |
| `geography/cne-pba-circuits-observation-20261009-shp` | Public PBA circuit Shapefile ZIP | 2,310,051 | Public cartography download |

[provenance.json](provenance.json) records exact hashes, relative archive paths,
issuer attribution, stable source/download URLs, observed HTTP metadata, source
retrieval UTC, and local-copy UTC. Attachments have null public URLs. The TXT final
URL is explicitly sanitized, not represented as the literal observed redirect.
All three institutional attachments match container member bytes.

The correspondence date is **2026-10-09**. It is not a publication date: publication
dates are unknown/null. Private correspondence and its identifying headers were
not archived. Official original attachment bytes are unchanged; institutional
labels and addresses are not transcribed into these documents.

### Three links observed during source verification

| Link | HTTP status | Role |
| --- | ---: | --- |
| [CNE cartography](https://mapa2.electoral.gov.ar/descargas/) | 200 | Download portal |
| [Public electoral register query](https://www.padron.gov.ar/publica/) | 200 | Individual statistical query, not an archived bulk dataset |
| [CNE-supplied public Drive file](https://drive.google.com/file/d/1a-juY4ljtTcUoBYf5lKrN6bpwlIfDXK3/view?usp=drive_link) | 200 | Landing page for the results TXT |

These are prior retrieval observations, not live availability guarantees. Page
bytes are not included in this seven-original package; their observed hashes and
retrieval times are retained in provenance. The public register was not scraped.

## Compact reconciliation evidence

[comparison-summary.json](comparison-summary.json) retains the verified comparison:
153 regular national 2025 mesas, 31 local-code mappings, and 28 coordinate pairs.
Coordinates are evidence only, not an applied enrichment. The current PBA geometry
has 1,146 matching administrative keys and unchanged properties/geometries versus
the older archived observation, with serialization feature IDs changed. The ten
Rosales supplied geometries match after rounding to eight decimals. This does not
establish election-effective historical geometry.

The DINE provisional total is **34,643**; the CNE definitive-context total is
**34,597**, a **−46** difference. There are 24 regular mesas with changed mapped
counts and 42 changed mesa-by-grouping/vote-type cells; 15 mesa totals changed.
[result-aggregate-deltas.csv](result-aggregate-deltas.csv) preserves the full mapped
aggregate table, separating regular counts from signed identifier-0 adjustments.
Identifier 0 has 20 rows and net adjustment zero. Identifier 0 is not counted as
an additional physical mesa; its underlying meaning remains unconfirmed. The
signed adjustment pattern is observed, not an authenticated legal classification.
All original signed values remain in the TXT.

The definitive-context attribution comes from institutional correspondence, not
an explicit raw date/stage field. Positional elector/voter semantics remain
inferred. Neither legal finality, portal/Drive equivalence, nor longitudinal voter
or mesa continuity is established. Fiscalizacion data is excluded entirely.

## Local availability and restoration

All seven raw originals are gitignored and local-only. A clone of this commit will
contain the manifest and these documents, **not** the original bytes. The 217 MB
TXT must not be force-added to Git. Keep a separate authorized backup of the raw
package when transferring or retiring this worktree.

Restore public originals from the stable provenance URLs only if the resulting
bytes match the recorded SHA256 and size; a current response can differ. Restore
non-public attachments and their user-provided container from an authorized local
copy, not a fabricated public URL. Use the manifest's exact relative paths. The
existing fetch CLI does not treat these HTTP sources as local-file imports; this
unit used existing storage/manifest helpers without changing source contracts.

Before consuming a restored artifact, call `etl.archive.read_verified_archive`
with `LocalArchiveStore(Path("archive"))`, its capability, filename, and recorded
hash. This verifies integrity, not legal authenticity. The read-only CLI
`PYTHONPATH=etl python -m etl archive-history --source national/cne-pba-2025-results`
returns no events because no network fetch was performed by this archival unit.
