# Ideology v1: partial source-authentication ledger

**PARTIAL AUTHENTICATION / NOT FROZEN / NO ADMITTED REAL CUTS / NO REAL EVALUATION**

This passive E6 ledger records parent-supplied primary-source observations and
read-only verifier evidence. It is not an input freeze, crosswalk, profile coding,
or scientific verdict. Acquisition observations below were not rerun by this
writer. The methodology remains [the public experiment contract](slice-09-ideology-v1-method.md).

The existing synthetic delivery (`cfbb91c`/`79`, parent-supplied shorthand) has
independent verification and native acknowledgement; that does not authenticate
real inputs. Readiness remains false. E6 research remains partial.

## Review boundaries

Keep these claims separate: political-core continuity; legal identity; the common
full-offer roster; programme content; and historical publication/availability.
A changed name or changed members alone does not disprove political continuity.
A repeated numeric ID alone does not prove continuity or legal succession.
No grouping, residual offer, dropped list, invented zero-demand offer, or axis
assignment from party identity/member context is authorized. UNKNOWN is not centre.

## 1. Municipal registry: status, not a continuity map

Primary sources: [caducas](https://www.juntaelectoral.gba.gov.ar/agrupaciones-caducas.php)
and [recognized](https://www.juntaelectoral.gba.gov.ar/agrupaciones-reconocidas.php).
The parent reports actual retrieval of both registers.

| Register | Observed entry | Limited conclusion |
|---|---|---|
| Caducas | 809 BIEN COMUN POR ROSALES; CORONEL ROSALES; 13-04-2026; ART46INCB | Recorded caducidad/status |
| Caducas | 382 INTEGRACION VECINALISTA ROSALEÑA; 06-07-2022; art46incb | Separate recorded caducidad/status |
| Recognized | 962 AGRUPACION MUNICIPAL PRIMERO ROSALES | Current recognized entry |
| Recognized | 988 INICIATIVA VECINALISTA ROSALEÑA | Current recognized entry |

809 was absent from the current recognized register. These are distinct
register/status observations, not proof of a rename, transfer, split or axis.
No secondary split claim is admitted here.

## 2. Alliance recognition: references to common platforms

- [Juntos recognition](https://www.juntaelectoral.gba.gov.ar/files/resoluciones/150622307202100000.PDF):
  actual eight pages, 14,088 extracted text characters; case 5200-17015/2021.
  Page 2 refers to common-platform clause 6 and expediente folios 9/11.
  Page 6 registers Juntos as a proper name and takes note of the common
  electoral platform and agreed candidate-list integration arrangements.
- [Frente de Todos recognition](https://www.juntaelectoral.gba.gov.ar/files/resoluciones/150612307202100000.PDF):
  actual seven pages, 9,784 extracted text characters; internally identified
  as FDT, with a clause 4 platform reference and common-platform resolution.

These administrative documents do not reproduce the full programmes. Their
binary SHA256 values were not verified. The locally registered signature date
2021-07-23 is not an authenticated web-publication date.

**Attribution incident:** parallel extracts initially overwrote the same
`junta-electoral.md`. Independent diagnosis was followed by separately keyed
Juntos retention and a single FDT fetch with separately retained, internally
checked text. The old shared path cannot identify both documents. No personal
signatory, DNI or address values are reproduced.

## 3. Juntos 2021 programme: content and attribution boundaries

The actual [CNE Buenos Aires general-election 2021 index](https://www.electoral.gob.ar/nuevo/paginas/plataformas2021/Generales/ba.php)
lists Avanza Libertad, FIT-Unidad, Frente de Todos, Juntos and Vamos con Vos.
Its [linked Juntos PDF](https://www.electoral.gob.ar/nuevo/paginas/plataformas2021/Generales/BUENOS%20AIRES/JUNTOS.pdf)
was downloaded once: HTTP 200, `application/pdf`, 282,041 bytes.

- Raw SHA256: `6602d1a344ccf6e7984ecd357b653e8d6088784919038620ef548786caaaff9a`.
- Acquisition: `2026-10-08T15:29:23.953435Z`; this is not historical publication.
- Six scanned pages; empty extracted page text, with 131 wrapper characters.
- An independent verifier rendered and visually read all six actual PNG pages.
  Page 1 identifies “PLATAFORMA ELECTORAL” and province of Buenos Aires.
- Subjects include institutional control, infrastructure, water/sanitation,
  education, health, social assistance, security and administrative transparency.

This is provincial subject matter, not an individual-member document. The heading
alone identifies neither alliance nor year; the index supplies Juntos/2021
attribution. Identity with recognition expediente folios 9/11 and binding to the
Rosales municipal common offer remain independently unproved. No numeric bands
or historical `available_on` are assigned.

The supplied renderer evidence records pinned CPython 3.13.12 `-I -S -B`,
macOS PDFKit/AppKit/Foundation through `osascript` with `shell=false`, a 30-second
budget, native RC 0, six pages and empty stderr. Outer RC was not exposed.
No OCR, installation or publishing occurred. Temporary PDF/PNGs are not portable
citations and were not copied into Git; reproduction uses the exact URL, raw
hash and visual PDF reading, not a transient path or signature transcription.

## 4. Historical HTML: local IDs and incomplete reconciliation

The primary Concejales Titulares endpoint is
`https://www.juntaelectoral.gba.gov.ar/distritoEstadisticasHistoricas.php?anio=YEAR&did=027`.
Observed 2017 entries: 503 Unidad Ciudadana, 508 Cambiemos.
Observed 2021 entries: 503 Avanza Libertad, 508 Vamos con Vos.
This demonstrates election-local number reuse, not succession. No complete
latest/outcome identity matrix or three verified comparable cuts exists here.

Nine older HTML fetches (2001/03/05/07/09/11/13/15/21) returned HTTP 200 with
UTF-8 header/meta declarations. Strict UTF-8 decoding succeeded only for 2001
and 2021; Latin-1/CP1252 interpretations remain provisional and ambiguous.
No repair was admitted. Empty governed rows in the HTTP-200 2001 response do
not establish source absence. Municipal zero may coexist with provincial
positive votes, or vice versa; neither row exclusion nor nomination absence follows.

For 2005, all 18 displayed rows in DETAIL reconcile as eight positive and ten
zero, sum 24,446; the earlier TABLE's nine/nine count was incorrect. That earlier
reader omitted ASCII/reconciliation assertions and did not expose outer RC:
not a full PASS. The corrective command fetched only 2003 (13,555 bytes;
SHA256 `97f9ab021bf01a80ad889f936696a6488b332f4d368d9be8bbd789aab8da02c0`).
Its municipal-caption assertion failed, actual RC 1: “Expected one municipal
header, found []”. ASCII/accounting/sum assertions were not reached; 2005 was
not fetched in that correction. These are failed/omitted verification steps,
not scientific failure or source absence. Reconciliation remains open.

## 5. Original result bytes: integrity only

The parent reports freshly verified original archive/PBA PDF hashes with pinned
CPython RC 0. Locators are `archive/pba/YEAR027.SHA.pdf`; primary sources are
`https://www.juntaelectoral.gba.gov.ar/resultados/YEAR027.pdf`.
Verification used the original acquisition root
`/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/archive/pba/YEAR027.SHA.pdf`.
This does not guarantee binary availability in the linked worktree or a fresh
checkout; the public URL and hash remain the portable citation.

| Year | Verified SHA256 |
|---|---|
| 2019 | `f4e4f56d85fc0851cbc2c35fd727de60324584bdd10412f203e00374b9c57f6f` |
| 2021 | `682aeb7bbba4eceed32123a4bb6b60b273e5a9c9adf75345fa8fb7f8548afa75` |
| 2023 | `5d44448d8ed1d7c646190f9d30533217706d5b4803a3c439602ce7362ee733cb` |
| 2025 | `59d044be3d4e52dccf5211d3510b5d517d38cdccf484c3d1d5f549172bd88f89` |

The [district catalogue](https://www.juntaelectoral.gba.gov.ar/distritos.php?distrito=027)
was confirmed to link 1963–2025. This does not claim visits to elder PDFs.
Byte integrity authenticates neither programme, historical date nor eligible cut.

## 6. Expediente-first research: public search and bounded request

**Next priority: obtain the two 2021 common-programme annexes before reconsidering
experimental design.** The [unsent Spanish request draft](slice-09-expediente-request-draft.md)
asks only for public, redacted copies and publication witnesses. No outreach or
automatic follow-up is authorized. This section records parent-supplied research,
not independent retrieval by this writer; authentication remains partial.

### Search observations, not global absence

The actual [public resolution form](https://www.juntaelectoral.gba.gov.ar/buscar-resoluciones.php)
uses POST with browser fields `spartpol`, `stema`, `accion=requerir`, `perfil=1`,
`fecha`, `extrac`, `vtec`, `slugar=1` and submit control `action=`.
Five initial searches (809/platform theme 51; 962/theme 51; 17015; 17014;
Rosales/platform) each returned HTTP 200, strict UTF-8, 226,484 bytes and an
unpopulated table. Shared SHA256:
`d91495924a7c24599631826e21630a0b9453c7d029f038d2b015fce11f4f2900`.
These transport observations are not logical-search PASS or source-absence proof.

An actual GET returned 225,990 bytes, SHA256
`72580d703fa227fde1a669fb489237ec607e465cfc63c313c6578a78c4ec8387`.
A POST corrected to the actual submit control still returned the shared `d914…`
response; omitted action was not demonstrated to be the cause.
Finally, keyword searches with other fields defaulted and the actual submit
control returned HTTP 200, strict UTF-8 and one populated row of six cells each:

| Keyword | Bytes | Response SHA256 |
|---|---:|---|
| JUNTOS | 226,853 | `1ffa1870a512303d79fdbc769899ab5414f1636dc63aff9b3771abc542d9ad9c` |
| FRENTE DE TODOS | 226,860 | `f5199ae3caf4ae693fcd186a3cb9a8dfe99b7ab516a18aec3b4b8ba38c16d3fc` |

The links below were discovered, not invented. No record date or theme was
parsed from the table; filenames do not prove dates.

### Three acquired documents: zero requested programme annexes

Acquisition on 2026-10-08 was sequential, with a 15-second/2-MiB bound and no
retries. All three responses were HTTP 200, `application/pdf`:

1. [107662106201902030.PDF](https://www.juntaelectoral.gba.gov.ar/files/resoluciones/107662106201902030.PDF)
   — 74,369 bytes; PDF 1.4; two pages; acquired 17:36:23.415938Z.
   SHA256: `94fe3ee30edf084d9bfb7c50c8c6d9a1d76d50ac1d568ac4ef98b747ff227346`.
2. [120042008202111300.PDF](https://www.juntaelectoral.gba.gov.ar/files/resoluciones/120042008202111300.PDF)
   — 246,352 bytes; PDF 1.7; one page; acquired 17:36:25.441422Z.
   SHA256: `5bf4cbd71f4285982aa51bebc003d6651703ee15d964e8b6486531ffffe9b238`.
3. [120042008202111303.PDF](https://www.juntaelectoral.gba.gov.ar/files/resoluciones/120042008202111303.PDF)
   — 18,489 bytes; PDF 1.4; one page; acquired 17:36:25.954432Z.
   SHA256: `81e927447d8dfe21e932d965343886e47573b42c9c8caff65e540fd663dadcfa`.

All four actual pages were rendered and visually read. The supplied renderer
used pinned CPython 3.13.12 `-I -S -B`, macOS `osascript`/PDFKit, `shell=false`,
a 30-second bound and 32,768-byte cap. All native inner RCs were 0; original
outer RC was not exposed. First-document stderr was exactly:
`CoreGraphics PDF has logged an error. Set environment variable "CG_PDF_VERBOSE" to learn more.`
Other stderr was empty. Whole-PDF text lengths
were 1 / 1,142 / 717; the first was not useful. No private values were transcribed.
Temporary sources/PNGs were not copied into Git; URLs and hashes are portable.

The first document is a 2019 Partido Renovador Federal procedural resolution,
case 5200-13958/13. Page 1, II records withdrawal from Juntos por Cambio after
failed candidate-list agreements; III states that fs. 314/315 contain a copy
of the approved party programme.
Page 2, clause 3 takes note of that platform, but does not reproduce it or
establish common-alliance policy. Related alliance references conflict:
5200-16381/19 on page 1 versus 5200-13081/19 in page 2, clause 2.
This source inconsistency remains unresolved. Handwritten June 2019 has an
unclear exact day; no day is inferred from the filename.

The other two documents concern FDT case 5200-17014/2021, Celeste y Blanca 10,
for the 12 September 2021 PASO: Coronel **Suárez**, not Coronel Rosales.
They concern nomination/attachments for concejales and consejo escolar,
titulares/suplentes, with no programme clauses or annexes. Digital signing on
20 August is not authenticated publication.

Exclusive primary reason counts reconcile to three acquired documents:
one different-party/year document and two wrong-municipality nomination documents.
Office/PASO differences overlap those reasons, not additional documents.
Zero requested programme annexes were obtained; no broad source absence follows.

### Request scope and limits

The draft prioritizes Juntos 5200-17015/2021 fs. 9/11 and Frente de Todos
5200-17014/21 Annex I fs. 9/18. The latter precise folio reference is newly
parent-supplied from separate read-only research 740, not rerun by this writer.
It also asks for public locators, not whole private cases, for relevant historical
common platforms and municipal nomination instruments.

A copy obtained now may establish a byte version, not historical availability.
Even sufficient programme-identity evidence would not itself establish three
whole comparable cuts. Existing scientific criteria, readiness, freeze status,
profile bands and absence of real metrics remain unchanged.

## Remaining freeze obligations and scientific boundary

Still pending: full one-to-one offer identity, nomination, category and complete
positive-denominator matrices for at least three distinct comparable list cuts;
historical programme availability and axis rubric; dataset/recipe hashes;
all 16 selections; and disclosure of prior v0 exposure.

Prior v0 mean TV 25.373733 pp, max 36.085299 pp, gain 0.633089 pp / 2.434319%
record failed older research, not a v1 result. V1 real metrics: NONE.
No authenticity acceptance is invented and no scientific criteria are changed.
The methodology's outer criteria remain mean TV ≤5 pp, max TV ≤10 pp, and
improvement ≥10% and ≥0.5 pp over the better global-mean persistence baseline.
This ledger does not close E6, freeze inputs, unblock readiness or perform evaluation.
