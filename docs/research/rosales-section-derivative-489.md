# Verified Rosales section derivative (#489)

Municipal, supported comparison scenes, and drilldown section geometry now read a
9,602-byte content-addressed derivative, not the complete CNE sections archive.
The derivative contains the original accepted feature without coordinate changes.
Missing, corrupt, or structurally invalid artifacts withhold geometry; exact
results remain readable in server-rendered municipal HTML without JavaScript.

## Reproduce offline

From `apps/web`, with the immutable original available under the source root:

```sh
node scripts/generate-rosales-section.ts --source-root /path/to/source-checkout --output-dir data/geography
```

The generator reads only the source manifest and pinned original. It checks a
unique manifest record, path, source identity, MIME, status, retrieval date,
30,269,143-byte size and SHA-256 before parsing. It requires the pinned CRS and
exactly one accepted feature: provincia Buenos Aires, departamen
Cnel. de Marina L.Rosales, cabecera Punta Alta, gid 30556. It validates closed
MultiPolygon rings with finite, bounded coordinate pairs. It neither repairs nor
simplifies; all original feature properties, polygons, rings and coordinates are
serialized in original order. Replay verifies existing content instead of
replacing it. No remote requests or archive writes occur.

| Pin | Value |
| --- | --- |
| Original SHA-256 | `964af68999504c107c71eaccd8470055f990071eccba09f227e81b6dc31df673` |
| Derivative SHA-256 | `d21df6a0ca949d64fbe4a4aa83c6d88695333be06d38321de00c1241bfd7a351` |
| Retrieval date (not electoral validity) | `2026-09-24T03:29:24Z` |
| Artifact | `apps/web/data/geography/cne-rosales-section.d21df6a0ca949d64fbe4a4aa83c6d88695333be06d38321de00c1241bfd7a351.json` |

The artifact records attribution, source pins and identity, retrieval date,
reference-only status, unverified historical applicability, and selection-only
transformation. Its own hash is pinned in the filename and production loader
rather than recursively embedded in its hashed bytes. Existing scenes continue
to display the original source hash/date and applicability caveats. Attribution
does not claim the circuit resource's CC BY 4.0 license was separately verified
for the sections layer.

## Verification and measurement

The loader test and real municipal-page test failed before implementation: the
old loader read two files, and the page never read a section derivative. The CLI
replay test also failed before the generator existed. Tests now exercise actual
CLI replay, complete feature equality against the original, manifest/source
refusal, derivative-only loader I/O, corrupt/invalid derivative refusal, tracing,
and real-page exact-results fallback. Replay/measurement tests require the
unversioned original; they skip when absent. Set `VOTUS_SECTION_SOURCE_ROOT` to
choose its checkout explicitly; otherwise they try the current checkout and the
local sibling main checkout.

Reproduce the bounded measurement from `apps/web`:

```sh
pnpm exec vitest run src/lib/workspace/municipal-section-measurement.test.ts --silent=false --reporter=verbose
```

Observed Node **24.21.0**, five alternating sequential old/new invocations in one
Vitest process. The baseline reproduces the previous manifest/read/hash/parse/
selection/ring-validation algorithm, with assertions. The new side invokes the
real production loader. Every returned geometry is compared for equality.
Filesystem cache is uncontrolled; no forced GC or per-request RSS estimate is
used. Gzip uses Node's default `gzipSync`; compression is outside invocation
timings. This is not a Next request, hosted benchmark, browser-transfer estimate,
or production latency guarantee.

| Metric | Old | New |
| --- | ---: | ---: |
| Invocation ms, samples | 264.300, 224.954, 216.703, 222.840, 248.828 | 6.851, 1.145, 0.724, 0.676, 4.308 |
| Median invocation ms | 224.954 | 1.145 |
| Artifact raw bytes | 30,269,143 | 9,602 |
| Artifact gzip bytes | 9,294,839 | 3,681 |

Raw/gzip figures compare the original archive with the derivative, not total
HTTP response sizes. The old invocation additionally reads the manifest. The
initial measurement run exceeded Vitest's default five-second test timeout under
load; the bounded measurement test now allows 30 seconds and its rerun passed.

Deployment tracing explicitly includes the derivative for municipal, compare and
drilldown. Municipal/drilldown retain their independent circuit/location artifact;
the province geography API retains its unrelated IGN archive and manifest.
No renderer, election applicability, vote assignment or e2e behavior changed.
