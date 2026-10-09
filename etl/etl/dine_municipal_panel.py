"""Stream a DINE results inventory; no vote or mesa aggregation."""
from __future__ import annotations

import argparse
from collections import Counter
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


def column_name(value):
    return value.strip().lower().replace("año", "ano")


def inventory(args):
    digest = hashlib.sha256()
    archive_bytes = 0
    with args.archive.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
            archive_bytes += len(chunk)
    sha256 = digest.hexdigest()
    if sha256 != args.expected_sha256:
        raise ValueError(f"archive sha256 mismatch: expected {args.expected_sha256} got {sha256}")
    distrito = normalize_distrito_code(args.distrito)
    seccion = normalize_seccion_code(args.seccion)
    categories = {}
    mesas = {}
    wrong_years = Counter()
    total = selected = 0
    with zipfile.ZipFile(args.archive) as archive:
        matches = []
        for member in archive.infolist():
            if not member.filename.lower().endswith(".csv"):
                continue
            # Decode only the first physical line: invalid data later in a
            # member must not affect header-based member selection.
            with archive.open(member) as source:
                first = source.readline().decode("utf-8", errors="strict").removeprefix("\ufeff")
            header = next(csv.reader([first]), [])
            if REQUIRED <= {column_name(name) for name in header}:
                matches.append((member, header))
        if len(matches) != 1:
            names = [member.filename for member, _ in matches]
            raise ValueError(f"expected exactly one results member, found {len(matches)}: {names}")
        member, header = matches[0]
        columns = {column_name(name): name for name in header}
        with archive.open(member) as source:
            with io.TextIOWrapper(source, encoding="utf-8", errors="strict", newline="") as text:
                text.readline()  # Header already parsed, with any BOM removed.
                reader = csv.DictReader(text, fieldnames=header)
                for row in reader:
                    total += 1
                    value = row[columns["ano"]].strip()
                    if value != str(args.year):
                        wrong_years[value] += 1
                    row_distrito = normalize_distrito_code(row[columns["distrito_id"]])
                    row_seccion = normalize_seccion_code(row[columns["seccion_id"]])
                    if (row_distrito, row_seccion) != (distrito, seccion):
                        continue
                    selected += 1
                    cargo = row[columns["cargo_nombre"]].strip()
                    tipo = row[columns["mesa_tipo"]].rstrip()
                    votos = row[columns["votos_tipo"]].rstrip()
                    if cargo not in categories:
                        categories[cargo] = {"rows": 0, "mesa_tipo": Counter(), "votos_tipo": Counter()}
                        mesas[cargo] = set()
                    category = categories[cargo]
                    category["rows"] += 1
                    category["mesa_tipo"][tipo] += 1
                    category["votos_tipo"][votos] += 1
                    mesas[cargo].add((normalize_circuito_code(row[columns["circuito_id"]]),
                                      row[columns["mesa_id"]].strip(), tipo.strip()))
        if wrong_years:
            counts = json.dumps(wrong_years, sort_keys=True, ensure_ascii=False)
            raise ValueError(f"row year mismatch: expected {args.year}, counts {counts}")
        for cargo, category in categories.items():
            category["distinct_mesas"] = len(mesas[cargo])
        return {
            "schema_version": 1,
            "source": {"archive_sha256": sha256, "archive_bytes": archive_bytes,
                       "member": member.filename, "member_bytes": member.file_size, "header": header},
            "year": args.year, "distrito": distrito, "seccion": seccion,
            "total_rows": total, "selected_rows": selected, "categories": categories,
            "excluded_rows_by_reason": {"other_jurisdiction": total - selected},
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    command = commands.add_parser("inventory", help="Inventory a verified DINE ZIP without extraction")
    command.add_argument("--archive", type=Path, required=True)
    command.add_argument("--expected-sha256", required=True)
    command.add_argument("--year", type=int, required=True)
    command.add_argument("--distrito", required=True)
    command.add_argument("--seccion", required=True)
    args = parser.parse_args()
    try:
        result = inventory(args)
    except UnicodeDecodeError as error:
        # TextIOWrapper's decoder reports a byte offset within its current
        # decode buffer, not necessarily an absolute offset in the member.
        print(f"error: results member is not valid UTF-8 at byte offset {error.start}", file=sys.stderr)
        return 2
    except (ValueError, OSError, zipfile.BadZipFile, csv.Error) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
