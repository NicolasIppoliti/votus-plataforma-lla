# Rosales council evidence: candidate periods found, acceptance pending

**Official candidate periods have been located; no comparable council series has
been accepted for forecasting.** One 2025 source has prior archival provenance,
bounded fresh PDF checks cover 2015, 2017, 2019, 2021 and both 2023 paths.
Response hashes and council/definitive labels are recorded, but round and source
acceptance remain unresolved. This is a
metadata inventory, not acquisition approval, an evaluation or a feasibility pass.
The [suitability plan](../plans/slice-09-predictive-suitability.md) retains all gates.

## Observation scope and authority

Prior catalogue/metadata observations: **2026-09-30, UTC-03:00**, supplied by
the parent and read-only verifier `muo66jow-3-ylhh`. Fresh PDF observations:
**2026-09-30 14:48:44.344098–14:48:46.396029 UTC (+00:00)**, supplied by
read-only verifier `muo7woho-7-s59i`. This writer did not fetch live sources.
The observation methods and bounds are recorded below under **Fresh PDF response
metadata: bounded snapshot, not acquisition**. Prior exposure and acceptance limits
remain explicit in this published inventory.
Local registry, manifest, parser and curation citations were verified previously;
this update did not reopen those sources.

| Evidence level | Meaning here | Does not establish |
| --- | --- | --- |
| Published link | Official catalogue contains a year label and report URL | Report access, actual format, category or completeness |
| Fresh response metadata | Bounded format, completed-byte hash and whitelisted labels | Archived acquisition, outcome validation or full report interpretation |
| Prior acquired source | Manifest records archived bytes and provenance | Equality to current bytes or forecasting suitability |
| Existing parser/curation contract | Local code describes categories and mappings | A comparable accepted historical series |
| Forecast acceptance | Separate review of target, versions, mappings and evaluation | Not performed by this inventory |

## Candidate-period inventory

All rows concern potential evidence for whole-municipality Coronel Rosales
CONCEJALES, not a claim of mesa-level or all-partido forecast coverage.

| Period / source | Evidence actually available | Acceptance still pending |
| --- | --- | --- |
| 2025 Junta definitive district HTML | Prior acquired source; registry/parser describe CONCEJALES alongside provincial legislature aggregates. Current parent extraction showed definitive 2025 title and owner only. | Current territory/category confirmation, version equality, denominator, roster, coverage and comparability |
| 2023 Junta definitive PDF, prior citation path | Local council-identity citation; fresh one-page PDF response, council/definitive/year labels and hash. Prior GENERALES match was not reproduced. | Round, archival provenance, complete interpretation, coverage, denominator and roster acceptance |
| 2023 Junta catalogue path | Owner-published link; fresh response byte-identical to the prior citation path at the recorded time | Canonical/source-version decision, future alias stability and archival acceptance |
| 2021, 2019, 2017, 2015 Junta reports | Fresh one-page PDF responses, council/definitive/year labels and hashes | Round, archival provenance, historical boundaries, denominator, roster and coverage acceptance |
| 2023 national provisional ZIP | Separate registered national source and local INTENDENTE mapping contract | Not the definitive council source; not accepted as a council-series substitute |

The periods listed are candidates, not a count of independently usable temporal
observations: six responses cover five year candidates and a 2023 alias, not six
independent periods or a sufficient temporal series. Lack of local registration
does not establish historical source absence.

### 2025: prior archive versus current readability

Primary URL:
<https://www.juntaelectoral.gba.gov.ar/escrutinio-definitivo-2025/distrito_027.html>.

[Archive manifest](../../archive-manifest.json) (lines 18–28) records:

| Provenance field | Recorded value |
| --- | --- |
| Entry | `pba/2025-distrito-027` |
| Archived path | `archive/pba/distrito_027.html` |
| SHA-256 | `b46c1fbe90bd6e623b1c2dcac88790243e7d585890a46afd4290f1ded7a9f852` |
| Bytes / MIME | `471727` / `text/html` |
| Acquisition timestamp | `2026-08-04T14:14:39Z` |
| Archive status | `ok` |
| Publisher revision identifier | Not provided in this record |

This is **prior manifest provenance, not a fresh-fetch hash**. Archived bytes were
not reopened or rehashed in this documentation task. The parent current readable
extraction omitted the embedded image; it was not inspected. Current category,
territory and equality to the prior source remain unverified. The 2025 HTML was
not included in the six fresh PDF requests; its status is unchanged.

[Registry](../../etl/sources.yaml) (lines 138–153),
[PBA parser contract](../../etl/etl/ingest/pba.py) (lines 1–22, 149–155) and
[prior path discovery](../../spikes/002-pba-2025-paths.md) (lines 17–44)
describe district aggregates, with council and provincial categories kept distinct,
not disaggregated mesas/circuits. The parser explicitly does not parse reference
PDFs. These are local historical contracts, not new live category verification.

### 2023: snapshot byte equality, source-version acceptance pending

- Locally cited and parent-fetched PDF:
  <https://www.juntaelectoral.gba.gov.ar/resultados-generales/2023027.pdf>.
- Official catalogue's published 2023 URL:
  <https://www.juntaelectoral.gba.gov.ar/resultados/2023027.pdf>.

[Party curation](../../curated/party_map.yaml) (lines 137–174) cites the first
path for definitive council identities. The
[archived exploration source description](../../openspec/changes/archive/2026-08-04-electoral-analysis-platform/exploration.md)
(lines 35–48) also describes that report as district-level evidence.
Neither description is full current acceptance. The current source registry and
archive manifest contain no record for this 2023 Junta PDF. The fresh response
checksum below is metadata, not an archive entry or replayable acquired provenance.
Do not transfer the national ZIP's checksum to this report.

Direct comparison of completed response bytes found equality; page/year/label
checks also agreed. Final URLs equaled requested URLs, with empty redirect chains.
This resolves observed byte equivalence only at the recorded time, not future
alias stability, canonical path selection or archival/source acceptance. Preserve
both URLs and the owner-published catalogue versus prior citation distinction.

### Catalogue navigation: prior link provenance

The verifier observed HTTP 200 for the official
[homepage](https://www.juntaelectoral.gba.gov.ar/),
[provincial historical catalogue](https://www.juntaelectoral.gba.gov.ar/mapa-provincia-bsas.php)
and its published
[Rosales district catalogue](https://www.juntaelectoral.gba.gov.ar/distritos.php?distrito=027).
The homepage's active Datos Historicos menu exposes the provincial catalogue;
its CORONEL ROSALES anchor has literal `data-source="distritos.php?distrito=027"`.
The district catalogue labels CORONEL ROSALES.

The published 2021, 2019, 2017 and 2015 report URLs appear in the fresh response
table below. At the prior catalogue check they were unopened; the fresh checks
now establish access and PDF format, not full historical comparability.
The prior verifier made four in-memory HTTP requests across three distinct URLs
(the provincial catalogue twice); these are separate from the parent's fetches
and from the six fresh PDF requests.
No HTTP/local-file failure was observed in verifier checks. Initial explorer tool
unavailability was a tool blocker, resolved by another role, not source failure.

## Fresh PDF response metadata: bounded snapshot, not acquisition

All six responses returned HTTP 200, `application/pdf`, `%PDF-` magic and one
extractable page. Final URLs matched requested URLs; redirect chains were empty.
There were no retries or failures. The verifier used Python 3.9.6 and existing
pypdf 6.14.2; two inline programs exited 0. Limits were 20 seconds per request
and 5 MiB per body, with a same-owner HTTPS guard. Bodies and extracted text
remained in memory; no PDF files, archive acquisitions or outcome output were made.

Observation window: **2026-09-30 14:48:44.344098–14:48:46.396029 UTC (+00:00)**.
Hashes describe completed response bytes at this time only.

| Exact requested URL | Bytes | SHA-256 |
| --- | --- | --- |
| <https://www.juntaelectoral.gba.gov.ar/resultados/2015027.pdf> | 240119 | `78bcdfc8901f759130db4d4085fc1be8fcedf2337599d123f39d9c2bd518ca2d` |
| <https://www.juntaelectoral.gba.gov.ar/resultados/2017027.pdf> | 240055 | `a3468c938bb9393b341d87638b39be46ae0f6d6c56cdab456c85a7394174bc13` |
| <https://www.juntaelectoral.gba.gov.ar/resultados/2019027.pdf> | 240019 | `f4e4f56d85fc0851cbc2c35fd727de60324584bdd10412f203e00374b9c57f6f` |
| <https://www.juntaelectoral.gba.gov.ar/resultados/2021027.pdf> | 239983 | `682aeb7bbba4eceed32123a4bb6b60b273e5a9c9adf75345fa8fb7f8548afa75` |
| <https://www.juntaelectoral.gba.gov.ar/resultados/2023027.pdf> | 9820 | `5d44448d8ed1d7c646190f9d30533217706d5b4803a3c439602ce7362ee733cb` |
| <https://www.juntaelectoral.gba.gov.ar/resultados-generales/2023027.pdf> | 9820 | `5d44448d8ed1d7c646190f9d30533217706d5b4803a3c439602ce7362ee733cb` |

### Positive labels and unresolved round contradiction

Every PDF matched its expected election year in heading context within the first
1,500 extracted characters, not merely in its filename. Whitelisted checks also
matched CORONEL ROSALES, CONCEJALES, ESCRUTINIO DEFINITIVO, PROVINCIA DE BUENOS
AIRES and NULOS. These labels do not establish denominators, full rosters,
granularity, coverage, historical boundaries or independent temporal adequacy.

Normalized GENERALES, PASO, BLANCOS, VALIDOS and EMITIDOS checks were false for
all six responses. Nonmatches are **not verified category or round absence** and
must not become zeros or exclusions. The previously reported 2023 GENERALES match
was **not reproduced**: this is an explicit unresolved contradiction, not a fresh
GENERALES confirmation or evidence of PASO/general-round absence. Round acceptance
remains pending for every candidate period; neither URL spelling nor definitive
status resolves it. No vote values, full tables or rosters were displayed.

## Keep source and category boundaries intact

The national 2023 source is
<https://www.argentina.gob.ar/sites/default/files/2023_generales_1.zip>;
[registry](../../etl/sources.yaml) (lines 69–82) records it separately.
[Party curation](../../curated/party_map.yaml) (lines 176–207) distinguishes its
provisional INTENDENTE identities from definitive CONCEJALES identities.
The delivered municipal 2023 INTENDENTE / 2025 CONCEJALES adapter pairing is a
category mismatch, not a matched council series; see the
[suitability plan](../plans/slice-09-predictive-suitability.md) (lines 12–20).
National deputy comparison is likewise not council evidence.

[Crosswalk](../../curated/crosswalk.yaml) (lines 3–6, 16–23) maps PBA partido
`027` to national distrito/seccion `02/027`. That current reference does not prove
historical boundaries for every candidate year. Preserve one normalization boundary;
do not promote partido aggregates to provincial totals or fabricate finer coverage.
Fiscalización stays outside official training/evaluation evidence and is never pooled.

## Acceptance checklist: none completed by metadata discovery

- [ ] Accept each source version, election, category, round and revision; resolve
  the 2023 canonical/source-version decision and obtain replayable archival
  acquisition/checksum provenance; snapshot alias byte comparison is complete only.
- [ ] Verify historical territorial applicability and actual report granularity
  for each candidate period, without inferring finer units from aggregate metadata.
- [ ] Accept election-specific list mappings, alliance changes and unresolved
  identities; separately accept the future 2027 roster rather than assume it known.
- [ ] Reconcile outcome/share denominators, blank/annulled and unmodeled categories,
  coverage and missingness. Report exclusions/quarantines by category and reason.
- [ ] Explicitly accept/reject each period or proxy for comparability; do not turn
  incomplete interpretation, absent mapping or unavailable category into zero.
- [ ] Assess independently comparable temporal evidence and evaluation adequacy;
  rows or mesas within an election do not supply independent future elections.

Missingness and exclusion totals are **not measured here**, not zero. No category
or period is silently excluded or accepted. Source discovery does not select a model,
threshold, probabilistic guarantee or implementation route.

## Exposure and next decision

Scout grep and verifier AGENTS reading previously exposed historical aggregate
examples. A prior writer encountered aggregate examples in AGENTS/local references
and outcome rows in an over-broad prior-spike read; no values are reproduced here.
Fresh PDF bodies/text were processed in memory for hashes and whitelisted labels;
no official result tables or outcome values were displayed. Prior exposure remains
disclosed; memory-only processing is not proof of wholly unseen evidence. Do not
call future evaluation wholly unseen or untouched; disclose this exposure and accept
an explicit protocol before holdout reading. This does not establish that every
possible future holdout is invalid.

**Current no-go is on forecast readiness, not a permanent statistical conclusion.**
The next separately authorized step is source acquisition/verification and acceptance
review addressing canonical/source-version decisions, unresolved rounds and
remaining comparability gates, followed by evaluation-design acceptance. Current
2023 snapshot byte equality is known; it is not the remaining acceptance decision. No
acquisition, ingestion, model fitting, evaluation or forecast is authorized by this
note. Vote uncertainty and deterministic statutory seat conversion remain separate.
