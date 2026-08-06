"""Curated party-identity mapping (`party-identity-mapping` spec; design D7's
review queue, D8's idempotency precondition, D9's fiscalización source
class).

The mapping key is the FULL tuple `(year, jurisdiction, category, list_id)`
-- never `list_id` alone. Three measured, mutually incompatible identifier
schemes make this non-negotiable (Engram #1417):

1. **National `agrupacion_id` is NOT a stable cross-year party key.** LLA's
   national id CHANGED from 135 (2023 PASO) to 110 (2025 legislativas).
   Resolving a 2025 row against a 2023 entry sharing an incidental id value
   would silently attribute votes to the wrong party.
2. **`lista_numero` is populated in 2023 and EMPTY for every agrupación in
   2025** (a Boleta Única de Papel consequence -- one ballot has no
   per-party list numbers to print). The mapping key uses `list_id`
   (`agrupacion_id`), never `lista_numero`, so resolution does not silently
   fail on 2025 rows.
3. **PBA municipal's 22xx list family is unrelated to either national
   scheme.** A municipal-jurisdiction row is never resolved against a
   national-jurisdiction entry, or vice versa, even when the raw `list_id`
   value coincides.

A key with no curated entry is QUARANTINED as `UnmappedListId` data -- never
silently dropped and never falling back to a same-`list_id` entry from a
different year, jurisdiction or category (party-identity-mapping spec,
"Query encounters an unmapped list id" scenario).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


@dataclass(frozen=True)
class PartyMappingEntry:
    """One curated `(year, jurisdiction, category, list_id)` -> canonical
    party entry."""

    year: int
    jurisdiction: str
    category: str
    list_id: str
    canonical_party: str
    party_name: str
    source: str | None = None
    verified: bool = True
    """Whether a curator has confirmed this entry (task 15.4). Mirrors
    `party_mapping.verified` (migration 0005), which defaults to `true`;
    an entry the YAML explicitly marks `verified: false` is still loaded
    and resolvable -- never silently promoted to verified, and never
    silently dropped."""


@dataclass(frozen=True)
class UnmappedListId:
    """A `(year, jurisdiction, category, list_id)` key with no curated
    entry. Returned as data -- never a swallowed exception, never a
    fallback to a different year/jurisdiction/category sharing the same
    `list_id` (party-identity-mapping spec)."""

    year: int
    jurisdiction: str
    category: str
    list_id: str
    reason: str


@dataclass(frozen=True)
class PartyMappingTable:
    entries: tuple[PartyMappingEntry, ...]

    def resolve(
        self, *, year: int, jurisdiction: str, category: str, list_id: str
    ) -> PartyMappingEntry | UnmappedListId:
        """Resolve the EXACT `(year, jurisdiction, category, list_id)` key.

        Deliberately a linear exact-match scan, never a `list_id`-only
        lookup -- that shortcut is exactly what would let 2023's
        `agrupacion_id` 135 (LLA) collide with a same-numbered entry from an
        unrelated year, jurisdiction or scheme.
        """
        for entry in self.entries:
            if (
                entry.year == year
                and entry.jurisdiction == jurisdiction
                and entry.category == category
                and entry.list_id == list_id
            ):
                return entry
        return UnmappedListId(
            year=year,
            jurisdiction=jurisdiction,
            category=category,
            list_id=list_id,
            reason=(
                "no curated party mapping entry for (year="
                f"{year}, jurisdiction={jurisdiction!r}, category={category!r}, "
                f"list_id={list_id!r})"
            ),
        )


def load_party_map(path: Path) -> PartyMappingTable:
    """Load the curated `curated/party_map.yaml` party-identity mapping."""
    data: dict[str, Any] = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    entries = tuple(
        PartyMappingEntry(
            year=int(m["year"]),
            jurisdiction=str(m["jurisdiction"]),
            category=str(m["category"]),
            list_id=str(m["list_id"]),
            canonical_party=str(m["canonical_party"]),
            party_name=str(m["party_name"]),
            source=m.get("source"),
            verified=bool(m.get("verified", True)),
        )
        for m in data.get("mappings", [])
    )
    return PartyMappingTable(entries=entries)


# NO `_PartyResolvableRow` / `UnmappedPartyRow` / `PartyResolutionResult` /
# `resolve_party_for_rows`. This layer existed to compute the `result_row`
# `is_unmapped` column through `ingest.national.resolve_national_party` and
# `ingest.pba.resolve_pba_party`; all three were correct, tested, and never
# called in production, and the column they fed (always `false`, for all
# 18.170.843 rows) is dropped by migration 0014.
#
# `PartyMappingTable.resolve` above is the live entry point, used by
# `__main__.find_unmapped_parties` (the `validate-curated` command) and,
# via `entries`, by `ingest.fiscalizacion.build_column_list_id_map`. Whether
# a list id resolves is read at QUERY time by the web layer's join against
# `party_mapping`, which stays correct when `curated/party_map.yaml` gains an
# entry after a corpus is already loaded.
