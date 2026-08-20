"""Internal LLA fiscalización spreadsheet ingestion (`electoral-ingestion`
spec, fiscalización subset; design D9.4's ordered contract; D9.3's personal
data strip).

The source is a hand-maintained spreadsheet, not a machine-generated export,
so it carries artefacts a generated file never would: wrapped continuation
rows (a fiscal's trailing columns spill onto the next sheet row instead of
staying on one line) and re-entered duplicate mesas. D9.4 fixes an ORDER for
handling this, deliberately merge-before-collapse-before-quarantine, because
quarantining on an empty `Mesa` key first would silently destroy real votes
that legitimately belong to the row above (Engram #1389's corrected
analysis):

1. MERGE a wrapped continuation row into the row above it.
2. COLLAPSE identical duplicate mesa rows (sheet re-entries) into one.
3. QUARANTINE — never drop — any residual conflict: a duplicate whose vote
   values differ, or an empty-`Mesa` row that could not be merged.
4. Blank vote cells are MISSING, not zero, and stay `None`.
5. `Escuela` is normalized only for matching; the raw string is preserved.

Personal data (D9.3): `Nombre`/`Apellido` are named party fiscales and MUST
NOT survive past the very first parsing step. `strip_personal_columns`
removes them from the raw CSV TEXT before any row is ever turned into a
Python value, so no downstream object, review-queue note, or log line can
carry a name even by accident — there is no code path that has one to leak.
"""

from __future__ import annotations

import csv
import io
import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass, field

from ..crosswalk import FISCALIZACION_VOTE_COLUMNS, OFFICIAL_AGRUPACION_NAME_BY_COLUMN
from ..numeric import parse_source_int
from ..party_map import PartyMappingTable

# `etl.db` is imported lazily inside `load_fiscalizacion_rows` below, not at
# module scope: `etl.db` imports `etl.review_item`, which imports THIS
# module for `ReviewItemDraft`'s type -- a module-level `from .. import db`
# here would be a circular import.

PERSONAL_DATA_COLUMNS: tuple[str, ...] = ("Nombre", "Apellido")
_ALLOWED_COLUMNS = frozenset(("Escuela", "Mesa", *FISCALIZACION_VOTE_COLUMNS))
_UTF8_BOM = b"\xef\xbb\xbf"


def _shape_error(row: int, column: int, detail: str) -> FiscalizacionSchemaError:
    return FiscalizacionSchemaError(
        f"malformed fiscalización CSV at row {row}, column {column}: {detail}"
    )


def _decode_utf8(data: bytes, *, context: str) -> str:
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        raise FiscalizacionSchemaError(f"invalid UTF-8 in {context}") from None


def _scan_field(
    raw: bytes,
    offset: int,
    output: bytearray | None,
    *,
    row: int,
    column: int,
) -> tuple[int, int]:
    """Copy one retained raw field and return its delimiter byte (or -1 at EOF)."""
    size = len(raw)
    if offset < size and raw[offset] == ord('"'):
        if output is not None:
            output.append(ord('"'))
        offset += 1
        while offset < size:
            byte = raw[offset]
            if byte == ord('"'):
                if offset + 1 < size and raw[offset + 1] == ord('"'):
                    if output is not None:
                        output.extend(b'""')
                    offset += 2
                    continue
                if output is not None:
                    output.append(byte)
                offset += 1
                if offset == size:
                    return offset, -1
                if raw[offset] not in (ord(","), ord("\n"), ord("\r")):
                    raise _shape_error(row, column, "characters follow a closing quote")
                return offset, raw[offset]
            if output is not None:
                output.append(byte)
            offset += 1
        raise _shape_error(row, column, "quoted field is not terminated")

    while offset < size:
        byte = raw[offset]
        if byte in (ord(","), ord("\n"), ord("\r")):
            return offset, byte
        if byte == ord('"'):
            raise _shape_error(row, column, "quote appears inside an unquoted field")
        if output is not None:
            output.append(byte)
        offset += 1
    return offset, -1


def _consume_line_ending(raw: bytes, offset: int, *, row: int, column: int) -> tuple[int, bytes]:
    if raw[offset] == ord("\n"):
        return offset + 1, b"\n"
    if offset + 1 >= len(raw) or raw[offset + 1] != ord("\n"):
        raise _shape_error(row, column, "bare carriage return is not a valid record ending")
    return offset + 2, b"\r\n"


def _read_header(raw: bytes, offset: int) -> tuple[list[str], int, bytes]:
    header: list[str] = []
    column = 1
    while True:
        field = bytearray()
        offset, delimiter = _scan_field(raw, offset, field, row=0, column=column)
        text = _decode_utf8(bytes(field), context=f"header column {column}")
        try:
            parsed = next(csv.reader([text], strict=True))
        except csv.Error:
            raise _shape_error(0, column, "header field has invalid quoting") from None
        if len(parsed) != 1:
            raise _shape_error(0, column, "header field is ambiguous")
        header.append(parsed[0])
        if delimiter == ord(","):
            offset += 1
            column += 1
            continue
        if delimiter == -1:
            return header, offset, b"\n"
        offset, line_ending = _consume_line_ending(raw, offset, row=0, column=column)
        return header, offset, line_ending


def _project_data_rows(
    raw: bytes, offset: int, keep_indices: set[int], expected_columns: int
) -> bytes:
    output = bytearray()
    row = 1
    while offset < len(raw):
        column = 0
        retained = 0
        while True:
            field_output = output if column in keep_indices else None
            if field_output is not None and retained:
                output.append(ord(","))
            offset, delimiter = _scan_field(raw, offset, field_output, row=row, column=column + 1)
            if field_output is not None:
                retained += 1
            column += 1
            if delimiter == ord(","):
                offset += 1
                continue
            if column > expected_columns:
                raise _shape_error(
                    row,
                    column,
                    f"row declares {column} column(s), expected {expected_columns}",
                )
            for missing_index in range(column, expected_columns):
                if missing_index in keep_indices:
                    if retained:
                        output.append(ord(","))
                    retained += 1
            if delimiter == -1:
                return bytes(output)
            offset, line_ending = _consume_line_ending(raw, offset, row=row, column=column)
            output.extend(line_ending)
            row += 1
            break
    return bytes(output)


def strip_personal_columns(raw_csv_bytes: bytes) -> str:
    """Project allowlisted CSV fields before any personal payload is decoded."""
    if not isinstance(raw_csv_bytes, bytes):
        raise TypeError("fiscalización CSV input must be bytes")
    offset = len(_UTF8_BOM) if raw_csv_bytes.startswith(_UTF8_BOM) else 0
    if offset == len(raw_csv_bytes):
        return ""
    header, data_offset, line_ending = _read_header(raw_csv_bytes, offset)
    positions_by_name: dict[str, list[int]] = {}
    for position, name in enumerate(header, start=1):
        positions_by_name.setdefault(name, []).append(position)
    duplicate_groups = [positions for positions in positions_by_name.values() if len(positions) > 1]
    if duplicate_groups:
        duplicate_count = len(duplicate_groups)
        field_count = sum(len(positions) for positions in duplicate_groups)
        positions = "; ".join(", ".join(map(str, group)) for group in duplicate_groups)
        raise FiscalizacionSchemaError(
            "ambiguous fiscalización header -- "
            f"{duplicate_count} duplicate header "
            f"{'group' if duplicate_count == 1 else 'groups'} involving {field_count} "
            f"{'field' if field_count == 1 else 'fields'} at "
            f"{'position' if field_count == 1 else 'positions'} {positions}"
        )
    unexpected_positions = [
        position
        for position, name in enumerate(header, start=1)
        if name not in _ALLOWED_COLUMNS and name not in PERSONAL_DATA_COLUMNS
    ]
    missing = [name for name in _ALLOWED_COLUMNS if name not in header]
    if unexpected_positions:
        unexpected_count = len(unexpected_positions)
        details = [
            f"{unexpected_count} unexpected header "
            f"{'field' if unexpected_count == 1 else 'fields'} at "
            f"{'position' if unexpected_count == 1 else 'positions'} "
            + ", ".join(map(str, unexpected_positions))
        ]
        if missing:
            details.append("missing required column(s): " + ", ".join(sorted(missing)))
        raise FiscalizacionSchemaError(
            "unrecognized fiscalización sheet structure -- " + "; ".join(details)
        )
    keep_indices = {index for index, name in enumerate(header) if name in _ALLOWED_COLUMNS}
    header_output = io.StringIO(newline="")
    csv.writer(
        header_output, lineterminator=_decode_utf8(line_ending, context="line ending")
    ).writerow([name for index, name in enumerate(header) if index in keep_indices])
    projected = _project_data_rows(raw_csv_bytes, data_offset, keep_indices, len(header))
    return header_output.getvalue() + _decode_utf8(projected, context="retained CSV fields")


# NO `_normalize_escuela`. See `FiscalizacionRow`: the join it normalized
# for is by MESA NUMBER, so it folded `N°`/`Nº` spellings for a comparison
# nobody made.


# The shapes the sheet actually writes: a bare number, or the word "Mesa"
# (any casing, optional punctuation) followed by one. Anything else is
# unreadable, NOT something to mine digits out of.
_MESA_CELL = re.compile(r"^(?:mesa\s*[.:#-]?\s*)?([0-9]+)$", re.IGNORECASE)


def _parse_mesa(raw: str) -> int | None:
    """The mesa number, or `None` when the cell does not carry one.

    It used to strip EVERY non-digit and keep what was left, so `"Mesa 1O"`
    -- the letter-O typo this same file refuses to guess at in a vote cell --
    became mesa 1, and `"13 bis"` became mesa 13. That is worse than a
    dropped row: a fiscal's tally lands on a mesa that exists and belongs to
    someone else. Two ideas of what an unreadable cell is, in one parser, on
    the hand-maintained source.

    And `int("")` used to raise, killing the run on one typo'd cell and
    taking the end-of-parse quarantine breakdown with it. Both cases are now
    `None`, quarantined by the caller as `unreadable_mesa`.
    """
    match = _MESA_CELL.match(raw.strip())
    if match is None:
        return None
    return parse_source_int(match.group(1))


def _nonblank_columns(cells: dict[str, str]) -> set[str]:
    return {column for column, value in cells.items() if value.strip() != ""}


@dataclass
class _MergedRow:
    escuela_raw: str
    mesa: int
    cells: dict[str, str]
    source_row_indices: list[int]


@dataclass(frozen=True)
class FiscalizacionRow:
    """One fully merged, collapsed, deduplicated fiscalización mesa row.

    `votes` maps every column in `FISCALIZACION_VOTE_COLUMNS` to an `int`,
    or `None` when the source cell was blank — blank is MISSING, never zero
    (D9.4 rule 4). `escuela` is the raw string; there is NO
    `escuela_normalized` field -- it "existed only for matching", and the
    matching never happened: the accepted mesa-identity decision (Engram
    #1410) joins fiscalización to official rows BY MESA NUMBER, never by
    school name, so `_normalize_escuela` was computed on every row and read
    only by its own test. Nothing matches on a school here.
    `source_row_indices` lists every raw CSV data-row
    index (0-based, header excluded) that contributed to this row, so a
    merged or collapsed row still traces back to its origin.
    """

    mesa: int
    escuela: str
    votes: dict[str, int | None]
    source_row_indices: tuple[int, ...]


class FiscalizacionSchemaError(ValueError):
    """Raised when the spreadsheet does not declare a column this parser reads.

    This is the HAND-MAINTAINED source -- the one most likely to drift -- and
    it was the only parser here with no shape check at all: a renamed column
    surfaced as a bare `KeyError` deep inside the merge, which says nothing
    about which column moved and, worse, aborts before the per-reason
    quarantine breakdown is ever printed. `ingest_national` has refused a
    drifted header by name since the beginning; this is the same refusal.
    """


@dataclass(frozen=True)
class QuarantinedFiscalizacionRow:
    """A row D9.4 rule 3 says MUST be quarantined, never dropped.

    `note` is a review-queue-shaped message. It is built ONLY from
    structural facts (mesa numbers, column names, row indices) — never from
    `Escuela`, and never from any value that could carry a name, because by
    construction this module never holds a name value at all.
    """

    reason: str  # "duplicate_conflict" | "unmergeable_empty_mesa" | "unreadable_mesa"
    mesa: int | None
    source_row_indices: tuple[int, ...]
    note: str


@dataclass(frozen=True)
class ReviewItemDraft:
    """A D7 review-queue item this ingestion run would record.

    WIRED: `__main__.ingest_source` projects every draft this ingestion
    produces — the parser's and `load_fiscalizacion_rows`'s alike — into a
    `review_item` row, scoped by source and election. The docstring said
    "not yet wired to a `review_item` table row (that table is created in
    Phase 11)" long after the persistence existed, which is worse than no
    comment: a reader looking for where these observations go was told they
    go nowhere.
    """

    kind: str
    severity: str  # "info" | "warning"
    subject_ref: str
    note: str


@dataclass(frozen=True)
class FiscalizacionIngestResult:
    rows: tuple[FiscalizacionRow, ...]
    quarantined: tuple[QuarantinedFiscalizacionRow, ...]
    review_items: tuple[ReviewItemDraft, ...] = field(default_factory=tuple)


def _merge_wrapped_rows(
    data_rows: list[dict[str, str]],
) -> tuple[list[_MergedRow], list[QuarantinedFiscalizacionRow]]:
    """D9.4 rule 1: merge a wrapped continuation row into the row above it.

    A continuation row has an empty `Mesa`. It merges into the IMMEDIATELY
    PRECEDING SOURCE ROW -- checked by row index, not by "whatever last
    landed in `merged`" -- and only when BOTH hold: the non-blank columns of
    each are disjoint (so merging cannot silently overwrite a real value),
    and the two rows share the same `Escuela` (continuation rows always
    repeat their parent's school in the observed source shape). Anything
    else is quarantined as `unmergeable_empty_mesa`, never dropped.

    The index check is the fix for a real misattribution: a row quarantined
    as `unreadable_mesa` never enters `merged`, so ITS continuation row fell
    through to a mesa further up the sheet. The escuela guard does not catch
    that -- one school carries many mesas, so the names match routinely --
    and neither does the disjointness check, since a continuation row fills
    by construction the columns its parent left blank. A fiscal's trailing
    tallies landed on a mesa that exists and belongs to someone else.
    """
    merged: list[_MergedRow] = []
    quarantined: list[QuarantinedFiscalizacionRow] = []
    # The SOURCE index of the row `merged[-1]` was last extended by.
    last_merged_source_index: int | None = None

    for index, row in enumerate(data_rows):
        # `.get(...) or ""`, not `row["Mesa"].strip()`. `csv.DictReader` fills
        # a TRUNCATED row's missing trailing fields with `None`, which made
        # this an `AttributeError` mid-parse -- `find_unmapped_jurisdictions`
        # documents that same DictReader behaviour as a real hazard. A short
        # row is data to quarantine, not a crash that takes the whole run and
        # its unprinted breakdown with it.
        mesa_text = (row.get("Mesa") or "").strip()
        cells = {column: row.get(column) or "" for column in FISCALIZACION_VOTE_COLUMNS}

        if mesa_text:
            mesa = _parse_mesa(mesa_text)
            if mesa is None:
                # QUARANTINED, not dropped and not fatal: the mesa this row
                # belongs to is unknowable, so its tallies cannot be placed,
                # but the observation is kept with its row index so a human
                # can read the cell against the source.
                quarantined.append(
                    QuarantinedFiscalizacionRow(
                        reason="unreadable_mesa",
                        mesa=None,
                        source_row_indices=(index,),
                        note=(
                            f"row {index}: the Mesa cell carries no digits, so the "
                            "mesa cannot be identified and its tallies are not loaded"
                        ),
                    )
                )
                continue
            merged.append(
                _MergedRow(
                    escuela_raw=(row.get("Escuela") or ""),
                    mesa=mesa,
                    cells=dict(cells),
                    source_row_indices=[index],
                )
            )
            last_merged_source_index = index
            continue

        # ADJACENT IN THE SOURCE, checked by index. `merged[-1]` alone is
        # "whatever last landed", which is not the row above when the row
        # above was quarantined.
        target = merged[-1] if merged and last_merged_source_index == index - 1 else None
        this_nonblank = _nonblank_columns(cells)
        if target is None:
            can_merge = False
        else:
            target_nonblank = _nonblank_columns(target.cells)
            can_merge = target.escuela_raw == (row.get("Escuela") or "") and not (
                target_nonblank & this_nonblank
            )

        if not can_merge or target is None:
            quarantined.append(
                QuarantinedFiscalizacionRow(
                    reason="unmergeable_empty_mesa",
                    mesa=None,
                    source_row_indices=(index,),
                    note=(
                        f"row {index}: empty Mesa and the row immediately above it is "
                        "not a parsed row it can extend, so its tallies belong to no "
                        "identifiable mesa"
                    ),
                )
            )
            continue

        for column in this_nonblank:
            target.cells[column] = cells[column]
        target.source_row_indices.append(index)
        # A chain of continuation rows stays adjacent: each one becomes the
        # row the next must immediately follow.
        last_merged_source_index = index

    return merged, quarantined


def _collapse_duplicates(
    merged: list[_MergedRow],
) -> tuple[list[_MergedRow], list[QuarantinedFiscalizacionRow], list[ReviewItemDraft]]:
    """D9.4 rule 2 (collapse identical duplicates) then rule 3 (quarantine
    genuine conflicts — same mesa, differing vote vectors).
    """
    by_mesa: dict[int, list[_MergedRow]] = {}
    for row in merged:
        by_mesa.setdefault(row.mesa, []).append(row)

    survivors: list[_MergedRow] = []
    quarantined: list[QuarantinedFiscalizacionRow] = []
    review_items: list[ReviewItemDraft] = []

    for mesa, group in by_mesa.items():
        if len(group) == 1:
            survivors.append(group[0])
            continue

        # `escuela_raw` is PART of the identity. Comparing only the 17 vote
        # columns, two rows for one mesa with the same tallies but different
        # schools collapsed to `group[0]` and the other school was discarded
        # with no record -- a silent pick, on the hand-maintained sheet where
        # the school name is the human-readable anchor for going back to the
        # source. `_merge_wrapped_rows` right above already requires the
        # escuelas to match before it merges anything; the two paths disagreed
        # on what "the same row" means.
        #
        # A disagreement therefore falls to the `duplicate_conflict` branch
        # below, which is where it belongs: same mesa, rows that are not the
        # same observation, nothing picked.
        vectors = {
            (row.escuela_raw, *(row.cells[c] for c in FISCALIZACION_VOTE_COLUMNS)) for row in group
        }
        if len(vectors) == 1:
            kept = group[0]
            all_indices = tuple(i for row in group for i in row.source_row_indices)
            survivors.append(
                _MergedRow(
                    escuela_raw=kept.escuela_raw,
                    mesa=kept.mesa,
                    cells=kept.cells,
                    source_row_indices=list(all_indices),
                )
            )
            review_items.append(
                ReviewItemDraft(
                    kind="duplicate_collapsed",
                    severity="info",
                    subject_ref=f"mesa {mesa}",
                    # "identical" is now true of the WHOLE row, escuela
                    # included -- it used to name only the vote vectors.
                    note=f"mesa {mesa}: {len(group)} identical duplicate rows collapsed to one",
                )
            )
            continue

        for row in group:
            quarantined.append(
                QuarantinedFiscalizacionRow(
                    reason="duplicate_conflict",
                    mesa=mesa,
                    source_row_indices=tuple(row.source_row_indices),
                    note=f"mesa {mesa}: duplicate rows carry conflicting vote vectors",
                )
            )

    return survivors, quarantined, review_items


def ingest_fiscalizacion(
    raw_csv_bytes: bytes, *, archive_entry_id: str
) -> FiscalizacionIngestResult:
    """Parse one fiscalización spreadsheet export per D9.4's ordered contract.

    Pure function of `raw_csv_bytes` — calling it twice on the same bytes
    yields an identical result, matching the project's D8 idempotency
    convention. `archive_entry_id` is accepted for interface symmetry with
    `ingest.pba`/`ingest.national`. THIS function does not store anything —
    it is the pure parser — but the id it accepts is the one
    `load_fiscalizacion_rows` writes as `archive_entry_id`, which is what
    makes D8's delete-then-insert idempotent for this source.
    """
    del archive_entry_id  # this function parses; the loader below stores.

    # The column-to-list_id mapping this needs is `build_column_list_id_map`,
    # in this same file, resolved THROUGH `curated/party_map.yaml` and never
    # by column position. The comment here used to say it "does not exist yet
    # anywhere in this codebase" and point at a future phase — describing a
    # gap that two functions below had already closed.
    stripped_text = strip_personal_columns(raw_csv_bytes)
    reader = csv.DictReader(io.StringIO(stripped_text))
    declared = set(reader.fieldnames or ())
    missing = [
        column
        for column in ("Escuela", "Mesa", *FISCALIZACION_VOTE_COLUMNS)
        if column not in declared
    ]
    if missing:
        raise FiscalizacionSchemaError(
            "unrecognized fiscalización sheet structure -- missing required "
            f"column(s): {', '.join(missing)}"
        )
    data_rows = list(reader)

    merged, merge_quarantine = _merge_wrapped_rows(data_rows)
    collapsed, collapse_quarantine, review_items = _collapse_duplicates(merged)

    rows: list[FiscalizacionRow] = []
    for entry in collapsed:
        votes: dict[str, int | None] = {}
        has_blank = False
        unreadable: list[str] = []
        for column in FISCALIZACION_VOTE_COLUMNS:
            raw_value = entry.cells[column].strip()
            if raw_value == "":
                votes[column] = None
                has_blank = True
                continue
            parsed_vote = parse_source_int(raw_value)
            if parsed_vote is None:
                # An unreadable tally is missing, explicitly not zero. The
                # row still loads its readable cells and records this one for
                # review instead of fabricating a tally.
                votes[column] = None
                unreadable.append(column)
            else:
                votes[column] = parsed_vote

        if unreadable:
            # A REVIEW ITEM, not a quarantine. The row IS loaded -- every
            # readable column of it -- so counting it among the quarantined
            # made `ingest_source` print it under "not written to result_row",
            # which is false: a plausible withheld-row total whose
            # distribution is wrong is exactly rule 3's failure shape. It sits
            # beside `blank_vote_cell`, which is the same partial-load fact
            # for a cell that is empty rather than unreadable.
            review_items.append(
                ReviewItemDraft(
                    kind="unreadable_vote_cell",
                    severity="warning",
                    subject_ref=f"mesa {entry.mesa}",
                    note=(
                        f"mesa {entry.mesa}: the vote cell(s) for "
                        f"{', '.join(unreadable)} carry no readable number, so they are "
                        "loaded as missing rather than as zero"
                    ),
                )
            )

        if has_blank:
            review_items.append(
                ReviewItemDraft(
                    kind="blank_vote_cell",
                    severity="info",
                    subject_ref=f"mesa {entry.mesa}",
                    note=f"mesa {entry.mesa}: one or more vote cells are blank (missing, not zero)",
                )
            )

        rows.append(
            FiscalizacionRow(
                mesa=entry.mesa,
                escuela=entry.escuela_raw,
                votes=votes,
                source_row_indices=tuple(entry.source_row_indices),
            )
        )

    return FiscalizacionIngestResult(
        rows=tuple(rows),
        quarantined=tuple(merge_quarantine + collapse_quarantine),
        review_items=tuple(review_items),
    )


class FiscalizacionUploadForbiddenError(Exception):
    """Raised when a fiscalización archive entry is not explicitly marked
    `upload: never`. D9.3: fiscalización entries stay in the local mirror
    only and are never handed to a remote/shared-bucket uploader.
    """


def guard_local_mirror_only(entry: dict) -> None:
    """Refuse unless a fiscalización-capability entry declares `upload: never`.

    Capability is authoritative because `find_source_entry` derives it from the
    entry's `sources.yaml` family. `source_kind` is optional duplicated metadata
    and cannot safely decide whether the personal-data guard runs.
    """
    if entry.get("capability") != "fiscalizacion":
        return
    if entry.get("upload") != "never":
        raise FiscalizacionUploadForbiddenError(
            f"fiscalización entry {entry.get('id')!r} must declare `upload: never`"
        )


# ---------------------------------------------------------------------------
# 12b — Postgres loader (task 12.12)
# ---------------------------------------------------------------------------

# The distrito/seccion this fiscalización source covers, per the ACCEPTED
# mesa-identity decision (`curated/crosswalk.yaml::fiscalizacion_mesa_identity`,
# Engram #1410): fiscalización mesa numbers join to OFFICIAL national DINE
# mesa numbers by identity, within national distrito "02" / seccion "027" —
# never the separate PBA municipal (`coronel_rosales_municipal`) numbering
# scheme, which uses an unrelated 22xx list family.
FISCALIZACION_JURISDICTION = "national"

# The (jurisdiction scheme -> the place it describes) pairings this loader
# accepts. It is a table rather than a lone default because `jurisdiction`
# and `distrito`/`seccion` are two independent kwargs that MUST agree, and
# nothing checked that they did.
JURISDICTION_SCHEME_SCOPES: dict[str, tuple[str, str]] = {
    "national": ("02", "027"),
}
FISCALIZACION_CATEGORY = "DIPUTADO NACIONAL"
FISCALIZACION_DISTRITO = "02"
FISCALIZACION_SECCION = "027"


def _normalize_party_name(name: str) -> str:
    """Diacritic- and case-insensitive normalization for matching a
    fiscalización column's official name against a curated `party_name`.

    The two sources spell some names with different accents for the SAME
    real-world party (`crosswalk.py`'s "COALICIÓN CÍVICA - A.R.I." vs
    `curated/party_map.yaml`'s "COALICION CIVICA - A.R.I.") — this is a
    spelling difference, not a different party, so matching must not be
    accent-sensitive.
    """
    decomposed = unicodedata.normalize("NFKD", name)
    without_marks = "".join(char for char in decomposed if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", without_marks.strip().upper())


NON_PARTY_VOTE_COLUMNS: frozenset[str] = frozenset({"En blanco", "Impugnado"})
"""Columns that carry NO party identity — they key on `votos_tipo`, not
`agrupacion_nombre`. Naming them is what lets an unresolved PARTY column be
reported instead of blending into the same silence."""


def build_column_list_id_map(
    party_map: PartyMappingTable,
    *,
    year: int,
    jurisdiction: str = FISCALIZACION_JURISDICTION,
    category: str = FISCALIZACION_CATEGORY,
) -> tuple[dict[str, str], list[str]]:
    """Resolve each fiscalización vote column to its curated `list_id`,
    THROUGH `curated/party_map.yaml` — never by column position (task 12.8).

    Returns the mapping AND the columns it could not resolve. Absence used to
    be the only signal, and two very different things landed in it: `En
    blanco`/`Impugnado` carry no party identity to map at all (they key on
    `votos_tipo`), and a curated typo silently drops a real party's ENTIRE
    fiscalización column. The output was identical in both cases — a
    destructive filter hiding behind expected behaviour, which is the shape
    rule 3 exists for. The caller reports the unexpected ones.
    """
    # REFUSED, not last-one-wins. This was a dict comprehension, so two
    # curated entries whose `party_name` collapses to the same normalized form
    # inside one `(year, jurisdiction, category)` scope silently kept the
    # second -- and `_normalize_party_name` exists precisely to MAKE spellings
    # collide ("COALICIÓN CÍVICA - A.R.I." vs "COALICION CIVICA - A.R.I."), so
    # the collision is the function's whole purpose and nothing handled it.
    # A curator adding `UNIÓN LIBERAL` beside an existing `UNION LIBERAL` with
    # a different `list_id` would send every tally to whichever line
    # `party_map.yaml` happens to list second, with `unresolved` empty and no
    # review item fired: output indistinguishable from correct.
    by_normalized_name: dict[str, str] = {}
    collisions: dict[str, set[str]] = {}
    for entry in party_map.entries:
        if entry.year != year or entry.jurisdiction != jurisdiction or entry.category != category:
            continue
        normalized = _normalize_party_name(entry.party_name)
        previous = by_normalized_name.get(normalized)
        if previous is not None and previous != entry.list_id:
            collisions.setdefault(normalized, {previous}).add(entry.list_id)
            continue
        by_normalized_name[normalized] = entry.list_id
    if collisions:
        raise ValueError(
            "curated party_map entries collide after name normalization within "
            f"{year}/{jurisdiction}/{category}: "
            + "; ".join(
                f"{name!r} -> list ids {', '.join(sorted(ids))}"
                for name, ids in sorted(collisions.items())
            )
            + "; refusing to choose between them"
        )
    mapping: dict[str, str] = {}
    unresolved: list[str] = []
    # EVERY vote column, not just the 15 in `OFFICIAL_AGRUPACION_NAME_BY_COLUMN`.
    # Iterating that dict, `En blanco`/`Impugnado` were never seen at all --
    # they live in `OFFICIAL_VOTOS_TIPO_BY_COLUMN` -- so the `NON_PARTY_VOTE_
    # COLUMNS` guard below discriminated nothing and the distinction this
    # function exists to make ("expected unmapped" vs "a curated typo dropped
    # a real party's whole column") was made by a branch that never fired.
    for column in FISCALIZACION_VOTE_COLUMNS:
        official_name = OFFICIAL_AGRUPACION_NAME_BY_COLUMN.get(column)
        list_id = (
            by_normalized_name.get(_normalize_party_name(official_name))
            if official_name is not None
            else None
        )
        if list_id is not None:
            mapping[column] = list_id
        elif column not in NON_PARTY_VOTE_COLUMNS:
            unresolved.append(column)
    return mapping, unresolved


def mesa_subject_ref(distrito: str, seccion: str | None, mesa: int) -> str:
    """The review-queue key for one mesa, NORMALIZED.

    Public, because it has THREE writers across two modules -- this loader,
    `__main__.load_curated`'s discontinuity drafts, and migration 0018's SQL
    mirror of it -- and a key with three writers written three ways is how a
    mesa ends up with three identities.

    Built from the raw kwargs, it disagreed with both of the other writers of
    this key: `db.official_jurisdictions_for_mesa` normalizes before querying,
    and migration 0018 keys on the STORED (normalized) `seccion_code`. A
    caller passing the unpadded `"27"` the 2023 national file really carries
    produced `02-27-mesa-N` against the migration's `02-027-mesa-N` -- two
    identities for one mesa, joined by nothing. The authoritative
    active-observation write boundary compares exact `subject_ref` values, so
    the mismatched observation was appended again on every single run.

    `(sin seccion)` for an absent seccion is the same fallback the migration
    writes, so both writers key a null seccion the same way too.
    """
    from ..jurisdiction import normalize_distrito_code, normalize_seccion_code

    return (
        f"{normalize_distrito_code(distrito)}"
        f"-{normalize_seccion_code(seccion) or '(sin seccion)'}"
        f"-mesa-{mesa}"
    )


def _resolve_official_mesa(
    conn,
    *,
    election_id: str,
    distrito: str,
    seccion: str,
    mesa: int,
    review_items: list[ReviewItemDraft],
) -> str | None:
    """The `jurisdiction` row the OFFICIAL import already created for this mesa,
    or `None` with the reason recorded.

    This loader used to `upsert_jurisdiction(distrito, seccion, mesa)` with NO
    circuito while the national import writes one, so the same physical mesa
    became a SECOND identity joined to the first by nothing — and
    `/fiscalizacion` could never juxtapose, because pinning either uuid yields
    one source kind only.

    Resolving the circuito from the mesa number is not always possible: within
    one partido the same number appears under more than one circuito. That is a
    refusal, not a coin flip — attributing a fiscal's tally to a mesa nobody
    established is the fabrication this whole pipeline refuses elsewhere.
    """
    from .. import db

    matches = db.official_jurisdictions_for_mesa(
        conn,
        election_id=election_id,
        distrito=distrito,
        seccion=seccion,
        mesa=mesa,
    )
    if len(matches) == 1:
        return matches[0][0]

    if not matches:
        from ..jurisdiction import normalize_distrito_code, normalize_seccion_code

        normalized_distrito = normalize_distrito_code(distrito) or "(sin distrito)"
        normalized_seccion = normalize_seccion_code(seccion) or "(sin seccion)"
        review_items.append(
            ReviewItemDraft(
                kind="mesa_absent_from_official_import",
                severity="warning",
                subject_ref=mesa_subject_ref(distrito, seccion, mesa),
                note=(
                    f"mesa {mesa} carries fiscalización rows but the official import "
                    f"has no jurisdiction for it in distrito {normalized_distrito} seccion "
                    f"{normalized_seccion}, so it cannot be placed without inventing one"
                ),
            )
        )
        return None

    circuitos = ", ".join(str(circuito) for _, circuito in matches)
    review_items.append(
        ReviewItemDraft(
            kind="ambiguous_mesa_circuito",
            severity="warning",
            subject_ref=mesa_subject_ref(distrito, seccion, mesa),
            note=(
                f"mesa {mesa} exists in {len(matches)} circuitos ({circuitos}), so the "
                "mesa number does not identify it; a fiscalización tally cannot be "
                "attributed to one of them without guessing"
            ),
        )
    )
    return None


def load_fiscalizacion_rows(
    conn,
    rows: Sequence[FiscalizacionRow],
    *,
    year: int,
    round_: str,
    party_map: PartyMappingTable,
    archive_entry_id: str,
    jurisdiction: str = FISCALIZACION_JURISDICTION,
    category: str = FISCALIZACION_CATEGORY,
    distrito: str = FISCALIZACION_DISTRITO,
    seccion: str = FISCALIZACION_SECCION,
) -> tuple[int, list[ReviewItemDraft]]:
    """Load merged/collapsed fiscalización rows into `result_row` (task
    12.12), turning each row's 17 WIDE vote columns into one LONG
    `result_row` per resolvable list.

    `jurisdiction` (the `party_map.yaml` scheme the columns resolve under)
    and `distrito`/`seccion` (the mesas the rows are placed on) MUST describe
    the same place, and that is CHECKED below rather than assumed: a caller
    passing `jurisdiction="coronel_rosales_municipal"` with the default
    national `02`/`027` would resolve the 22xx municipal list family onto
    national mesas -- the cross-scheme collision the party map exists to
    prevent, arriving through the front door.

    Reuses `db.py::load_result_rows` unchanged, so D8's election-scoped
    delete-by-`archive_entry_id`-then-bulk-insert idempotency (migration
    0008) applies to fiscalización exactly as it already does to
    national/PBA (task 12.12) — no separate transaction logic here.

    - Column -> `list_id` resolution always goes through
      `curated/party_map.yaml` (`build_column_list_id_map`), never column
      position (task 12.8).
    - A blank vote cell (`row.votes[column] is None`) produces NO row for
      that column — missing, never a zero-vote row (task 12.9).
    - Every produced row carries `source_kind="fiscalizacion"`, never
      `"official"` (task 12.10).
    - No personal-data value ever reaches this function: `FiscalizacionRow`
      structurally carries no `Nombre`/`Apellido` field at all (D9.3), so
      there is nothing here that could leak one (task 12.11).
    """

    from .. import db
    from ..jurisdiction import normalize_distrito_code, normalize_seccion_code

    db.lock_archive_entry_source_authority(
        conn,
        archive_entry_id=archive_entry_id,
        expected_source_kind="fiscalizacion",
    )

    # THE CHECK behind the docstring's claim. Two independent kwargs that
    # must describe one place, and nothing verified they did.
    expected = JURISDICTION_SCHEME_SCOPES.get(jurisdiction)
    if expected is None:
        raise ValueError(
            f"unknown party-map jurisdiction scheme {jurisdiction!r}; add it to "
            "JURISDICTION_SCHEME_SCOPES with the distrito/seccion it describes "
            "rather than resolving list ids from one scheme onto another's mesas"
        )
    normalized_distrito = normalize_distrito_code(distrito)
    normalized_seccion = normalize_seccion_code(seccion)
    normalized_scope = (normalized_distrito, normalized_seccion)
    if normalized_scope != expected:
        raise ValueError(
            f"party-map jurisdiction {jurisdiction!r} describes distrito/seccion "
            f"{expected[0]}/{expected[1]}, but the rows are being placed on "
            f"{distrito}/{seccion}; refusing to resolve list ids across schemes"
        )
    distrito, seccion = normalized_distrito, normalized_seccion

    # NO early return on empty input. Returning before `load_result_rows` meant
    # D8's delete-by-`archive_entry_id` never ran, so re-ingesting a source that
    # now parses to zero rows — every row quarantined, or a sheet re-exported
    # empty — left the PREVIOUS run's rows alive and indistinguishable from
    # current. Ingestion has to be idempotent on the empty input too.
    column_list_ids, unresolved_columns = build_column_list_id_map(
        party_map, year=year, jurisdiction=jurisdiction, category=category
    )
    review_items: list[ReviewItemDraft] = []
    for column in unresolved_columns:
        # A PARTY column with no curated mapping drops its whole tally. Absence
        # alone could not be told apart from `En blanco`/`Impugnado`, which are
        # expected to be unmapped.
        review_items.append(
            ReviewItemDraft(
                kind="unmapped_party",
                severity="warning",
                subject_ref=f"column {column}",
                note=(
                    f"vote column {column!r} resolves to no curated party for "
                    f"({year}, {jurisdiction}, {category}), so its whole tally is "
                    "absent from result_row"
                ),
            )
        )

    election_id = db.upsert_election(conn, year=year, round_=round_)
    category_id = db.upsert_category(conn, name=category)
    jurisdiction_cache: dict[int, str | None] = {}
    records: list[db.ResultRowRecord] = []

    for row in rows:
        # THE REAL SOURCE ROW, not the position in this list.
        # `FiscalizacionRow.source_row_indices` is tracked precisely so a
        # merged or collapsed row traces back to the CSV lines it came from,
        # and `enumerate` threw that away: a row built from source rows
        # (0, 1) was stored as `0`, indistinguishable from an unmerged row,
        # so the provenance degraded invisibly. The FIRST contributing line
        # is the anchor -- `result_row.source_row_index` holds one integer --
        # and the full tuple stays visible in the `duplicate_collapsed`
        # review item that records the merge.
        source_row_index = row.source_row_indices[0] if row.source_row_indices else 0
        if row.mesa not in jurisdiction_cache:
            jurisdiction_cache[row.mesa] = _resolve_official_mesa(
                conn,
                election_id=election_id,
                distrito=distrito,
                seccion=seccion,
                mesa=row.mesa,
                review_items=review_items,
            )
        jurisdiction_id = jurisdiction_cache[row.mesa]
        if jurisdiction_id is None:
            # QUARANTINED, never placed under a guessed circuito. The reason is
            # already recorded in `review_items`.
            continue

        for column, list_id in column_list_ids.items():
            votes = row.votes.get(column)
            if votes is None:
                continue  # blank cell -- missing, never a zero-vote row (task 12.9)
            records.append(
                db.ResultRowRecord(
                    election_id=election_id,
                    jurisdiction_id=jurisdiction_id,
                    category_id=category_id,
                    granularity="mesa",
                    list_id=list_id,
                    votes=votes,
                    source_kind="fiscalizacion",
                    archive_entry_id=archive_entry_id,
                    source_row_index=source_row_index,
                )
            )

    inserted = db.load_result_rows(
        conn,
        archive_entry_id=archive_entry_id,
        records=records,
        election_id=election_id,
    )
    # The quarantine travels with the count, ALWAYS. Behind an opt-in flag the
    # production CLI never passed, every ambiguous mesa's tally dropped with no
    # record — 8 of the 93, on every real ingest. A loader that returns only
    # "how many landed" hides how many did not, and why.
    return inserted, review_items
