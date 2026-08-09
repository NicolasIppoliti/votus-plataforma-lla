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

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

import yaml


class PartyMapValidationError(ValueError):
    """Raised when curated party-map YAML has an invalid trust-boundary shape."""


class DuplicatePartyMappingKeyError(PartyMapValidationError):
    """Raised when a curated party mapping natural key appears more than once."""


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
    """Load and validate the curated party mapping at the YAML boundary."""
    data: object = yaml.safe_load(path.read_text(encoding="utf-8"))
    if data is None:
        data = {}
    if not isinstance(data, Mapping):
        raise PartyMapValidationError("party_map.yaml top level must be a mapping")

    raw_entries = data.get("mappings", [])
    if not isinstance(raw_entries, list):
        raise PartyMapValidationError("party_map.yaml mappings must be a list")

    entries: list[PartyMappingEntry] = []
    seen: set[tuple[int, str, str, str]] = set()
    required = (
        "year",
        "jurisdiction",
        "category",
        "list_id",
        "canonical_party",
        "party_name",
    )
    for index, raw_entry in enumerate(raw_entries):
        if not isinstance(raw_entry, Mapping):
            raise PartyMapValidationError(
                f"party_map.yaml mappings entry {index} must be a mapping"
            )
        missing = [field for field in required if field not in raw_entry]
        if missing:
            raise PartyMapValidationError(
                f"party_map.yaml mappings entry {index} is missing {', '.join(missing)}"
            )

        year = raw_entry["year"]
        if isinstance(year, bool) or not isinstance(year, int):
            raise PartyMapValidationError(
                f"party_map.yaml mappings entry {index} year must be an integer"
            )

        strings: dict[str, str] = {}
        for field in required[1:]:
            value = raw_entry[field]
            if not isinstance(value, str) or not value.strip():
                raise PartyMapValidationError(
                    f"party_map.yaml mappings entry {index} {field} must be a non-empty string"
                )
            strings[field] = value

        source = raw_entry.get("source")
        if not isinstance(source, str | None):
            raise PartyMapValidationError(
                f"party_map.yaml mappings entry {index} source must be a string or null"
            )
        verified = raw_entry.get("verified", True)
        if not isinstance(verified, bool):
            raise PartyMapValidationError(
                f"party_map.yaml mappings entry {index} verified must be a boolean"
            )

        entry = PartyMappingEntry(
            year=year,
            jurisdiction=strings["jurisdiction"],
            category=strings["category"],
            list_id=strings["list_id"],
            canonical_party=strings["canonical_party"],
            party_name=strings["party_name"],
            source=source,
            verified=verified,
        )
        key = (entry.year, entry.jurisdiction, entry.category, entry.list_id)
        if key in seen:
            raise DuplicatePartyMappingKeyError(
                f"party_map.yaml duplicate mapping key {key!r} at entry {index}"
            )
        seen.add(key)
        entries.append(entry)

    return PartyMappingTable(entries=tuple(entries))


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
