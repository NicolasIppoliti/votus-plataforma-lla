"""Independent expected membership for CNE Rosales 2025; never polygon assignment.

Verified archived XLSX shape: 11 headers, Distrito='BUENOS AIRES', Secc.Elect.='2_027',
31 inclusive Desde/Hasta ranges totaling 153 mesas. Circuit strings are zero-stripped
and may carry suffixes; unsuffixed 0248 remains its own circuit. The reference has
10 reviewed identities, not an election-wide or historical membership catalogue.
Structural ambiguity refuses the run; readable conflicting mesas survive in quarantine.
"""

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import psycopg

from .admin_codes import normalize_circuito_code
from .cne_rosales_reference import (
    HEADER,
    LOCALES_ID,
    TERRITORY,
    Refusal,
    integer,
    read_original,
    sheet_rows,
)

# Reviewed reference identities; recognition is independent of observed result mesas.
CIRCUITS = frozenset({"00248", "00249", *[f"0248{x}" for x in "ABCDEF"], "0249A", "0249B"})
REASONS = (
    "xlsx_mesa_not_in_catalogue",
    "catalogue_mesa_not_covered",
    "unrecognized_xlsx_circuit",
    "xlsx_status_circuit_mismatch",
    "overlapping_or_duplicate_ranges",
)


def reconcile(payload, catalogue, status_circuits):
    """Reconcile every readable mesa, retaining every reason; never choose a range."""
    rows = sheet_rows(payload)
    if not rows or tuple(rows[0][: len(HEADER)]) != HEADER or any(rows[0][len(HEADER) :]):
        raise Refusal("unexpected_header", LOCALES_ID)
    candidates = defaultdict(list)
    for index, row in enumerate(rows[1:], start=2):
        if any(row[len(HEADER) :]):
            raise Refusal("unexpected_header", LOCALES_ID)
        values = dict(zip(HEADER, row))
        if (values["Distrito"], values["Secc.Elect."]) != TERRITORY["locales"]:
            raise Refusal("unexpected_territory", LOCALES_ID)
        count, first, last = (integer(values[k]) for k in ("Cant.Mesas", "Desde", "Hasta"))
        if first < 1 or count < 1 or last - first + 1 != count or last > 100000:
            raise Refusal("mesa_count_mismatch", LOCALES_ID)
        raw = values["Circ.Elect."]
        canonical = normalize_circuito_code(raw) if raw else None
        for mesa in range(first, last + 1):
            candidates[mesa].append(
                {
                    "mesa_code": mesa,
                    "circuito_code": canonical,
                    "circuito_raw": raw,
                    "source_row_index": index,
                }
            )
    if not candidates:
        raise Refusal("empty_membership_workbook", LOCALES_ID)
    reasons = Counter({r: 0 for r in REASONS})
    members, quarantines = [], []
    for mesa, choices in sorted(candidates.items()):
        failures = []
        if mesa not in catalogue:
            failures.append("xlsx_mesa_not_in_catalogue")
        if len(choices) != 1:
            failures.append("overlapping_or_duplicate_ranges")
        if any(c["circuito_code"] not in CIRCUITS for c in choices):
            failures.append("unrecognized_xlsx_circuit")
        statuses = {normalize_circuito_code(c) for c in status_circuits.get(mesa, set())}
        if statuses and any(statuses != {c["circuito_code"]} for c in choices):
            failures.append("xlsx_status_circuit_mismatch")
        if failures:
            for reason in failures:
                reasons[reason] += 1
                quarantines.append({"mesa_code": mesa, "reason": reason})
        else:
            members.append(choices[0])
    reasons["catalogue_mesa_not_covered"] = len(catalogue - candidates.keys())
    return members, quarantines, dict(reasons)


def read_workbook(manifest, local_root):
    """Honor the global CLI's archive-directory root, not the CNE tool's repo root.

    Validate the manifest path before calling the existing checksum verifier, so an
    untrusted archive record cannot point the reader outside the geography mirror.
    """
    root = Path(local_root)
    records = [
        r
        for r in manifest.get("records", [])
        if r.get("id") == LOCALES_ID and r.get("status") == "ok"
    ]
    if records:
        relative = records[-1].get("archived_path")
        if not isinstance(relative, str):
            raise Refusal("missing_source", LOCALES_ID)
        path = Path(relative)
        if path.parts != (root.name, "geography", path.name):
            raise Refusal("archived_path_mismatch", LOCALES_ID)
        target = root / "geography" / path.name
        if not target.resolve().is_relative_to(root.resolve()):
            raise Refusal("archived_path_mismatch", LOCALES_ID)
    return read_original(manifest, root.parent, LOCALES_ID)


def run(args):
    """Checksum first, then reconcile and replace archive+election in one transaction."""
    try:
        manifest = json.loads(Path(args.manifest_path).read_text(encoding="utf-8"))
        payload, evidence = read_workbook(manifest, args.local_root)
        with psycopg.connect(args.database_url) as conn:
            with conn.cursor() as cur:
                # A consistent snapshot prevents reconciliation across two ingests.
                cur.execute("set transaction isolation level repeatable read")
                cur.execute(
                    "select pg_advisory_xact_lock(hashtextextended(%s,0))",
                    (str(args.election_id),),
                )
                cur.execute(
                    "select year,round from public.election where id=%s", (args.election_id,)
                )
                if cur.fetchone() != (2025, "legislativas"):
                    raise Refusal("requires_2025_legislativas_election", LOCALES_ID)
                cur.execute(
                    "select mesa_code from public.official_expected_mesa"
                    " where election_id=%s and distrito_code='02' and seccion_code='027'",
                    (args.election_id,),
                )
                catalogue = {row[0] for row in cur.fetchall()}
                if not catalogue:
                    raise Refusal("missing_persisted_catalogue", LOCALES_ID)
                cur.execute(
                    "select mesa_code,circuito_code from public.official_mesa_count_status"
                    " where election_id=%s and distrito_code='02' and seccion_code='027'",
                    (args.election_id,),
                )
                statuses = defaultdict(set)
                for mesa, circuit in cur.fetchall():
                    statuses[mesa].add(circuit)
                members, quarantines, reasons = reconcile(payload, catalogue, statuses)
                for table in (
                    "official_mesa_circuit_membership",
                    "official_mesa_circuit_membership_quarantine",
                ):
                    cur.execute(
                        f"delete from public.{table} where archive_entry_id=%s and election_id=%s",
                        (LOCALES_ID, args.election_id),
                    )
                cur.executemany(
                    "insert into public.official_mesa_circuit_membership"
                    " (election_id,archive_entry_id,distrito_code,seccion_code,circuito_code,"
                    "circuito_raw,mesa_code,source_row_index)"
                    " values(%s,%s,'02','027',%s,%s,%s,%s)",
                    [
                        (
                            args.election_id,
                            LOCALES_ID,
                            m["circuito_code"],
                            m["circuito_raw"],
                            m["mesa_code"],
                            m["source_row_index"],
                        )
                        for m in members
                    ],
                )
                cur.executemany(
                    "insert into public.official_mesa_circuit_membership_quarantine"
                    " (election_id,archive_entry_id,distrito_code,seccion_code,mesa_code,reason)"
                    " values(%s,%s,'02','027',%s,%s)",
                    [
                        (args.election_id, LOCALES_ID, q["mesa_code"], q["reason"])
                        for q in quarantines
                    ],
                )
        report = {
            "archive_entry_id": LOCALES_ID,
            "election_id": str(args.election_id),
            "expected": len(catalogue),
            "persisted": len(members),
            "quarantined_mesas": len({q["mesa_code"] for q in quarantines}),
            "reasons": reasons,
            "source": evidence,
        }
        print(json.dumps(report, sort_keys=True), file=sys.stderr)
        return 0
    except Refusal as exc:
        print(json.dumps({"error": exc.reason, "source": exc.source}), file=sys.stderr)
        return 1
