# Evidence and data quality — isolated design prototype

One navy/cyan/Plex territorial workbench, extending the approved Votus prototype
family. It asks whether users can distinguish result availability, coverage units,
geographic validity and the limits of current application capabilities.

## Run and verify

Run `node serve.mjs` from this directory and open the printed loopback URL.
The parent-owned server proxies six immutable files from the frozen Exploration
assets without copying or changing them. Run `node verify.mjs` for the real-entry
functional checks. No installation, live API, authentication or database is used.
Sibling navigation is limited to previously opened local design previews.

## Evidence boundaries

- Every result, coverage relation and deep unit is fictional. The default selection
  is Rosales / 2025 / council members, with 49,300 positive votes and 2/2 fictional
  circuits. A percentage is permitted only for explicit typed units in the policy.
- Unit typing must match the record's structural denominator, not just its node ID.
  Generic missing-record 0/1 is untyped even at a typed national/PBA node. Untyped
  province/partido relations and Chubut's 7/10 never yield a computed percentage.
  National aggregates are independent fictional samples,
  not a sum of the visible provincial rows.
- Complete zero votes and tied parties remain complete; absent vote vectors remain
  missing. Records reject unknown party keys, unsafe integers, invalid status or
  coverage combinations and missing node records. Nothing is silently dropped.
- Source geography is separate from result availability. Observed geometries remain
  selectable in the table and neutral in the map. Deep units have no own locations;
  a neutral Rosales outline is a reference, not an invented polygon or marker.
- The national frame is continental, not the full territory. A separate collapsed
  reference preserves the supplied polar outline without assigning results.
- The verified-code view is a dated local capability snapshot, not a live territorial
  verification. Hosted coverage and organization permissions remain unknown. The
  official contract has no expected-mesa denominator.
- Internal fiscal coverage is explicit opt-in, separate, not random, and has no sample
  here. It is not represented as denial of current-user access or merged with official
  votes. Search/visible rows never replace aggregate coverage.
- Consultation cases are visibly simulated. Empty, denied, unavailable, truncated and
  malformed states clear metrics, child results and provenance. Asset failure and
  invalid input fail closed and offer a local retry.
- Provenance exposes only missing official bindings and the actual design-fixture
  fingerprint. It never renders unrestricted source URLs, paths, notes or source
  hashes as official verification. Recorded SHA does not prove verified bytes.
- Six capability facts come from the immutable parent-authored policy. Review remains
  a paginated read-only consultation of kind/severity/detectedAt, not remediation.
- Practical reading is bound to the selected year/category record: what can be read,
  what cannot be claimed and how it limits Comparison/Simulation. Complete samples,
  including zero votes or ties, declare no missing electoral units in the sample.
  Partial/missing samples state that the originating reason is unknown; no file,
  ingestion, quarantine or category-applicability cause is inferred.
- Compact native child details expose the same reason and reading impact beneath
  each inspection control, preserving the four-column table and keyboard focus.
  Guidance derives only from validated sample evidence and the separate geographic
  diagnostic. Free-form note/cause/missingReason fields are never rendered.
- Loading, local failures, simulated queries, internal selection and the dated code
  view replace every practical-reading field; no stale figures or downstream input
  approval survive a blocked state. Search/filter display counts do not rewrite it.

## Implementation and access

HTML, CSS and browser ES modules only; three local Plex fonts. All state lives in
memory. Four local asset fetches and no browser storage. Native controls, breadcrumbs,
focused selection headings, a scrollable table and native dialogs provide the keyboard
path. Closing dialogs or using Escape restores the opener. No production source,
ETL, DB, auth, dependencies or approved sibling artifacts are changed.
Keyboard retry restores the selection heading after success, or the retry control
after another failure; it does not leave focus on a replaced button.

Owned UI files: `index.html`, `prototype.css`, `prototype.js`, `evidence-model.js`
and this document. `serve.mjs`, `author-policy.mjs`, policy JSON and checks are
parent-owned. The task and acceptance evidence are tracked separately at
`odd/tasks/evidence-quality-prototype.md` in the repository. Strict TDD is enabled:
the parent observed an actual HTTP 404 entry assertion before any UI source existed.
This is throwaway design code, not production and not a certification of live data.
The accepted reading refinement has an additional parent-owned real-entry runner,
`node verify-reading.mjs`; its missing named-region RED preceded implementation.
Automated checks do not certify manual contrast, full WCAG, screen readers, physical
devices, hosted coverage, organization permissions or a live official source binding.
