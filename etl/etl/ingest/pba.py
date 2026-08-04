"""PBA provincial/municipal 2025 ingestion (`electoral-ingestion` spec, PBA
subset; design D10's etiquette layer bound to a real fetcher target; D6/D7's
degradation-is-explicit requirement).

Path discovery (task 5.0, `spikes/002-pba-2025-paths.md`) found the real
source for distrito 027 (Coronel Rosales) at
``escrutinio-definitivo-2025/distrito_027.html`` — an HTML page whose
embedded ``<table>`` reports one already-scrutinized DISTRITO-LEVEL total
per (list, category), for two categories: ``Diputados Prov. Tit.`` (PBA
provincial legislature) and ``Concejales Titulares`` (municipal council).
No mesa or circuito breakdown exists at this source. Per the accepted
product decision #1 (`electoral-ingestion` spec, "Distrito-level PBA
municipal totals ingested" scenario), the system ingests at that
granularity rather than fabricating finer levels — enforced structurally by
`jurisdiction.make_result_row`, which this module always calls with
``granularity="distrito"`` and no lower-level fields.

Four "bancas" PDFs are also linked from the same page and are registered in
``PBA_ALLOWED_PATHS`` so an operator can archive/open them as reference
documents, but this module NEVER parses PDF bytes anywhere —
PDF/telegrama OCR extraction is explicitly out of scope
(`electoral-ingestion` spec).
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime
from html.parser import HTMLParser

from ..archive import POLITENESS_DELAY_SECONDS, ArchiveResult, FetchResponse, archive_source
from ..http_client import DEFAULT_USER_AGENT, HostPolicy, PolicedHostFetcher
from ..jurisdiction import ResultRow, make_result_row
from ..manifest import latest_ok_record
from ..party_map import PartyMappingTable, PartyResolutionResult, resolve_party_for_rows
from ..storage import LocalArchiveStore

# The distrito this ingestion path covers (Coronel Rosales); PBA municipal's
# list-id scheme is a separate namespace from the national `agrupacion_id`
# space even where numeric values coincide (party-identity-mapping spec,
# task 7.6c) -- resolution always uses this jurisdiction label, never
# ``"national"``.
PBA_PARTY_MAP_JURISDICTION = "coronel_rosales_municipal"

# ---------------------------------------------------------------------------
# D10 — the real, discovered fetcher target (spikes/002-pba-2025-paths.md)
# ---------------------------------------------------------------------------

PBA_HOST = "www.juntaelectoral.gba.gov.ar"

# Bounded surface (D10 constraint 7): only the exact confirmed paths, never
# a directory prefix — a prefix like "/escrutinio-definitivo-2025/" would
# permit crawling the whole subtree, which is exactly what this constraint
# forbids. The first entry is this module's actual ingestion source; the
# remaining four are reference-only "bancas" PDFs, registered so an operator
# can archive/open them, never parsed by this module.
PBA_ALLOWED_PATHS: tuple[str, ...] = (
    "/escrutinio-definitivo-2025/distrito_027.html",
    "/escrutinio-definitivo-2025/concejales/2025027.pdf",
    "/escrutinio-definitivo-2025/consejeros/2025027.pdf",
    "/escrutinio-definitivo-2025/concejales_distri/2025027.pdf",
    "/escrutinio-definitivo-2025/consejeros_distri/2025027.pdf",
)

PBA_HOST_POLICY = HostPolicy(
    host=PBA_HOST,
    max_concurrency=1,  # D10 constraint 2 — serial only for this host
    min_delay_seconds=POLITENESS_DELAY_SECONDS["pba"],  # D10 constraint 3
    user_agent=DEFAULT_USER_AGENT,  # D10 constraint 4
    allowed_path_prefixes=PBA_ALLOWED_PATHS,  # D10 constraint 7
)

DEFAULT_MAX_ATTEMPTS = 3  # D10 constraint 6 — bounded retry, then stop


class PbaFetchExhaustedError(Exception):
    """Raised when the PBA host returns 429/5xx on every attempt up to
    ``DEFAULT_MAX_ATTEMPTS``. D10 constraint 6: back off and stop, never
    retry through it indefinitely.
    """


@dataclass
class _PolicedBackoffFetcher:
    """Adapts a `PolicedHostFetcher` to the `archive.Fetcher` protocol,
    adding D10 constraint 6's bounded backoff-then-stop on 429/5xx.

    `PolicedHostFetcher` already owns concurrency, delay, User-Agent and
    path-allowlist enforcement (D10 constraints 1-4, 7); this adapter adds
    only the retry/backoff loop so `archive.archive_source` can be reused
    unmodified.
    """

    policed: PolicedHostFetcher
    max_attempts: int = DEFAULT_MAX_ATTEMPTS
    sleep: object = time.sleep
    default_backoff_seconds: float = POLITENESS_DELAY_SECONDS["pba"]

    def get(
        self, url: str, *, timeout: float, headers: dict[str, str] | None = None
    ) -> FetchResponse:
        last_response: FetchResponse | None = None
        for attempt in range(1, self.max_attempts + 1):
            response = self.policed.get(url, timeout=timeout)
            if response.status_code == 429 or response.status_code >= 500:
                last_response = response
                if attempt < self.max_attempts:
                    retry_after = response.headers.get("Retry-After")
                    delay = float(retry_after) if retry_after else self.default_backoff_seconds
                    self.sleep(delay)
                continue
            return response
        raise PbaFetchExhaustedError(
            f"{url} failed after {self.max_attempts} attempts; last status "
            f"{last_response.status_code if last_response else 'unknown'}"
        )


def archive_pba_source(
    entry: dict,
    *,
    fetcher: PolicedHostFetcher,
    local_store: LocalArchiveStore,
    records: list[dict],
    now: datetime | None = None,
    sleep=time.sleep,
) -> ArchiveResult:
    """Archive one PBA source entry, honouring D10's full etiquette.

    Constraint 5 (archive-first caching): a URL with an existing ``status:
    "ok"`` record is never re-fetched — the network is not touched at all
    for it on this call. Otherwise delegates to
    ``archive.archive_source``, which already handles "no partial entry on
    failure" and content-drift detection; the only addition here is
    ``fetcher`` being a bounded-backoff adapter around the policed fetcher
    (constraint 6).
    """
    existing = latest_ok_record(records, entry["id"])
    if existing is not None:
        return ArchiveResult(record=existing)

    return archive_source(
        entry,
        fetcher=_PolicedBackoffFetcher(policed=fetcher, sleep=sleep),
        local_store=local_store,
        now=now,
    )


# ---------------------------------------------------------------------------
# Parsing — distrito_027.html's embedded results table
# ---------------------------------------------------------------------------

GRANULARITY_ACTUAL = "distrito"

_CATEGORY_HEADER_MATCH: tuple[tuple[str, str], ...] = (
    ("Diputados", "DIPUTADOS PROVINCIALES"),
    ("Concejales", "CONCEJALES"),
)


class _DistritoTableParser(HTMLParser):
    """Extracts the distrito code and the results table from one
    ``distrito_<code>.html`` page. Deliberately narrow: it only tracks the
    handful of elements this source is known to carry (see
    `spikes/002-pba-2025-paths.md`), not a general HTML-table extractor.
    """

    def __init__(self) -> None:
        super().__init__()
        self.distrito_label: str | None = None
        self.headers: list[str] = []
        self.rows: list[list[str]] = []

        self._in_distrito_value = False
        self._in_thead = False
        self._in_th = False
        self._th_buffer = ""
        self._in_tbody = False
        self._in_tr = False
        self._in_td = False
        self._td_buffer = ""
        self._row_cells: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_d = dict(attrs)
        css_class = attrs_d.get("class") or ""
        if tag == "span" and "detail-value-big" in css_class:
            self._in_distrito_value = True
        elif tag == "thead":
            self._in_thead = True
        elif tag == "th" and self._in_thead:
            self._in_th = True
            self._th_buffer = ""
        elif tag == "tbody":
            self._in_tbody = True
        elif tag == "tr" and self._in_tbody:
            self._in_tr = True
            self._row_cells = []
        elif tag == "td" and self._in_tr:
            self._in_td = True
            self._td_buffer = ""

    def handle_endtag(self, tag: str) -> None:
        if tag == "span" and self._in_distrito_value:
            self._in_distrito_value = False
        elif tag == "thead":
            self._in_thead = False
        elif tag == "th" and self._in_th:
            self._in_th = False
            self.headers.append(self._th_buffer.strip())
        elif tag == "tbody":
            self._in_tbody = False
        elif tag == "tr" and self._in_tr:
            self._in_tr = False
            if self._row_cells:
                self.rows.append(self._row_cells)
        elif tag == "td" and self._in_td:
            self._in_td = False
            self._row_cells.append(self._td_buffer.strip())

    def handle_data(self, data: str) -> None:
        if self._in_distrito_value:
            text = data.strip()
            if text:
                self.distrito_label = (self.distrito_label or "") + text
        if self._in_th:
            self._th_buffer += data
        if self._in_td:
            self._td_buffer += data


def _category_column_indices(headers: list[str]) -> dict[str, int]:
    mapping: dict[str, int] = {}
    for index, header in enumerate(headers):
        for needle, category in _CATEGORY_HEADER_MATCH:
            if needle in header:
                mapping[category] = index
    return mapping


@dataclass(frozen=True)
class PbaRow:
    """A normalized PBA result row plus ingestion provenance.

    Wraps `jurisdiction.ResultRow` the same way `ingest.national.NationalRow`
    does, adding this ingestion path's own fields: the D8
    `(archive_entry_id, natural key)` idempotency pair, and `degraded_from`
    — the requested granularity when it differs from what the source
    actually provides. `degraded_from` is `None` when no degradation
    occurred, never a log-only side note (task 5.6).
    """

    result: ResultRow
    archive_entry_id: str
    source_row_index: int
    degraded_from: str | None
    natural_key: tuple[str, str, str, str]

    @property
    def granularity(self) -> str:
        return self.result.granularity

    @property
    def category(self) -> str:
        return self.result.category

    @property
    def list_id(self) -> str | None:
        return self.result.list_id

    @property
    def votes(self) -> int:
        return self.result.votes


class PbaSourceUnavailable(Exception):
    """Raised when no archived source exists yet for a given PBA record id.

    Per `electoral-ingestion` spec's "No PBA source available for a given
    category" scenario: callers MUST report the data as unavailable, and
    MUST NOT substitute a zero-filled or estimated figure.
    """


def _parse_votes(raw: str) -> int | None:
    """Parse a Spanish-locale vote count (`"15.254"` -> 15254).

    Returns `None` for `"-"` or an empty cell — that list did not run in
    that category, which is NOT the same as zero votes, so no row is
    produced for it at all (see the `list_id == "962"` case in the fixture).
    """
    stripped = raw.strip()
    if stripped in ("", "-"):
        return None
    return int(stripped.replace(".", ""))


def ingest_pba(
    html_bytes: bytes, *, archive_entry_id: str, requested_granularity: str = "mesa"
) -> list[PbaRow]:
    """Parse one archived `distrito_<code>.html` page into normalized rows.

    Pure function of `(html_bytes, archive_entry_id, requested_granularity)`
    — calling it twice against the same bytes yields an identical list,
    matching D8's idempotency precondition the same way
    `ingest.national.ingest_national` does.
    """
    parser = _DistritoTableParser()
    parser.feed(html_bytes.decode("utf-8"))

    if not parser.distrito_label:
        raise ValueError("could not locate the distrito identifier in the source page")
    distrito_code = parser.distrito_label.split("-", 1)[0].strip()

    category_columns = _category_column_indices(parser.headers)
    if not category_columns:
        raise ValueError("could not locate any recognized category column header")

    degraded_from = (
        requested_granularity if requested_granularity != GRANULARITY_ACTUAL else None
    )

    rows: list[PbaRow] = []
    for row_index, cells in enumerate(parser.rows):
        list_id = cells[0].strip() if cells else ""
        if not list_id:
            # "VOTOS POSITIVOS" / "VOTO EN BLANCO" summary rows carry an
            # empty list-id cell — not a normalized per-list result.
            continue

        for category, column in category_columns.items():
            if column >= len(cells):
                continue
            votes = _parse_votes(cells[column])
            if votes is None:
                continue

            result = make_result_row(
                granularity=GRANULARITY_ACTUAL,
                distrito=distrito_code,
                category=category,
                list_id=list_id,
                votes=votes,
            )
            rows.append(
                PbaRow(
                    result=result,
                    archive_entry_id=archive_entry_id,
                    source_row_index=row_index,
                    degraded_from=degraded_from,
                    natural_key=(archive_entry_id, distrito_code, category, list_id),
                )
            )

    return rows


def load_pba_distrito_totals(
    records: list[dict],
    local_store: LocalArchiveStore,
    *,
    record_id: str,
    capability: str = "pba",
    requested_granularity: str = "mesa",
) -> list[PbaRow]:
    """Resolve `record_id` against the manifest and parse its archived
    bytes, or raise `PbaSourceUnavailable` — never a zero/default result.
    """
    entry = latest_ok_record(records, record_id)
    if entry is None:
        raise PbaSourceUnavailable(f"no archived source for {record_id!r}")

    archived_path = entry.get("archived_path") or ""
    filename = archived_path.rsplit("/", 1)[-1]
    html_bytes = local_store.read(capability, filename)
    return ingest_pba(
        html_bytes, archive_entry_id=record_id, requested_granularity=requested_granularity
    )


def resolve_pba_party(
    rows: list[PbaRow], party_map: PartyMappingTable, *, year: int
) -> PartyResolutionResult:
    """Resolve each PBA row's canonical party via `party_map`
    (party-identity-mapping spec, task 7.8), always under
    `PBA_PARTY_MAP_JURISDICTION` -- the 22xx municipal list family is never
    resolved against the national `agrupacion_id` scheme (task 7.6c).
    """
    return resolve_party_for_rows(
        rows, party_map, year=year, jurisdiction=PBA_PARTY_MAP_JURISDICTION
    )
