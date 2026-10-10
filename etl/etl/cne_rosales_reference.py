"""Slice 11 CNE Rosales 2025 reference: validate the archived voting-locations
workbook and circuit geometries before anything is derived from them.

Both originals are read through their `archive-manifest.json` records: the file
must exist at the recorded content-addressed path and its bytes must match the
recorded SHA-256. Structural problems refuse the whole run with one reason; a
locale without coordinates is kept and reported as not plotted. Nothing is
assigned, repaired or inferred: circuit codes are joined only through the shared
`circuito_identity_key` boundary, and workbook metadata is never read.
"""

import hashlib
import io
import json
import math
import os
import re
import sys
import tempfile
import zipfile
from argparse import ArgumentParser
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from etl.admin_codes import circuito_identity_key

LOCALES_ID = "geography/cne-rosales-2025-locales"
CIRCUITS_ID = "geography/cne-rosales-2025-supplied-geojson"
HEADER = (
    "Distrito",
    "Secc.Elect.",
    "Circ.Elect.",
    "Descripción",
    "Dirección",
    "Localidad",
    "Cant.Mesas",
    "Desde",
    "Hasta",
    "Latitud",
    "Longitud",
)
TERRITORY = {"locales": ("BUENOS AIRES", "2_027"), "circuits": ("02", "027")}
CIRCUIT_CODE = re.compile(r"^\d{1,4}[A-Z]?$")
SHEET = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
ARTIFACT_STEM = "cne-rosales-2025-reference"
# Stable codes the web maps to copy. The overlap is known from Slice 2 and the
# workbook names `0248` without a B/C suffix; neither is repaired here.
CAVEATS = [
    "cne_reference_not_official_results",
    "not_valid_for_historical_elections",
    "circuits_0248B_0248C_overlap",
    "locales_in_0248_not_assigned_to_sub_circuits",
]


class Refusal(Exception):
    def __init__(self, reason, source):
        super().__init__(reason)
        self.reason, self.source = reason, source


def read_original(manifest, root, source_id):
    records = [
        r
        for r in manifest.get("records", [])
        if r.get("id") == source_id and r.get("status") == "ok"
    ]
    if not records:
        raise Refusal("missing_manifest_record", source_id)
    record = records[-1]
    if not isinstance(record.get("sha256"), str):
        raise Refusal("missing_checksum", source_id)
    if not isinstance(record.get("archived_path"), str):
        raise Refusal("missing_source", source_id)
    path = Path(root) / record["archived_path"]
    if not path.is_file():
        raise Refusal("missing_source", source_id)
    payload = path.read_bytes()
    digest = hashlib.sha256(payload).hexdigest()
    if digest != record["sha256"] or f".{digest}." not in path.name:
        raise Refusal("checksum_mismatch", source_id)
    return payload, {"archived_path": record["archived_path"], "sha256": digest}


def sheet_rows(payload):
    """Return the first worksheet as lists of cell text (None for empty cells)."""
    try:
        with zipfile.ZipFile(io.BytesIO(payload)) as workbook:
            strings = [
                "".join(t.text or "" for t in item.iter(SHEET + "t"))
                for item in ElementTree.fromstring(workbook.read("xl/sharedStrings.xml"))
            ]
            sheet = ElementTree.fromstring(workbook.read("xl/worksheets/sheet1.xml"))
    except (zipfile.BadZipFile, KeyError, ElementTree.ParseError):
        raise Refusal("unreadable_workbook", LOCALES_ID) from None
    rows = []
    for row in sheet.iter(SHEET + "row"):
        cells = {}
        for cell in row.iter(SHEET + "c"):
            letters = re.match(r"[A-Z]+", cell.get("r", ""))
            value = cell.find(SHEET + "v")
            if letters is None:
                raise Refusal("unreadable_workbook", LOCALES_ID)
            if value is not None and value.text is not None:
                text = strings[int(value.text)] if cell.get("t") == "s" else value.text
                index = 0
                for letter in letters.group():
                    index = index * 26 + ord(letter) - ord("A") + 1
                cells[index - 1] = text.strip() or None
        rows.append([cells.get(i) for i in range(max(len(HEADER), max(cells, default=-1) + 1))])
    return rows


def integer(text):
    if text is None or not re.fullmatch(r"\d+", text):
        raise Refusal("invalid_mesa_number", LOCALES_ID)
    return int(text)


def coordinates(latitude, longitude):
    if latitude is None and longitude is None:
        return None
    if latitude is None or longitude is None:
        raise Refusal("partial_coordinates", LOCALES_ID)
    try:
        lat, lon = float(latitude), float(longitude)
    except ValueError:
        raise Refusal("invalid_coordinates", LOCALES_ID) from None
    if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
        raise Refusal("invalid_coordinates", LOCALES_ID)
    return [lon, lat]


def parse_circuits(payload):
    try:
        collection = json.loads(payload)
        features = collection["features"]
    except (ValueError, KeyError, TypeError):
        raise Refusal("invalid_geometry", CIRCUITS_ID) from None
    circuits = {}
    for feature in features:
        properties, geometry = feature.get("properties") or {}, feature.get("geometry") or {}
        if (properties.get("INDRA_P"), properties.get("INDRA_D")) != TERRITORY["circuits"]:
            raise Refusal("unexpected_territory", CIRCUITS_ID)
        code = properties.get("CIRCUITO")
        identity = circuito_identity_key(code)
        if not isinstance(code, str) or not CIRCUIT_CODE.match(code) or identity is None:
            raise Refusal("invalid_circuit_code", CIRCUITS_ID)
        if identity in circuits:
            raise Refusal("duplicate_circuit", CIRCUITS_ID)
        if geometry.get("type") != "MultiPolygon" or not valid_rings(geometry.get("coordinates")):
            raise Refusal("invalid_geometry", CIRCUITS_ID)
        circuits[identity] = {"code": code, "coordinates": geometry["coordinates"]}
    if not circuits:
        raise Refusal("invalid_geometry", CIRCUITS_ID)
    return circuits


def valid_rings(polygons):
    try:
        return (
            all(
                len(ring) >= 4
                and ring[0] == ring[-1]
                and all(
                    len(point) == 2
                    and all(isinstance(v, (int, float)) and math.isfinite(v) for v in point)
                    and -180 <= point[0] <= 180
                    and -90 <= point[1] <= 90
                    for point in ring
                )
                for polygon in polygons
                for ring in polygon
            )
            and bool(polygons)
            and all(polygons)
        )
    except TypeError:
        return False


def parse_locales(payload, circuits):
    rows = sheet_rows(payload)
    if not rows or tuple(rows[0][: len(HEADER)]) != HEADER or any(rows[0][len(HEADER) :]):
        raise Refusal("unexpected_header", LOCALES_ID)
    locales = []
    for row in rows[1:]:
        if any(row[len(HEADER) :]):
            raise Refusal("unexpected_header", LOCALES_ID)
        values = dict(zip(HEADER, row))
        if (values["Distrito"], values["Secc.Elect."]) != TERRITORY["locales"]:
            raise Refusal("unexpected_territory", LOCALES_ID)
        code = values["Circ.Elect."]
        if code is None or not CIRCUIT_CODE.match(code):
            raise Refusal("invalid_circuit_code", LOCALES_ID)
        identity = circuito_identity_key(code)
        if identity not in circuits:
            raise Refusal("unknown_circuit", LOCALES_ID)
        count, first, last = (integer(values[k]) for k in ("Cant.Mesas", "Desde", "Hasta"))
        if count < 1 or last - first + 1 != count:
            raise Refusal("mesa_count_mismatch", LOCALES_ID)
        locales.append(
            {
                "circuit": circuits[identity]["code"],
                "name": values["Descripción"],
                "address": values["Dirección"],
                "locality": values["Localidad"],
                "mesa_count": count,
                "mesa_from": first,
                "mesa_to": last,
                "coordinates": coordinates(values["Latitud"], values["Longitud"]),
            }
        )
    expected = 1
    for locale in sorted(locales, key=lambda item: item["mesa_from"]):
        if locale["mesa_from"] != expected:
            raise Refusal("mesa_ranges_not_contiguous", LOCALES_ID)
        expected = locale["mesa_to"] + 1
    if not locales:
        raise Refusal("unexpected_header", LOCALES_ID)
    return locales


def validate(manifest_path, root):
    manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    locales_payload, locales_source = read_original(manifest, root, LOCALES_ID)
    circuits_payload, circuits_source = read_original(manifest, root, CIRCUITS_ID)
    circuits = parse_circuits(circuits_payload)
    locales = parse_locales(locales_payload, circuits)
    plotted = [locale["coordinates"] for locale in locales if locale["coordinates"]]
    not_plotted = Counter("missing_coordinates" for locale in locales if not locale["coordinates"])
    report = {
        "counts": {
            "circuits": len(circuits),
            "locales": len(locales),
            "plotted_locales": len(plotted),
            "unique_coordinate_pairs": len({tuple(pair) for pair in plotted}),
            "mesas": sum(locale["mesa_count"] for locale in locales),
        },
        "mesa_range": {"first": 1, "last": max(locale["mesa_to"] for locale in locales)},
        "exclusions": {"not_plotted": dict(sorted(not_plotted.items()))},
        "sources": {LOCALES_ID: locales_source, CIRCUITS_ID: circuits_source},
    }
    return report, circuits, locales


def artifact(report, circuits, locales):
    return {
        "schema_version": 1,
        "reference_only": True,
        "caveats": CAVEATS,
        "counts": report["counts"],
        "mesa_range": report["mesa_range"],
        "exclusions": report["exclusions"],
        "sources": report["sources"],
        "provenance": {"generator": "etl/etl/cne_rosales_reference.py"},
        "circuits": [
            {"code": circuit["code"], "coordinates": circuit["coordinates"]}
            for circuit in sorted(circuits.values(), key=lambda item: item["code"])
        ],
        "locales": [locale for locale in sorted(locales, key=lambda item: item["mesa_from"])],
    }


def write(document, output_dir):
    data = json.dumps(document, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    payload = data.encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()
    filename = f"{ARTIFACT_STEM}.{digest}.json"
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    # Publish atomically: a reader sees either no artifact or the complete bytes.
    handle, temporary = tempfile.mkstemp(dir=output_dir, prefix=f".{ARTIFACT_STEM}-")
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(payload)
        os.chmod(temporary, 0o644)
        os.replace(temporary, Path(output_dir) / filename)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise
    return {"filename": filename, "sha256": digest, "bytes": len(payload)}


def main():
    parser = ArgumentParser(description="Validate the CNE Rosales 2025 reference originals")
    commands = parser.add_subparsers(dest="command", required=True)
    check = commands.add_parser("check", help="Validate both archived originals and report.")
    build = commands.add_parser("build", help="Validate, then write the web reference artifact.")
    for command in (check, build):
        command.add_argument("--manifest", type=Path, required=True)
        command.add_argument("--root", type=Path, required=True)
    build.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        report, circuits, locales = validate(args.manifest, args.root)
    except Refusal as refusal:
        print(json.dumps({"error": refusal.reason, "source": refusal.source}, sort_keys=True))
        return 1
    if args.command == "check":
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
        return 0
    try:
        meta = write(artifact(report, circuits, locales), args.output_dir)
    except OSError as error:
        detail = error.strerror or str(error)
        print(json.dumps({"error": "publication_failed", "detail": detail}, sort_keys=True))
        return 2
    print(json.dumps(meta, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
