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

import datetime as dt
import re
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import datetime
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser

from .. import db
from ..archive import (
    POLITENESS_DELAY_SECONDS,
    ArchiveIntegrityError,
    ArchiveResult,
    FetchResponse,
    archive_source,
    read_verified_archive,
)
from ..crosswalk import CrosswalkTable
from ..http_client import DEFAULT_USER_AGENT, HostPolicy, PolicedHostFetcher
from ..jurisdiction import (
    QuarantinedPbaDistrito,
    ResultRow,
    make_result_row,
    resolve_pba_distrito_code,
)
from ..manifest import latest_ok_record
from ..numeric import parse_source_int
from ..storage import LocalArchiveStore

# NO `PBA_PARTY_MAP_JURISDICTION`. It named the `party_map.yaml` label PBA
# municipal rows resolve under, for `resolve_pba_party` -- deleted with the
# rest of the `is_unmapped` layer, leaving a constant whose only readers were
# its own tests. The label is a fact about `curated/party_map.yaml`, and it
# now lives in the test that actually asserts the contract it encodes: that
# the 22xx municipal family never resolves against the national scheme.

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


class PbaSchemaError(ValueError):
    """Raised when the archived PBA page does not carry the structure this
    parser reads.

    Named, and a `ValueError` subclass so existing callers still catch it:
    these were bare `ValueError`s that no CLI `except` tuple listed, so a
    re-skinned page exited with a traceback instead of the exit 1 the module
    contract promises -- while `NationalSchemaError`, its exact twin, was
    caught in four places.
    """


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
    sleep: Callable[[float], None] = time.sleep
    default_backoff_seconds: float = POLITENESS_DELAY_SECONDS["pba"]

    def get(
        self, url: str, *, timeout: float, headers: dict[str, str] | None = None
    ) -> FetchResponse:
        """`headers` is accepted because `archive.Fetcher` declares it, and
        the User-Agent in it is deliberately SUPERSEDED by the host policy
        (D10 constraint 4): the identifying UA for this host is the policy's,
        not the caller's, which is the whole point of routing through
        `PolicedHostFetcher`.

        Any OTHER header is refused rather than silently dropped. A caller
        that sets one is expressing an expectation this path cannot honour,
        and swallowing it would make the request differ from the request the
        caller believes it made.
        """
        unsupported = sorted(k for k in (headers or {}) if k.lower() != "user-agent")
        if unsupported:
            raise ValueError(
                f"the PBA host policy owns this request's headers; {', '.join(unsupported)} "
                "cannot be forwarded, so it is refused rather than silently dropped"
            )
        last_response: FetchResponse | None = None
        for attempt in range(1, self.max_attempts + 1):
            response = self.policed.get(url, timeout=timeout)
            if response.status_code == 429 or response.status_code >= 500:
                last_response = response
                if attempt < self.max_attempts:
                    # `Retry-After` is legally an HTTP-date
                    # ("Wed, 21 Oct 2015 07:28:00 GMT"), not only
                    # delta-seconds. `float()` on one raised `ValueError` out
                    # of the backoff loop, turning a routine 429 into a
                    # traceback on the one path built to back off and stop.
                    delay = self._retry_delay(response.headers.get("Retry-After"))
                    self.sleep(delay)
                continue
            return response
        raise PbaFetchExhaustedError(
            f"{url} failed after {self.max_attempts} attempts; last status "
            f"{last_response.status_code if last_response else 'unknown'}"
        )

    def _retry_delay(self, retry_after: str | None) -> float:
        """The delay this host asked for, or the policy default.

        An HTTP-date is honoured as the interval until that instant; an
        unreadable value falls back to the default rather than raising --
        being unable to read the host's requested delay is not a reason to
        stop backing off.
        """
        if not retry_after:
            return self.default_backoff_seconds
        try:
            return float(retry_after)
        except ValueError:
            pass
        try:
            # It RAISES on an unreadable value; it does not return `None`.
            parsed = parsedate_to_datetime(retry_after)
        except (TypeError, ValueError):
            return self.default_backoff_seconds
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.UTC)
        remaining = (parsed - datetime.now(dt.UTC)).total_seconds()
        return max(remaining, self.default_backoff_seconds)


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
        archived_path = existing.get("archived_path")
        if not isinstance(archived_path, str) or not archived_path:
            raise ArchiveIntegrityError(
                f"cached archive record for {entry['id']!r} has no archived_path"
            )
        filename = archived_path.rsplit("/", 1)[-1]
        read_verified_archive(
            local_store,
            capability=entry["capability"],
            filename=filename,
            expected_sha256=existing.get("sha256"),
        )
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
_EXPECTED_CATEGORIES = frozenset(category for _, category in _CATEGORY_HEADER_MATCH)


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
            if needle not in header:
                continue
            previous_index = mapping.get(category)
            if previous_index is not None:
                raise PbaSchemaError(
                    f"recognized category {category!r} appears in header positions "
                    f"{previous_index + 1} ({headers[previous_index]!r}) and "
                    f"{index + 1} ({header!r}); refusing to pick one"
                )
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


# NO `PbaSourceUnavailable`. It promised that a missing archived source is
# reported as unavailable and never substituted with a zero or an estimate --
# a promise `__main__.ingest_source` already keeps, one layer up and on the
# only path production uses, by raising `UnknownSourceError("no archived copy
# of ... -- run `fetch --source ...` first")` before it opens a connection.
# Two exceptions for one refusal meant the tested one was the unreachable one.


# A sentinel, because `None` already means "this list did not run in this
# category" -- a real electoral fact. An unreadable cell is a different fact
# and gets its own reason, so the two are never counted together.
class _UnreadableVote:
    """Typed sentinel for a non-empty vote cell that cannot be parsed."""


_UNREADABLE = _UnreadableVote()
_CANONICAL_SPANISH_INTEGER = re.compile(r"(?:[0-9]+|[0-9]{1,3}(?:\.[0-9]{3})+)")


def _parse_votes(raw: str) -> int | None | _UnreadableVote:
    """Parse a Spanish-locale vote count (`"15.254"` -> 15254).

    Returns `None` for `"-"` or an empty cell — that list did not run in
    that category, which is NOT the same as zero votes, so no row is
    produced for it at all (see the `list_id == "962"` case in the fixture).

    Returns the `_UNREADABLE` sentinel -- NOT `None`, and not `ValueError` --
    for anything else that will not parse (`"1O"`, `"n/d"`, a footnote
    marker). Saying `None` here would collapse the two facts the sentinel
    exists to keep apart, and the next reader trusting the docstring would
    write `if votes is None: continue` and swallow every unreadable cell.
    This was the last parser here
    still crashing on one bad cell: the exclusion report is printed AFTER the
    loop, so a single unreadable figure destroyed the whole page's parse and
    the breakdown for everything already excluded. `_parse_mesa`,
    `ingest_fiscalizacion`'s vote cells and `ingest_national`'s `_parse_int`
    all already refuse to do that. The caller counts it under its own reason,
    so an unreadable cell is never confused with an absent one.
    """
    stripped = raw.strip()
    if stripped in ("", "-"):
        return None
    if _CANONICAL_SPANISH_INTEGER.fullmatch(stripped) is None:
        return _UNREADABLE
    parsed = parse_source_int(stripped.replace(".", ""))
    return parsed if parsed is not None else _UNREADABLE


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
    # `utf-8-sig`: the same one decoding boundary the CSV readers use. A BOM
    # here would land inside the first tag the parser sees.
    parser.feed(html_bytes.decode("utf-8-sig"))

    if not parser.distrito_label:
        raise PbaSchemaError("could not locate the distrito identifier in the source page")
    distrito_code = parser.distrito_label.split("-", 1)[0].strip()

    category_columns = _category_column_indices(parser.headers)
    missing_categories = _EXPECTED_CATEGORIES - category_columns.keys()
    if missing_categories:
        recognized_categories = sorted(category_columns)
        raise PbaSchemaError(
            "incomplete PBA category schema; missing categories: "
            f"{', '.join(sorted(missing_categories))}; recognized categories: "
            f"{', '.join(recognized_categories) if recognized_categories else '(none)'}"
        )

    degraded_from = requested_granularity if requested_granularity != GRANULARITY_ACTUAL else None

    rows: list[PbaRow] = []
    # Rule 3: every drop below is counted PER REASON and reported. All three
    # were silent, and they are not equivalent -- a summary row is expected,
    # while a SHORT ROW is malformed HTML, i.e. schema drift arriving as
    # absence. Reported together as one total, the drift would have hidden
    # inside the expected count.
    excluded: dict[str, int] = {}
    excluded_short_row_columns: set[str] = set()

    def exclude(reason: str) -> None:
        excluded[reason] = excluded.get(reason, 0) + 1

    for row_index, cells in enumerate(parser.rows):
        list_id = cells[0].strip() if cells else ""
        if not list_id:
            # "VOTOS POSITIVOS" / "VOTO EN BLANCO" summary rows carry an
            # empty list-id cell — not a normalized per-list result.
            exclude("summary row (empty list-id cell)")
            continue

        for category, column in category_columns.items():
            if column >= len(cells):
                # The header declared this category's column and the row does
                # not reach it: the table changed shape under us.
                exclude("short row (declared category column missing)")
                excluded_short_row_columns.add(category)
                continue
            votes = _parse_votes(cells[column])
            if isinstance(votes, _UnreadableVote):
                exclude("unreadable vote cell")
                continue
            if votes is None:
                # "-" or an empty cell: that list did not run in that
                # category, which is NOT zero votes, so no row is produced.
                exclude('list absent from this category ("-" or empty cell)')
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
                )
            )

    if excluded:
        report = "; ".join(
            f"{reason}: {count}"
            for reason, count in sorted(excluded.items(), key=lambda kv: -kv[1])
        )
        if excluded_short_row_columns:
            report += (
                " -- the short rows were missing the column(s) for "
                + ", ".join(sorted(excluded_short_row_columns))
                + ", so this page no longer has the shape this parser was written against"
            )
        print(
            f"excluded {sum(excluded.values())} PBA table cell(s)/row(s) -- {report}",
            file=sys.stderr,
        )

    return rows


# NO `load_pba_distrito_totals` and NO `resolve_pba_party`, both correct,
# both tested, neither with a production caller.
#
# `load_pba_distrito_totals` re-implemented `ingest_source`'s manifest lookup
# and archived read so it could call `ingest_pba` itself. One read path is
# the point: a second one drifts, and the drift is invisible because only the
# unused copy has tests describing it.
#
# `resolve_pba_party` fed the `is_unmapped` column, now dropped by migration
# 0014. Whether a PBA list id resolves is answered by joining `party_mapping`
# at query time, which stays correct when `curated/party_map.yaml` gains an
# entry AFTER the 18.1M rows were loaded -- a boolean frozen at ingestion
# would not, and nothing read it.


@dataclass(frozen=True)
class QuarantinedPbaRow:
    """A `PbaRow` whose PBA-native distrito code has no curated
    `jurisdiction_crosswalk` entry -- kept as data alongside the reason
    (task 17.3).

    It has no national counterpart, and that asymmetry is the correct
    shape: the crosswalk is a PBA-to-national SCHEME TRANSLATOR, so only PBA
    rows can fail to translate. National codes are already national."""

    row: PbaRow
    reason: str


@dataclass(frozen=True)
class PbaJurisdictionResolutionResult:
    resolved: tuple[PbaRow, ...]
    quarantined: tuple[QuarantinedPbaRow, ...]


def resolve_pba_jurisdictions(
    rows: list[PbaRow], crosswalk: CrosswalkTable
) -> PbaJurisdictionResolutionResult:
    """Translate every row's PBA-native distrito code (e.g. `"027"`) to the
    national numbering scheme via the curated `jurisdiction_crosswalk`
    (task 17.5), BEFORE any `jurisdiction` row is created.

    Scheme cause (Phase 17): PBA writes its own `distrito_code`, a
    different numbering scheme from national's, straight into
    `db.upsert_jurisdiction` -- `jurisdiction_crosswalk` was never consulted
    at ingestion, so a PBA row became its own island instead of resolving to
    the same distrito national ingestion and fiscalización use. Mirrors
    `ingest.national.resolve_jurisdictions`'s mapped/quarantined split for
    the analogous national-side problem. An uncurated PBA distrito code is
    quarantined (task 17.3), never silently written as a new jurisdiction.
    """
    resolved: list[PbaRow] = []
    quarantined: list[QuarantinedPbaRow] = []

    for row in rows:
        translated = resolve_pba_distrito_code(row.result.distrito, crosswalk)
        if isinstance(translated, QuarantinedPbaDistrito):
            quarantined.append(QuarantinedPbaRow(row=row, reason=translated.reason))
            continue

        national_distrito, national_seccion = translated
        if (national_distrito, national_seccion) == (row.result.distrito, row.result.seccion):
            resolved.append(row)
            continue

        # A PBA partido total is a SECCION-level figure in the national scheme:
        # PBA's distrito `027` is the partido, while national distrito `02` is
        # the province and Coronel Rosales is its seccion `027`. Keeping the
        # partido total at distrito granularity with a null seccion attributed
        # 32.291 CONCEJALES votes -- Coronel Rosales's own valid-vote
        # denominator -- to the whole of Buenos Aires.
        translated_result = make_result_row(
            granularity="seccion" if national_seccion else row.result.granularity,
            distrito=national_distrito,
            seccion=national_seccion,
            category=row.result.category,
            list_id=row.result.list_id,
            votes=row.result.votes,
        )
        resolved.append(replace(row, result=translated_result))

    return PbaJurisdictionResolutionResult(resolved=tuple(resolved), quarantined=tuple(quarantined))


def load_pba_rows(
    conn,
    rows: list[PbaRow],
    *,
    year: int,
    round_: str,
    crosswalk: CrosswalkTable,
    archive_entry_id: str,
) -> int:
    """Task 8.5 (D8): same delete-by-`archive_entry_id`-then-bulk-insert
    wrapper as `ingest.national.load_national_rows`, adapted to `PbaRow`'s
    distrito-only lineage (`seccion`/`circuito`/`mesa` are always `None`
    here -- `upsert_jurisdiction`'s `IS NOT DISTINCT FROM` lookup is exactly
    what makes that safe to re-run without duplicating the jurisdiction row).

    Task 17.5: `rows` are resolved through `jurisdiction_crosswalk`
    (`resolve_pba_jurisdictions`) BEFORE any jurisdiction is created --
    `crosswalk` is now a required argument, not optional, so a caller can
    never accidentally skip this step and write a PBA-scheme island. A
    quarantined row (task 17.3) is reported to stderr and never written.
    """
    # NO early return on an empty batch, and none after the quarantine
    # below either. `db.load_result_rows` is the delete-then-insert PAIR, so
    # returning early skipped the DELETE: re-ingesting a source whose rows now
    # all quarantine -- the curated `027` crosswalk entry removed, say -- left
    # the previous run's rows live and read as current by every query, while
    # the CLI printed "ingested 0 rows" and exited 0.
    #
    # `archive_entry_id` is REQUIRED rather than taken from `rows[0]`, because
    # with zero rows the function cannot otherwise state its own scope.
    if any(row.archive_entry_id != archive_entry_id for row in rows):
        raise ValueError("load_pba_rows requires every row to carry the archive_entry_id given")

    resolution = resolve_pba_jurisdictions(rows, crosswalk)
    if resolution.quarantined:
        codes = sorted({q.row.result.distrito for q in resolution.quarantined})
        print(
            f"quarantined {len(resolution.quarantined)} PBA row(s) with no curated "
            f"jurisdiction_crosswalk entry for distrito(s) {', '.join(codes)} -- "
            "not written to result_row",
            file=sys.stderr,
        )
    rows = list(resolution.resolved)

    # THE DEGRADATION, REPORTED. `ingest_pba` computes `degraded_from` and
    # `PbaRow` carries it as a first-class field, and this function read it
    # nowhere -- so on the only production path (`ingest_source` calls
    # `ingest_pba` with its default `requested_granularity="mesa"`) every
    # single row was degraded and every single one said so to nobody.
    #
    # It is REPORTED rather than stored, deliberately. `result_row.granularity`
    # already records what the figure IS (`distrito`/`seccion`), so no reader
    # can mistake it for a mesa-level number. `degraded_from` records what the
    # CALLER asked for and did not get -- a fact about this run's request, not
    # about the row -- and a request's intent does not belong in a results
    # table.
    degraded_rows = [row for row in rows if row.degraded_from]
    degraded = {row.degraded_from for row in degraded_rows if row.degraded_from is not None}
    if degraded:
        stored_lineages = sorted(
            {f"{row.result.distrito}/{row.result.seccion}" for row in degraded_rows}
        )
        print(
            # The DEGRADED subset, not `len(rows)`. Production degrades every
            # row today, so the wrong count was right by accident -- which is
            # how it would have survived to the day a mixed batch made it
            # report undegraded rows as degraded.
            f"{len(degraded_rows)} PBA row(s) requested at "
            f"{', '.join(sorted(degraded))} granularity: the source-native PBA "
            f"distrito total was stored as national seccion {', '.join(stored_lineages)} -- "
            "this source publishes no finer breakdown, and none was fabricated "
            "to satisfy the request",
            file=sys.stderr,
        )

    election_id = db.upsert_election(conn, year=year, round_=round_)
    category_cache: dict[str, str] = {}
    # Keyed on the (distrito, seccion) LINEAGE, and the annotation says so:
    # it read `dict[str, str]` while the code keyed on the tuple, which is
    # the distrito-only shape that attributed 32.291 CONCEJALES votes to the
    # whole province. A declaration that disagrees with the code is the bug
    # still on file.
    jurisdiction_cache: dict[tuple[str, str | None], str] = {}
    records: list[db.ResultRowRecord] = []

    for row in rows:
        category_id = category_cache.get(row.category)
        if category_id is None:
            category_id = db.upsert_category(conn, name=row.category)
            category_cache[row.category] = category_id

        # The lineage is (distrito, seccion), not distrito alone: a PBA partido
        # total is a seccion-level figure once translated to the national
        # scheme, and dropping the seccion attributes it to the whole province.
        lineage = (row.result.distrito, row.result.seccion)
        jurisdiction_id = jurisdiction_cache.get(lineage)
        if jurisdiction_id is None:
            jurisdiction_id = db.upsert_jurisdiction(
                conn, distrito=row.result.distrito, seccion=row.result.seccion
            )
            jurisdiction_cache[lineage] = jurisdiction_id

        records.append(
            db.ResultRowRecord(
                election_id=election_id,
                jurisdiction_id=jurisdiction_id,
                category_id=category_id,
                granularity=row.granularity,
                list_id=row.list_id,
                votes=row.votes,
                # HARDCODED, and no override parameter. It was
                # `source_kind: str = "official"`, a caller-settable kwarg no
                # caller ever set: a writable door into the one invariant
                # rule 5 says must never be crossed, with nothing in the write
                # path to refuse a fiscalización batch labelled official.
                # `load_fiscalizacion_rows` hardcodes its own kind for the
                # same reason.
                source_kind="official",
                archive_entry_id=row.archive_entry_id,
                source_row_index=row.source_row_index,
            )
        )

    return db.load_result_rows(
        conn,
        archive_entry_id=archive_entry_id,
        records=records,
        election_id=election_id,
    )
