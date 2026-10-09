"""Stream verified DINE inventories and single-cargo mesa aggregates.

Absent vote types are zero only for present, non-quarantined mesas; no
missing mesa is synthesized. Alias counts cover valid selected rows.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import csv
import hashlib
import io
import json
from pathlib import Path
import sys
import zipfile

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from etl.admin_codes import (
    normalize_circuito_code, normalize_distrito_code, normalize_seccion_code,
)

REQUIRED = {"ano", "distrito_id", "seccion_id", "circuito_id", "mesa_id",
            "mesa_tipo", "mesa_electores", "cargo_nombre", "agrupacion_id",
            "agrupacion_nombre", "votos_tipo", "votos_cantidad"}
MESA_ALIASES = {"NATIVO": "NATIVOS", "NATIVOS": "NATIVOS",
                "EXTRANJERO": "EXTRANJEROS", "EXTRANJEROS": "EXTRANJEROS"}
VOTE_ALIASES = {"POSITIVO": "positivo", "EN BLANCO": "blancos", "BLANCOS": "blancos",
                "NULO": "nulos", "NULOS": "nulos", "IMPUGNADO": "impugnados",
                "IMPUGNADOS": "impugnados", "RECURRIDO": "recurridos",
                "RECURRIDOS": "recurridos", "COMANDO": "comando"}
ROW_REASONS = ("short_row", "unknown_mesa_tipo", "unknown_votos_tipo",
               "non_integer_votes", "non_integer_electores", "positive_without_agrupacion",
               "other_jurisdiction", "other_cargo")
MESA_REASONS = ("conflicting_electores", "duplicate_tally",
                "conflicting_agrupacion_name", "multiple_lists_per_agrupacion")


def column_name(value):
    return value.strip().lower().replace("año", "ano")


def results_rows(args, metadata):
    """Shared hash verification, member selection and strict streaming decode."""
    digest = hashlib.sha256()
    archive_bytes = 0
    with args.archive.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
            archive_bytes += len(chunk)
    sha256 = digest.hexdigest()
    if sha256 != args.expected_sha256:
        raise ValueError(f"archive sha256 mismatch: expected {args.expected_sha256} got {sha256}")
    wrong_years = Counter()
    with zipfile.ZipFile(args.archive) as archive:
        matches = []
        for member in archive.infolist():
            if not member.filename.lower().endswith(".csv"):
                continue
            # Inspect only the header, not later data, during member selection.
            with archive.open(member) as source:
                first = source.readline().decode("utf-8", errors="strict").removeprefix("\ufeff")
            header = next(csv.reader([first]), [])
            if REQUIRED <= {column_name(name) for name in header}:
                matches.append((member, header))
        if len(matches) != 1:
            names = [member.filename for member, _ in matches]
            raise ValueError(f"expected exactly one results member, found {len(matches)}: {names}")
        member, header = matches[0]
        metadata.update(archive_sha256=sha256, archive_bytes=archive_bytes,
                        member=member.filename, member_bytes=member.file_size, header=header)
        with archive.open(member) as source:
            with io.TextIOWrapper(source, encoding="utf-8", errors="strict", newline="") as text:
                text.readline()
                for raw in csv.DictReader(text, fieldnames=header):
                    row = {column_name(k): v for k, v in raw.items() if k is not None}
                    value = row["ano"]
                    if value is not None and value.strip() != str(args.year):
                        wrong_years[value.strip()] += 1
                    yield None if None in raw or None in row.values() else row
        if wrong_years:
            counts = json.dumps(wrong_years, sort_keys=True, ensure_ascii=False)
            raise ValueError(f"row year mismatch: expected {args.year}, counts {counts}")


def jurisdiction(row):
    return (normalize_distrito_code(row["distrito_id"]),
            normalize_seccion_code(row["seccion_id"]))


def base_result(args):
    return {"schema_version": 1, "source": {}, "year": args.year,
            "distrito": normalize_distrito_code(args.distrito),
            "seccion": normalize_seccion_code(args.seccion)}


def inventory(args):
    result = base_result(args)
    categories, mesas = {}, {}
    total = selected = 0
    for row in results_rows(args, result["source"]):
        total += 1
        if row is None:
            raise ValueError("malformed results row")
        if jurisdiction(row) != (result["distrito"], result["seccion"]):
            continue
        selected += 1
        cargo = row["cargo_nombre"].strip()
        tipo, votos = row["mesa_tipo"].rstrip(), row["votos_tipo"].rstrip()
        if cargo not in categories:
            categories[cargo] = {"rows": 0, "mesa_tipo": Counter(), "votos_tipo": Counter()}
            mesas[cargo] = set()
        category = categories[cargo]
        category["rows"] += 1
        category["mesa_tipo"][tipo] += 1
        category["votos_tipo"][votos] += 1
        mesas[cargo].add((normalize_circuito_code(row["circuito_id"]),
                          row["mesa_id"].strip(), tipo.strip()))
    for cargo, category in categories.items():
        category["distinct_mesas"] = len(mesas[cargo])
    result.update(total_rows=total, selected_rows=selected, categories=categories,
                  excluded_rows_by_reason={"other_jurisdiction": total - selected})
    return result


def empty_votes():
    return dict.fromkeys(VOTE_ALIASES.values(), 0)


def mesas(args):
    # Reason counts are per reason, not per distinct row or mesa: one row or
    # mesa failing several checks increments each matching reason, so the sum
    # of a breakdown can exceed the number of excluded rows or quarantined mesas.
    result = base_result(args)
    excluded = dict.fromkeys(ROW_REASONS, 0)
    counts = dict.fromkeys(MESA_REASONS, 0)
    records, reasons, seen = {}, defaultdict(set), defaultdict(set)
    names, lists, party_mesas = defaultdict(set), defaultdict(set), defaultdict(set)
    aliases = defaultdict(Counter)
    for row in results_rows(args, result["source"]):
        if row is None:
            excluded["short_row"] += 1
            continue
        if jurisdiction(row) != (result["distrito"], result["seccion"]):
            excluded["other_jurisdiction"] += 1
            continue
        row = {k: v.strip() for k, v in row.items()}
        if row["cargo_nombre"] != args.cargo.strip():
            excluded["other_cargo"] += 1
            continue
        tipo = MESA_ALIASES.get(row["mesa_tipo"])
        vote = VOTE_ALIASES.get(row["votos_tipo"])
        party = row["agrupacion_id"]
        failures = []
        if tipo is None:
            failures.append("unknown_mesa_tipo")
        if vote is None:
            failures.append("unknown_votos_tipo")
        for field, reason in (("votos_cantidad", "non_integer_votes"),
                              ("mesa_electores", "non_integer_electores")):
            if not row[field].isascii() or not row[field].isdigit():
                failures.append(reason)
        if vote == "positivo" and not party:
            failures.append("positive_without_agrupacion")
        if failures:
            for reason in failures:
                excluded[reason] += 1
            continue
        aliases[row["mesa_tipo"]][tipo] += 1
        aliases[row["votos_tipo"]][vote] += 1
        key = (normalize_circuito_code(row["circuito_id"]), row["mesa_id"], tipo)
        electores, quantity = int(row["mesa_electores"]), int(row["votos_cantidad"])
        record = records.setdefault(key, dict(circuito=key[0], mesa=key[1], mesa_tipo=tipo,
                                              electores=electores, votes=empty_votes(),
                                              positive={}, source_rows=0))
        record["source_rows"] += 1
        if record["electores"] != electores:
            reasons[key].add("conflicting_electores")
        tally = (vote, party if vote == "positivo" else "")
        if tally in seen[key]:
            reasons[key].add("duplicate_tally")
        seen[key].add(tally)
        record["votes"][vote] += quantity
        if party:
            names[party].add(row["agrupacion_nombre"])
            party_mesas[party].add(key)
            if row.get("lista_numero"):
                lists[party].add(row["lista_numero"])
        if vote == "positivo":
            record["positive"][party] = {"name": row["agrupacion_nombre"], "votes": quantity}
    for party, keys in party_mesas.items():
        for reason, values in (("conflicting_agrupacion_name", names[party]),
                               ("multiple_lists_per_agrupacion", lists[party])):
            if len(values) > 1:
                for key in keys:
                    reasons[key].add(reason)
    accepted, quarantined = [], []
    totals = dict(mesas=0, electores=0, votes=empty_votes(), positive={})
    for key, record in sorted(records.items()):
        if reasons[key]:
            quarantined.append(dict(zip(("circuito", "mesa", "mesa_tipo"), key),
                                    reasons=sorted(reasons[key])))
            for reason in reasons[key]:
                counts[reason] += 1
            continue
        accepted.append(record)
        totals["mesas"] += 1
        totals["electores"] += record["electores"]
        for vote, quantity in record["votes"].items():
            totals["votes"][vote] += quantity
        for party, value in record["positive"].items():
            target = totals["positive"].setdefault(party, {"name": value["name"], "votes": 0})
            target["votes"] += value["votes"]
    result.update(cargo=args.cargo.strip(), label_aliases_used=aliases, mesas=accepted,
                  totals=totals, excluded_rows_by_reason=excluded,
                  quarantined_mesas_by_reason=counts, quarantined_mesas=quarantined)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("inventory", "mesas"):
        command = commands.add_parser(name, help="Stream a verified DINE ZIP without extraction")
        command.add_argument("--archive", type=Path, required=True)
        command.add_argument("--expected-sha256", required=True)
        command.add_argument("--year", type=int, required=True)
        command.add_argument("--distrito", required=True)
        command.add_argument("--seccion", required=True)
        if name == "mesas":
            command.add_argument("--cargo", required=True)
    args = parser.parse_args()
    try:
        result = inventory(args) if args.command == "inventory" else mesas(args)
    except UnicodeDecodeError as error:
        # Offset is decoder-buffer-relative, not necessarily member-relative.
        print(f"error: results member is not valid UTF-8 at byte offset {error.start}", file=sys.stderr)
        return 2
    except (ValueError, OSError, zipfile.BadZipFile, csv.Error) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
