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
class CanonicalPartyDeclaration:
    """One explicit canonical party parent persisted to `party_canonical`."""

    id: str
    display_name: str


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
    canonical_parties: tuple[CanonicalPartyDeclaration, ...]
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


_TOP_LEVEL_FIELDS = frozenset({"canonical_parties", "mappings"})
_CANONICAL_PARTY_FIELDS = frozenset({"id", "display_name"})
_MAPPING_REQUIRED_FIELDS = (
    "year",
    "jurisdiction",
    "category",
    "list_id",
    "canonical_party",
    "party_name",
)
_MAPPING_FIELDS = frozenset({*_MAPPING_REQUIRED_FIELDS, "source", "verified"})


def _reject_unknown_fields(
    raw: Mapping[object, object], *, allowed: frozenset[str], context: str
) -> None:
    unknown = [
        key if isinstance(key, str) else f"<non-string {type(key).__name__}>"
        for key in raw
        if key not in allowed
    ]
    if unknown:
        raise PartyMapValidationError(
            f"party_map.yaml {context} has unknown field(s): {', '.join(sorted(unknown))}"
        )


def _required_text(
    raw: Mapping[object, object],
    *,
    field: str,
    context: str,
    reject_surrounding_whitespace: bool,
) -> str:
    value = raw[field]
    if not isinstance(value, str) or not value.strip():
        raise PartyMapValidationError(
            f"party_map.yaml {context} {field} must be a non-empty string"
        )
    if reject_surrounding_whitespace and value != value.strip():
        raise PartyMapValidationError(
            f"party_map.yaml {context} {field} must not have surrounding whitespace"
        )
    return value


def load_party_map(path: Path) -> PartyMappingTable:
    """Load and validate the closed canonical-parent/mapping-child YAML shape."""
    data: object = yaml.safe_load(path.read_text(encoding="utf-8"))
    if data is None:
        data = {}
    if not isinstance(data, Mapping):
        raise PartyMapValidationError("party_map.yaml top level must be a mapping")

    missing_sections = [field for field in _TOP_LEVEL_FIELDS if field not in data]
    if missing_sections:
        raise PartyMapValidationError(
            "party_map.yaml is missing required top-level field(s): "
            + ", ".join(sorted(missing_sections))
        )
    _reject_unknown_fields(data, allowed=_TOP_LEVEL_FIELDS, context="top level")

    raw_canonical_parties = data["canonical_parties"]
    if not isinstance(raw_canonical_parties, list):
        raise PartyMapValidationError("party_map.yaml canonical_parties must be a list")
    raw_entries = data["mappings"]
    if not isinstance(raw_entries, list):
        raise PartyMapValidationError("party_map.yaml mappings must be a list")

    canonical_parties: list[CanonicalPartyDeclaration] = []
    display_name_by_id: dict[str, str] = {}
    for index, raw_declaration in enumerate(raw_canonical_parties):
        context = f"canonical_parties entry {index}"
        if not isinstance(raw_declaration, Mapping):
            raise PartyMapValidationError(f"party_map.yaml {context} must be a mapping")
        _reject_unknown_fields(
            raw_declaration,
            allowed=_CANONICAL_PARTY_FIELDS,
            context=context,
        )
        missing = [field for field in _CANONICAL_PARTY_FIELDS if field not in raw_declaration]
        if missing:
            raise PartyMapValidationError(
                f"party_map.yaml {context} is missing {', '.join(sorted(missing))}"
            )

        canonical_id = _required_text(
            raw_declaration,
            field="id",
            context=context,
            reject_surrounding_whitespace=True,
        )
        display_name = _required_text(
            raw_declaration,
            field="display_name",
            context=context,
            reject_surrounding_whitespace=True,
        )
        previous_display_name = display_name_by_id.get(canonical_id)
        if previous_display_name is not None:
            if previous_display_name == display_name:
                raise PartyMapValidationError(
                    f"party_map.yaml duplicate canonical party id {canonical_id!r} at entry {index}"
                )
            raise PartyMapValidationError(
                "party_map.yaml conflicting canonical party declaration for id "
                f"{canonical_id!r} at entry {index}"
            )
        display_name_by_id[canonical_id] = display_name
        canonical_parties.append(
            CanonicalPartyDeclaration(id=canonical_id, display_name=display_name)
        )

    entries: list[PartyMappingEntry] = []
    seen_keys: set[tuple[int, str, str, str]] = set()
    used_canonical_parties: set[str] = set()
    for index, raw_entry in enumerate(raw_entries):
        context = f"mappings entry {index}"
        if not isinstance(raw_entry, Mapping):
            raise PartyMapValidationError(f"party_map.yaml {context} must be a mapping")
        _reject_unknown_fields(raw_entry, allowed=_MAPPING_FIELDS, context=context)
        missing = [field for field in _MAPPING_REQUIRED_FIELDS if field not in raw_entry]
        if missing:
            raise PartyMapValidationError(
                f"party_map.yaml {context} is missing {', '.join(missing)}"
            )

        year = raw_entry["year"]
        if isinstance(year, bool) or not isinstance(year, int):
            raise PartyMapValidationError(f"party_map.yaml {context} year must be an integer")

        strings: dict[str, str] = {}
        for field in _MAPPING_REQUIRED_FIELDS[1:]:
            strings[field] = _required_text(
                raw_entry,
                field=field,
                context=context,
                reject_surrounding_whitespace=True,
            )

        source = raw_entry.get("source")
        if source is not None and not isinstance(source, str):
            raise PartyMapValidationError(
                f"party_map.yaml {context} source must be a string or null"
            )
        verified = raw_entry.get("verified", True)
        if not isinstance(verified, bool):
            raise PartyMapValidationError(f"party_map.yaml {context} verified must be a boolean")

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
        if entry.canonical_party not in display_name_by_id:
            raise PartyMapValidationError(
                f"party_map.yaml {context} canonical_party {entry.canonical_party!r} "
                "is not declared in canonical_parties"
            )
        key = (entry.year, entry.jurisdiction, entry.category, entry.list_id)
        if key in seen_keys:
            raise DuplicatePartyMappingKeyError(
                f"party_map.yaml duplicate mapping key {key!r} at entry {index}"
            )
        seen_keys.add(key)
        used_canonical_parties.add(entry.canonical_party)
        entries.append(entry)

    unused = [
        declaration.id
        for declaration in canonical_parties
        if declaration.id not in used_canonical_parties
    ]
    if unused:
        raise PartyMapValidationError(
            "party_map.yaml canonical party declaration(s) not used by any mapping: "
            + ", ".join(unused)
        )

    return PartyMappingTable(
        canonical_parties=tuple(canonical_parties),
        entries=tuple(entries),
    )


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
