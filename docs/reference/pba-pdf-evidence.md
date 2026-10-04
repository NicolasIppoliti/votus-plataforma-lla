# PBA municipal PDF and HTML evidence reconciliation

This **read-only, review-required** ETL command reports locally archived public
report evidence. It does not fetch sources, open database connections, ingest rows,
write artifacts, or accept a council series. Numeric reconciliation and scientific
acceptance are separate results.

## Run

From `etl/`, after installing the locked ETL environment:

```sh
uv run --offline --frozen --no-sync python -m etl \
  --sources-path "$PWD/sources.yaml" \
  --local-root "$PWD/../archive" \
  --manifest-path "$PWD/../archive-manifest.json" \
  reconcile-pba-pdf-evidence
```

Root options must precede the subcommand. JSON goes to stdout, with sorted keys,
no run timestamp, and six sources in ascending year order: literal registered
`pba/{2015,2017,2019,2021,2023,2025}-resultados-027` identities. No source selector
or alternate URL is accepted. The catalogue 2023 identity is not a second election
alongside its previously observed equal-hash alias.

Add `--include-html` after the subcommand to verify the protected integrated HTML
and the separately registered argentinos/extranjeros HTML snapshots for 2025.
This adds `html_sources`, `reconciliation` and `suitability` to the report; the
default six-PDF interface remains unchanged. Missing components are reported as
unavailable, never inferred from the integrated total.

Add `--include-earlier` to read the pinned 2011/2013 references as well, in ascending
year order. `historical_reference_scope` records the additional years and explicitly
keeps the initial 2015–2025 extraction checkpoint.

Exit **0** means all selected artifacts were SHA-verified and their supported text layout
was extracted, **not** accepted scientifically. Exit **1** means at least one source
failed; the JSON still includes all selected identities and failure reason counts.
With `--include-html`, exit 0 additionally requires all three HTML artifacts to
verify and extract. A numeric conflict or scientific uncertainty does not become
a failed artifact read or a forecast readiness claim.
Invalid CLI arguments exit **2** through argparse. Invalid registry YAML/schema or
unreadable registry is a fatal CLI error (stderr, exit 1), without a JSON report.

## JSON contract (schema version 1)

- `read_only`, `review_required`: always true.
- `sources`: each source's ID, year, `round: unverified`, and `source_kind` (null
  until registered/manifest provenance and artifact bytes verify; then `official`),
  provenance URLs/path, manifest digest and `verified` flag, status, extraction,
  `council_series_accepted: false`, and uncertainty reasons.
- `extraction`: null on failure; otherwise page count, exact integer `fields`,
  numerical `field_evidence` (page, label, printed value), `printed_quotients`
  as decimal strings, bounded `list_rows`, `unparsed_table_rows`, `category: null`.
  List rows expose only public electoral list IDs/group labels, printed votes,
  printed percentages and page references. No candidate or fiscal names are emitted.
- `failure_counts`: number of sources per failure reason. Reasons distinguish missing
  or duplicate registry entries; malformed/unreadable manifests; missing, duplicate,
  non-ok or malformed manifest records; missing/malformed registry pins and
  registry/manifest provenance disagreement; unsafe archive paths; missing/unreadable
  files; digest mismatches; PDF decoding failures; unsupported PDF layouts.
- `uncertainty_counts`: number of sources per uncertainty reason, not a count of
  votes or excluded people. `unparsed_table_rows` separately counts unmatched rows.
  Missing printed fields are null, never zero. Repeated/conflicting fields are null
  with separate reason codes; repeated list IDs retain every row and require review.
- With `--include-html`, HTML extraction names the uniquely identified CONCEJALES
  column, its adjacent percentage column, details and footer. It preserves printed
  values, labels and DOM locations. List percentages use positive votes; positive
  and blank summary percentages use total votes; the footer turnout percentage
  uses electors. Missing or repeated headers, malformed rows and repeated fields
  are surfaced. `exclusions_by_reason` distinguishes rows absent in this category
  from unusable rows; malformed/repeated list identities cannot establish agreement.
- `reconciliation` compares the PDF with the integrated HTML and the integrated
  HTML with the two published electorate components, per field and per list ID.
  It includes field provenance, complete-list positive-denominator checks and
  the unresolved coverage conflict. Unknown values stay unknown. Counts from the
  two electorate components are added only for this explicit version comparison;
  differing versions are never combined into one electoral figure.
- `suitability` describes the selected 2027 point-share-vector target and reports
  `forecast_ready: false`. It records the approved `slice09-point-pilot-v1`
  protocol and the preserved extraction-checkpoint ledger: three candidate origins,
  zero accepted origins, `scores: null`, `model_evaluated: false` and
  `status: evidence_review_in_progress`. Its `review_status` explicitly records
  reopening with additional documentary evidence; dated availability, category
  evidence and the territory stability assumption remain subject to review.
  This is a documentary checkpoint, not automatic verification of boundaries,
  alliance continuity or origin availability. The extractor's non-acceptance flag alone
  is not evidence of those gaps. Probabilistic scoring is not applicable to this
  point target.

## Supported evidence and limitations

The extractor uses pinned `pypdf==6.14.2`, strict decoding, the existing manifest
reader and `read_verified_archive` boundary. Verification requires a valid registry
`expected_sha256`, agreement with the manifest digest (case-insensitive), and matching
URL, election year/round, MIME and source kind. PBA's registered official default
uses the existing identity contract; the manifest must explicitly declare official.
The registered MIME must be `application/pdf`, the year must match the selected ID,
and manifest capability must be `pba`. Round whitespace follows identity normalization;
URL and MIME are compared exactly. Metadata agreement does not establish scientific
round/category acceptance: the report still declares them unverified.

`registry_pin_missing`, `registry_pin_malformed`, and `archive_pin_mismatch` are
separate failures. Field-specific `registry_provenance_mismatch:<field>`,
`manifest_provenance_missing:<field>`, `manifest_provenance_malformed:<field>`, and
`archive_provenance_mismatch:<field>` distinguish absent, unusable and conflicting
metadata. Invalid types rejected by the existing manifest reader remain
`manifest_malformed` for the whole manifest; invalid registry schema remains fatal.

Traversal, absolute/Windows drive-qualified paths, same-prefix substitute directories
and archive symlinks are refused before reading. Storage's specific unsafe-component
exception becomes `archive_path_unsafe` in that source's JSON; the command continues
reporting all selected sources, without masking unrelated programming errors.
There is no parallel downloader/archive/ingester.
The original six snapshots were inspected after SHA verification, including both
PDF layout families (2015–2021/2025 and 2023). Their supported text layout is a single
page with exactly one `Lista Votos %` heading, terminated by `VOTOS POSITIVOS`.
Only complete single-line list rows are extracted. The anchored prefix accepts
optional whitespace around the literal hyphen: `<ID>- <GROUP>` and
`<ID> - <GROUP>` are supported. The group, integer vote and decimal-comma percentage
suffix rules are unchanged. The six snapshots have complete rows even though each
label, vote count and percentage is a separate positioned PDF text-show operand.
The 2025 label/vote/percentage columns are shifted 20 points from earlier reports;
default text extraction still joins each row correctly. No positional parser is
needed for these snapshots. Wrapped/unmatched rows are counted explicitly, never
repaired or silently discarded. With `--include-earlier`, 2011 uses that one-page
layout; only the fixed 2013 identity may have two pages. Its numeric table and
whitelisted fields are on page one and its elected-candidate section on page two.
The second page must pass the bounded section check with no digits, vote table,
numerical summaries or quotients. Only its excluded-line count is returned,
under `candidate_section_continuation`; candidate text stays out of the report.
Other page/table layouts fail closed; no OCR fallback.

Printed blank-label aliases include `BLANCO` (2015), `VOTOS EN BLANCO` (2017),
and singular `VOTO EN BLANCO` (2019/2021/2023/2025); the existing `EN BLANCO`
alias is retained. Null labels include `VOTO NULO` (2011), `NULOS` (2013/2015)
and `VOTOS NULOS` (2017–2023).
No printed null label was found in 2025: its null field remains unknown, not zero
or a residual inferred from other totals. Duplicate list IDs retain every row;
repeated/conflicting numerical fields remain null with explicit reason counts.

Fields are the printed positive, blank, null and total votes, electors and mesas.
Printed council/school-council quotients are evidence strings, not recalculations.
Grouped `Votos` are **not** classified as council-category votes merely because
they agree with a quotient. Round/category, party continuity, complete category
coverage and source-series suitability remain unverified. Missing `NULOS` in a PDF
is unknown rather than an inferred zero. Parser diagnostics/raw text are suppressed.

Without `--include-html`, `coverage_comparison` preserves extracted PDF mesas alongside the previously
documented HTML total/count **156/156**, with `html_verified_by_command: false` and
`status: unresolved`. With the flag, these values come from verified HTML bytes,
and `html_verified_by_command` records digest verification. The authorized PDF reports
**154**. Agreement with the argentinos mesa count is a numeric observation, not an
explanation of the discrepancy: `cause: unverified` remains explicit. No version
is chosen or superseded by timestamp.
All six snapshots are municipal reference candidates; no forecasting, model or
scientific acceptance follows from a successful exit.

HTML verification uses the same registry/manifest identity and safe SHA-verified
archive boundary, with MIME `text/html`. The protected legacy integrated source
may omit a registry pin; its manifest digest is still checked against its bytes.
The two new electorate variants require registered literal pins. No existing
HTML identity or stable filename is migrated.
The integrated manifest predates `election_year`, `election_round` and
`source_kind`. Only this protected identity may lack those three fields; its
registry identity, exact URL/MIME/capability and digest still verify. Absent
manifest fields are listed in provenance and uncertainty reasons. Present
conflicting or null metadata is refused, as is missing metadata in new variants.
The original manifest record is preserved rather than backfilled.
