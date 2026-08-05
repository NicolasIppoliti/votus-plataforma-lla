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
from ..party_map import PartyMappingTable

# `etl.db` is imported lazily inside `load_fiscalizacion_rows` below, not at
# module scope: `etl.db` imports `etl.review_item`, which imports THIS
# module for `ReviewItemDraft`'s type -- a module-level `from .. import db`
# here would be a circular import.

PERSONAL_DATA_COLUMNS: tuple[str, ...] = ("Nombre", "Apellido")

STRIPPED_COLUMNS: tuple[str, ...] = ("Escuela", "Mesa", *FISCALIZACION_VOTE_COLUMNS)


def strip_personal_columns(raw_csv_text: str) -> str:
    """Remove `Nombre`/`Apellido` columns from raw CSV text, if present.

    Operates on TEXT, before any `csv.DictReader` row object exists (D9.3):
    the personal values are dropped at the earliest possible point, never
    parsed into a value that a later step could accidentally retain. A CSV
    that is already stripped (no `Nombre`/`Apellido` header) passes through
    unchanged, so this is safe to call unconditionally.
    """
    reader = csv.reader(io.StringIO(raw_csv_text))
    rows = list(reader)
    if not rows:
        return raw_csv_text

    header = rows[0]
    drop_indices = {i for i, name in enumerate(header) if name in PERSONAL_DATA_COLUMNS}
    if not drop_indices:
        return raw_csv_text

    out = io.StringIO()
    writer = csv.writer(out)
    for row in rows:
        writer.writerow([cell for i, cell in enumerate(row) if i not in drop_indices])
    return out.getvalue()


def _normalize_escuela(raw: str) -> str:
    """Normalize `Escuela` FOR MATCHING ONLY — the raw string is always kept
    separately (D9.4 rule 4). Folds `N°`/`Nº`/`N °` spelling variants, case,
    and stray whitespace.
    """
    text = raw.strip().upper()
    text = re.sub(r"N\s*[°º]\s*", "N ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _parse_mesa(raw: str) -> int:
    digits = re.sub(r"[^0-9]", "", raw)
    return int(digits)


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
    (D9.4 rule 4). `escuela` is the raw string; `escuela_normalized` exists
    only for matching. `source_row_indices` lists every raw CSV data-row
    index (0-based, header excluded) that contributed to this row, so a
    merged or collapsed row still traces back to its origin.
    """

    mesa: int
    escuela: str
    escuela_normalized: str
    votes: dict[str, int | None]
    source_row_indices: tuple[int, ...]


@dataclass(frozen=True)
class QuarantinedFiscalizacionRow:
    """A row D9.4 rule 3 says MUST be quarantined, never dropped.

    `note` is a review-queue-shaped message. It is built ONLY from
    structural facts (mesa numbers, column names, row indices) — never from
    `Escuela`, and never from any value that could carry a name, because by
    construction this module never holds a name value at all.
    """

    reason: str  # "duplicate_conflict" | "unmergeable_empty_mesa"
    mesa: int | None
    source_row_indices: tuple[int, ...]
    note: str


@dataclass(frozen=True)
class ReviewItemDraft:
    """A D7 review-queue item this ingestion run would record.

    Not yet wired to a `review_item` table row (that table is created in
    Phase 11, same forward-gap already noted for Phase 5's fetch-failure
    records) — this is the traceable artifact Phase 11's loader will later
    project into it.
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

    A continuation row has an empty `Mesa`. It merges into the immediately
    preceding parsed row only when BOTH hold: the non-blank columns of each
    are disjoint (so merging cannot silently overwrite a real value), and
    the two rows share the same `Escuela` (continuation rows always repeat
    their parent row's fiscal/school in the observed source shape). Anything
    else is quarantined as `unmergeable_empty_mesa`, never dropped.
    """
    merged: list[_MergedRow] = []
    quarantined: list[QuarantinedFiscalizacionRow] = []

    for index, row in enumerate(data_rows):
        mesa_text = row["Mesa"].strip()
        cells = {column: row[column] for column in FISCALIZACION_VOTE_COLUMNS}

        if mesa_text:
            merged.append(
                _MergedRow(
                    escuela_raw=row["Escuela"],
                    mesa=_parse_mesa(mesa_text),
                    cells=dict(cells),
                    source_row_indices=[index],
                )
            )
            continue

        target = merged[-1] if merged else None
        this_nonblank = _nonblank_columns(cells)
        target_nonblank = _nonblank_columns(target.cells) if target is not None else set()
        can_merge = (
            target is not None
            and target.escuela_raw == row["Escuela"]
            and not (target_nonblank & this_nonblank)
        )

        if not can_merge:
            quarantined.append(
                QuarantinedFiscalizacionRow(
                    reason="unmergeable_empty_mesa",
                    mesa=None,
                    source_row_indices=(index,),
                    note=f"row {index}: empty Mesa could not be merged into a preceding row",
                )
            )
            continue

        for column in this_nonblank:
            target.cells[column] = cells[column]
        target.source_row_indices.append(index)

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

        vectors = {tuple(row.cells[c] for c in FISCALIZACION_VOTE_COLUMNS) for row in group}
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


def ingest_fiscalizacion(raw_csv_text: str, *, archive_entry_id: str) -> FiscalizacionIngestResult:
    """Parse one fiscalización spreadsheet export per D9.4's ordered contract.

    Pure function of `raw_csv_text` — calling it twice on the same text
    yields an identical result, matching the project's D8 idempotency
    convention. `archive_entry_id` is accepted for interface symmetry with
    `ingest.pba`/`ingest.national` but is not yet threaded into a stored
    row (no fiscalización loader exists before Phase 8).
    """
    del archive_entry_id  # accepted for interface symmetry; not yet used

    # Phase 8 (task 8.5) wired `db.load_result_rows` into `ingest.national`
    # and `ingest.pba`, both already long-format (one row per list/category).
    # `FiscalizacionRow` is wide-format (one row per mesa, 17 vote columns),
    # so loading it needs a column-to-list_id mapping that does not exist
    # yet anywhere in this codebase -- deliberately NOT invented here under
    # Phase 8's scope, given D9.1's default-exclude-from-official-queries
    # rule already keeps this source out of every default read path. Left as
    # an explicit forward-gap for the phase that adds that mapping, the same
    # pattern already recorded for `review_item` in 0004/0005's migrations.
    stripped_text = strip_personal_columns(raw_csv_text)
    reader = csv.DictReader(io.StringIO(stripped_text))
    data_rows = list(reader)

    merged, merge_quarantine = _merge_wrapped_rows(data_rows)
    collapsed, collapse_quarantine, review_items = _collapse_duplicates(merged)

    rows: list[FiscalizacionRow] = []
    for entry in collapsed:
        votes: dict[str, int | None] = {}
        has_blank = False
        for column in FISCALIZACION_VOTE_COLUMNS:
            raw_value = entry.cells[column].strip()
            if raw_value == "":
                votes[column] = None
                has_blank = True
            else:
                votes[column] = int(raw_value)

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
                escuela_normalized=_normalize_escuela(entry.escuela_raw),
                votes=votes,
                source_row_indices=tuple(entry.source_row_indices),
            )
        )

    return FiscalizacionIngestResult(
        rows=tuple(rows),
        quarantined=tuple(merge_quarantine + collapse_quarantine),
        review_items=tuple(review_items),
    )


def classify_reexport_drift(*, source_kind: str) -> tuple[str, str]:
    """D9.4 rule 5: a changed sha256 on re-export is `(kind, severity)`.

    For `fiscalizacion`, a re-export is EXPECTED drift — unlike the official
    ZIPs, this hand-maintained sheet is allowed to change —
    `("source_reexported", "info")`. Every other `source_kind` keeps D2's
    existing `content_drift` warning semantics unchanged.
    """
    if source_kind == "fiscalizacion":
        return ("source_reexported", "info")
    return ("content_drift", "warning")


class FiscalizacionUploadForbiddenError(Exception):
    """Raised when a fiscalización archive entry is not explicitly marked
    `upload: never`. D9.3: fiscalización entries stay in the local mirror
    only and are never handed to a remote/shared-bucket uploader.
    """


def guard_local_mirror_only(entry: dict) -> None:
    """Refuse to proceed unless a fiscalización `sources.yaml` entry
    declares `upload: never`. This project has no remote uploader at all
    (D2: no R2/bucket path exists for anything), so the guard's job is to
    make that fact a structural, testable invariant for this one
    personal-data-bearing source rather than an implicit absence.
    """
    if entry.get("source_kind") != "fiscalizacion":
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


def build_column_list_id_map(
    party_map: PartyMappingTable,
    *,
    year: int,
    jurisdiction: str = FISCALIZACION_JURISDICTION,
    category: str = FISCALIZACION_CATEGORY,
) -> dict[str, str]:
    """Resolve each fiscalización vote column to its curated `list_id`,
    THROUGH `curated/party_map.yaml` — never by column position (task
    12.8). A column whose official name (`OFFICIAL_AGRUPACION_NAME_BY_COLUMN`)
    matches no curated `party_name` for `(year, jurisdiction, category)` is
    simply absent from the returned mapping (`En blanco`/`Impugnado`
    always fall in this case — they key on `votos_tipo`, not
    `agrupacion_nombre`, and carry no party identity to map).
    """
    by_normalized_name = {
        _normalize_party_name(entry.party_name): entry.list_id
        for entry in party_map.entries
        if entry.year == year
        and entry.jurisdiction == jurisdiction
        and entry.category == category
    }
    mapping: dict[str, str] = {}
    for column, official_name in OFFICIAL_AGRUPACION_NAME_BY_COLUMN.items():
        list_id = by_normalized_name.get(_normalize_party_name(official_name))
        if list_id is not None:
            mapping[column] = list_id
    return mapping


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
) -> int:
    """Load merged/collapsed fiscalización rows into `result_row` (task
    12.12), turning each row's 17 WIDE vote columns into one LONG
    `result_row` per resolvable list.

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
    if not rows:
        return 0

    from .. import db

    column_list_ids = build_column_list_id_map(
        party_map, year=year, jurisdiction=jurisdiction, category=category
    )

    election_id = db.upsert_election(conn, year=year, round_=round_)
    category_id = db.upsert_category(conn, name=category)
    jurisdiction_cache: dict[int, str] = {}
    records: list[db.ResultRowRecord] = []

    for source_row_index, row in enumerate(rows):
        jurisdiction_id = jurisdiction_cache.get(row.mesa)
        if jurisdiction_id is None:
            jurisdiction_id = db.upsert_jurisdiction(
                conn, distrito=distrito, seccion=seccion, mesa=row.mesa
            )
            jurisdiction_cache[row.mesa] = jurisdiction_id

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
                    is_unmapped=False,
                    archive_entry_id=archive_entry_id,
                    source_row_index=source_row_index,
                )
            )

    return db.load_result_rows(conn, archive_entry_id=archive_entry_id, records=records)
