"""Read-only municipal report evidence, never an accepted council series.

Only the bounded Lista/Votos/% table and whitelisted numerical labels leave
this module. Candidate and seat-holder sections are not report evidence here.
"""

import io
import json
import logging
import re
from collections import Counter
from pathlib import Path

from pypdf import PdfReader
from pypdf.errors import PyPdfError

from .archive import ArchiveIntegrityError, read_verified_archive, validate_source_pin
from .manifest import (
    DuplicateManifestRecordError,
    MalformedManifestError,
    canonical_record,
    load_manifest,
)
from .review_item import SourceArchiveIdentityConflictError, source_archive_identity
from .storage import LocalArchiveStore, UnsafeArchivePathComponentError

SOURCE_IDS = (
    "pba/2015-resultados-027", "pba/2017-resultados-027", "pba/2019-resultados-027",
    "pba/2021-resultados-027", "pba/2023-resultados-027", "pba/2025-resultados-027",
)
EARLIER_SOURCE_IDS = ("pba/2011-resultados-027", "pba/2013-resultados-027")
INTEGER = r"(?:\d{1,3}(?:\.\d{3})+|\d+)"
LABELS = {
    "positive_votes": r"VOTOS POSITIVOS",
    "blank_votes": r"(?:VOTOS EN BLANCO|VOTO EN BLANCO|EN BLANCO|BLANCO)",
    "null_votes": r"(?:VOTOS NULOS|VOTO NULO|NULOS)",
    "total_votes": r"TOTAL DE VOTOS",
    "total_electors": r"TOTAL DE ELECTORES",
    "total_mesas": r"TOTAL DE MESAS",
}


def _candidate_continuation(first: list[str], second: list[str]) -> int:
    """Bound the 2013 continuation without returning candidate text."""
    full_text, second_text = " ".join(first + second), " ".join(second)
    candidate_start = full_text.find("RESULTARON ELECTOS:")
    if (full_text.count("RESULTARON ELECTOS:") != 1
            or "CONCEJALES TITULARES:" not in full_text[candidate_start:]
            or not second
            or not all(section in second_text for section in (
                "CONCEJALES SUPLENTES:", "CONSEJEROS ESCOLARES TITULARES:",
                "CONSEJEROS ESCOLARES SUPLENTES:"))
            or re.search(r"\d", second_text)
            or re.search(r"\bLISTA\s+VOTOS\s*%", second_text, re.IGNORECASE)
            or "COCIENTE" in second_text
            or any(re.search(rf"\b{label}\b", second_text) for label in LABELS.values())):
        raise EvidenceFailure("pdf_layout_unsupported")
    return len(second)


def extract(data: bytes, *, source_id: str) -> tuple[dict, list[str]]:
    reader = PdfReader(io.BytesIO(data), strict=True)
    page_count = len(reader.pages)
    continuation = page_count == 2 and source_id == "pba/2013-resultados-027"
    # Older accepted reader layouts remain one-page-only. The verified 2013
    # identity may continue candidates on page two, never electoral numbers.
    if page_count != 1 and not continuation:
        raise EvidenceFailure("pdf_layout_unsupported")
    lines = [" ".join(line.split()) for line in reader.pages[0].extract_text().splitlines()]
    excluded_continuation = 0
    if continuation:
        second = [" ".join(line.split()) for line in reader.pages[1].extract_text().splitlines()
                  if line.strip()]
        excluded_continuation = _candidate_continuation(lines, second)
    starts = [i for i, line in enumerate(lines) if line.casefold() == "lista votos %"]
    ends = [i for i, line in enumerate(lines) if line.startswith("VOTOS POSITIVOS")]
    if len(starts) != 1 or not ends or ends[0] <= starts[0]:
        raise EvidenceFailure("pdf_layout_unsupported")
    rows, evidence, uncertainty = [], [], []
    unparsed = 0
    for line in lines[starts[0] + 1:ends[0]]:
        match = re.fullmatch(rf"(\d+)\s*-\s*(.+?) ({INTEGER}) (\d+(?:,\d+)?)", line)
        if not match:
            unparsed += 1
            continue
        list_id, group, votes, percent = match.groups()
        rows.append({"page": 1, "list_id": list_id, "group_name": group,
                     "printed_votes": int(votes.replace(".", "")), "printed_percent": percent})
    if unparsed:
        uncertainty.append("table_rows_unparsed")
    if not rows:
        uncertainty.append("list_table_empty")
    if len({row["list_id"] for row in rows}) != len(rows):
        uncertainty.append("list_id_repeated")
    fields = dict.fromkeys(LABELS)
    quotients = dict.fromkeys(("concejales", "consejeros_escolares"))
    malformed_fields = {}
    for key, label in LABELS.items():
        occurrences = [line for line in lines if re.match(rf"(?:{label})(?: |$)", line)]
        matches = [m for line in occurrences if (m := re.fullmatch(
            rf"({label}) ({INTEGER})(?: \d+(?:,\d+)?)?", line))]
        evidence.extend({"field": key, "page": 1, "label": m[1], "printed_value": m[2]}
                        for m in matches)
        malformed = len(occurrences) - len(matches)
        if malformed:
            malformed_fields[key] = malformed
            uncertainty.append(f"printed_field_malformed:{key}")
        if len(occurrences) == 1 and not malformed:
            fields[key] = int(matches[0][2].replace(".", ""))
        elif len(occurrences) > 1:
            reason = "conflicting" if len({m[2] for m in matches}) > 1 else "repeated"
            uncertainty.append(f"printed_field_{reason}:{key}")
        elif not occurrences:
            uncertainty.append(f"printed_field_missing:{key}")
    for key, label in (("concejales", "CONCEJALES"),
                       ("consejeros_escolares", "CONSEJEROS ESCOLARES")):
        matches = [m[1] for line in lines if (m := re.fullmatch(
            rf"COCIENTE {label} ({INTEGER},\d+)", line))]
        if len(matches) == 1:
            quotients[key] = matches[0]
        else:
            uncertainty.append(f"printed_quotient_{'missing' if not matches else 'repeated'}:{key}")
    extraction = {"page_count": page_count, "fields": fields, "field_evidence": evidence,
                  "printed_quotients": quotients, "list_rows": rows,
                  "unparsed_table_rows": unparsed, "category": None}
    if malformed_fields:
        extraction["malformed_field_counts"] = malformed_fields
    if continuation:
        extraction["exclusions_by_reason"] = {
            "candidate_section_continuation": excluded_continuation,
        }
    return extraction, uncertainty


class EvidenceFailure(Exception):
    """Stable, privacy-safe reason without source text or parser diagnostics."""


def pinned_provenance(entry: dict, record: dict, year: int, *,
                      mime: str = "application/pdf", require_pin: bool = True,
                      legacy_identity: bool = False) -> str:
    """Require registered pins and complete provenance, not legacy fetch defaults."""
    if "expected_sha256" not in entry and require_pin:
        raise EvidenceFailure("registry_pin_missing")
    try:
        validate_source_pin(entry)
    except ArchiveIntegrityError:
        raise EvidenceFailure("registry_pin_malformed") from None
    if ("expected_sha256" in entry
            and record["sha256"].lower() != entry["expected_sha256"].lower()):
        raise EvidenceFailure("archive_pin_mismatch")
    if entry.get("source_kind", "official") != "official":
        raise EvidenceFailure("registry_provenance_mismatch:source_kind")
    try:
        identity = source_archive_identity({**entry, "capability": "pba"})
    except SourceArchiveIdentityConflictError:
        raise EvidenceFailure("registry_identity_malformed") from None
    if identity is None:
        raise EvidenceFailure("registry_identity_malformed")
    if identity.election_year != year:
        raise EvidenceFailure("registry_provenance_mismatch:election_year")
    if entry.get("mime") != mime:
        raise EvidenceFailure("registry_provenance_mismatch:mime")
    expected = {**identity.manifest_fields(), "capability": "pba",
                "source_url": entry["source_url"], "mime": entry["mime"]}
    for field, value in expected.items():
        if (legacy_identity and field not in record
                and field in {"election_year", "election_round", "source_kind"}):
            # The protected stable HTML predates these additive manifest fields.
            # Registry identity is checked, absent historical metadata stays visible.
            continue
        actual = record.get(field)
        if actual is None:
            raise EvidenceFailure(f"manifest_provenance_missing:{field}")
        if (type(actual) is not type(value)
                or isinstance(actual, str) and not actual.strip()):
            raise EvidenceFailure(f"manifest_provenance_malformed:{field}")
        # Only round is normalized by the existing source identity contract.
        if (actual.strip() if field == "election_round" else actual) != value:
            raise EvidenceFailure(f"archive_provenance_mismatch:{field}")
    return identity.source_kind


def verified_data(item: dict, entry: dict, record: dict, store: LocalArchiveStore, *,
                  mime: str = "application/pdf", require_pin: bool = True,
                  legacy_identity: bool = False) -> bytes:
    if record.get("status") != "ok":
        raise EvidenceFailure("manifest_record_non_ok")
    path = record.get("archived_path")
    digest = record.get("sha256")
    if not isinstance(path, str) or not path or not isinstance(digest, str):
        raise EvidenceFailure("manifest_record_malformed")
    if not re.fullmatch(r"[a-fA-F0-9]{64}", digest):
        raise EvidenceFailure("manifest_record_malformed")
    source_kind = pinned_provenance(entry, record, item["year"],
                                   mime=mime, require_pin=require_pin,
                                   legacy_identity=legacy_identity)
    parts = path.split("/")
    if (parts[:-1] not in (["pba"], [store.root.name, "pba"])
            or not parts[-1] or "\\" in path or "\x00" in path
            or any(part in {".", ".."} for part in parts)):
        raise EvidenceFailure("archive_path_unsafe")
    try:
        target = store.path_for("pba", parts[-1])
    except UnsafeArchivePathComponentError:
        raise EvidenceFailure("archive_path_unsafe") from None
    if target.is_symlink() or target.parent.is_symlink():
        raise EvidenceFailure("archive_path_unsafe")
    try:
        data = read_verified_archive(store, capability="pba", filename=parts[-1],
                                     expected_sha256=digest)
    except ArchiveIntegrityError as exc:
        if isinstance(exc.__cause__, FileNotFoundError):
            raise EvidenceFailure("archive_file_missing") from None
        if isinstance(exc.__cause__, OSError):
            raise EvidenceFailure("archive_read_failed") from None
        raise EvidenceFailure("archive_hash_mismatch") from None
    item["digest"]["verified"] = True
    item["source_kind"] = source_kind
    if legacy_identity:
        missing = [field for field in ("election_year", "election_round", "source_kind")
                   if field not in record]
        item["provenance"]["missing_manifest_identity_fields"] = missing
        item["uncertainties"].extend(f"manifest_provenance_missing:{field}" for field in missing)
    return data


def read_evidence(item: dict, entry: dict, record: dict, store: LocalArchiveStore) -> None:
    data = verified_data(item, entry, record, store)
    # pypdf diagnostics may contain source snippets; never surface raw text.
    logger = logging.getLogger("pypdf")
    handlers, propagate = logger.handlers, logger.propagate
    logger.handlers, logger.propagate = [logging.NullHandler()], False
    try:
        item["extraction"], extra = extract(data, source_id=item["source_id"])
    except (PyPdfError, ValueError, TypeError, KeyError, IndexError, RecursionError):
        raise EvidenceFailure("pdf_parse_failed") from None
    finally:
        logger.handlers, logger.propagate = handlers, propagate
    item["uncertainties"].extend(extra)
    item["status"] = "extracted"


def html_evidence(sources: dict, records: list, store: LocalArchiveStore,
                  manifest_failure: str | None) -> list[dict]:
    from .pba_html_evidence import extract as extract_html

    result = []
    for suffix in ("", "-argentinos", "-extranjeros"):
        source_id = f"pba/2025-distrito-027{suffix}"
        entries = [entry for entry in sources.get("pba", []) if entry["id"] == source_id]
        failure = ("registry_source_missing" if not entries else
                   "registry_source_duplicate" if len(entries) > 1 else manifest_failure)
        entry = entries[0] if len(entries) == 1 else {}
        try:
            record = canonical_record(records, source_id)
        except DuplicateManifestRecordError:
            record, failure = None, "manifest_record_duplicate"
        item = {"source_id": source_id, "year": 2025, "round": "unverified",
                "source_kind": None, "status": failure or "manifest_record_missing",
                "provenance": {"registered_url": entry.get("source_url"),
                               "archive_url": record.get("source_url") if record else None,
                               "archived_path": record.get("archived_path") if record else None},
                "digest": {"sha256": record.get("sha256") if record else None,
                           "verified": False},
                "extraction": None, "council_series_accepted": False,
                "uncertainties": ["round_unverified"]}
        if not failure and record is not None:
            try:
                data = verified_data(item, entry, record, store,
                                     mime="text/html", require_pin=bool(suffix),
                                     legacy_identity=not suffix)
                item["extraction"], extra = extract_html(data)
                item["uncertainties"].extend(extra)
                item["status"] = "extracted"
            except EvidenceFailure as exc:
                item["status"] = str(exc)
            except (UnicodeError, ValueError):
                item["status"] = "html_parse_failed"
        result.append(item)
    return result


def reconcile(*, sources: dict, local_root: Path, manifest_path: Path,
              include_html: bool = False, include_earlier: bool = False) -> dict:
    manifest_failure = None
    try:
        records = load_manifest(manifest_path)
    except (MalformedManifestError, json.JSONDecodeError, UnicodeError):
        records, manifest_failure = [], "manifest_malformed"
    except OSError:
        records, manifest_failure = [], "manifest_read_failed"
    result = []
    failures = Counter()
    uncertainties = Counter()
    store = LocalArchiveStore(local_root)
    source_ids = EARLIER_SOURCE_IDS + SOURCE_IDS if include_earlier else SOURCE_IDS
    for source_id in source_ids:
        entries = [e for e in sources.get("pba", []) if e["id"] == source_id]
        registry_failure = ("registry_source_missing" if not entries else
                            "registry_source_duplicate" if len(entries) > 1 else None)
        entry = entries[0] if len(entries) == 1 else {}
        record_failure = registry_failure or manifest_failure
        try:
            record = canonical_record(records, source_id)
        except DuplicateManifestRecordError:
            record, record_failure = None, "manifest_record_duplicate"
        item = {"source_id": source_id, "year": int(source_id.split("/")[1].split("-")[0]),
                "round": "unverified", "source_kind": None,
                "provenance": {"registered_url": entry.get("source_url"),
                               "archive_url": record.get("source_url") if record else None,
                               "archived_path": record.get("archived_path") if record else None},
                "digest": {"sha256": record.get("sha256") if record else None,
                           "verified": False},
                "status": "manifest_record_missing", "extraction": None,
                "council_series_accepted": False,
                "uncertainties": ["round_unverified", "category_unverified"]}
        if record_failure:
            item["status"] = record_failure
        elif record is not None:
            try:
                read_evidence(item, entry, record, store)
            except EvidenceFailure as exc:
                item["status"] = str(exc)
        if source_id == "pba/2025-resultados-027":
            extraction = item["extraction"]
            item["coverage_comparison"] = {
                "pdf_total_mesas": extraction["fields"]["total_mesas"] if extraction else None,
                "previously_documented_html_total_mesas": 156,
                "previously_documented_html_counted_mesas": 156,
                "html_verified_by_command": False, "status": "unresolved",
            }
            item["uncertainties"].append("coverage_discrepancy_unresolved")
        if item["status"] != "extracted":
            failures[item["status"]] += 1
        uncertainties.update(item["uncertainties"])
        result.append(item)
    report = {"schema_version": 1, "read_only": True, "review_required": True,
              "sources": result}
    if include_earlier:
        report["historical_reference_scope"] = {
            "additional_years": [2011, 2013],
            "current_pilot_years": [2015, 2017, 2019, 2021, 2023, 2025],
            "expanded_pilot_review": "pending",
        }
    if include_html:
        from .pba_evidence_reconciliation import compare_evidence

        html = html_evidence(sources, records, store, manifest_failure)
        comparison, suitability = compare_evidence(result, html)
        report.update(html_sources=html, reconciliation=comparison, suitability=suitability)
        coverage = comparison["coverage"]
        result[-1]["coverage_comparison"] = {
            "pdf_total_mesas": coverage["pdf_total_mesas"],
            "html_total_mesas": coverage["html_total_mesas"],
            "html_counted_mesas": coverage["html_counted_mesas"],
            "html_verified_by_command": html[0]["digest"]["verified"],
            "status": coverage["status"], "cause": coverage["cause"],
        }
        result[-1]["uncertainties"].remove("coverage_discrepancy_unresolved")
        if coverage["status"] != "matched":
            result[-1]["uncertainties"].append("coverage_discrepancy_unresolved")
        for item in html:
            if item["status"] != "extracted":
                failures[item["status"]] += 1
        uncertainties = Counter(reason for item in result + html
                                for reason in item["uncertainties"])
    report.update(failure_counts=dict(sorted(failures.items())),
                  uncertainty_counts=dict(sorted(uncertainties.items())))
    return report
