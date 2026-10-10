"""Slice 11 CNE Rosales 2025 reference: validation through the maintainer CLI.

Fixtures mirror the verified shape of the archived originals (fbd5dedd… locales
workbook: one sheet, 11 shared-string headers, zero-stripped circuit codes such as
`248C`, numeric mesa and coordinate cells; aa42a143… GeoJSON: MultiPolygon features
with `CIRCUITO` codes such as `0248C`). The raw originals stay local, so these tests
build small archives of the same shape.
"""

import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

from etl import cne_rosales_reference as cli

HEADER = [
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
]
ROWS = [
    ["BUENOS AIRES", "2_027", "0248", "ESCUELA A", "CALLE 1", "PUNTA ALTA", 4, 1, 4, None, None],
    [
        "BUENOS AIRES",
        "2_027",
        "248C",
        "ESCUELA B",
        "CALLE 2",
        "PUNTA ALTA",
        3,
        5,
        7,
        -38.880471,
        -62.078328999999997,
    ],
    ["BUENOS AIRES", "2_027", "0249", "ESCUELA C", "CALLE 3", "BAJO HONDO", 2, 8, 9, -38.7, -61.9],
]
SQUARE = [[[[-62.1, -38.9], [-62.0, -38.9], [-62.0, -38.8], [-62.1, -38.9]]]]
CIRCUITS = ["0248", "0248C", "0249"]
LOCALES_ID = "geography/cne-rosales-2025-locales"
CIRCUITS_ID = "geography/cne-rosales-2025-supplied-geojson"


def column(index):
    return "ABCDEFGHIJK"[index]


def workbook(rows, header=HEADER):
    strings, cells_xml = [], []
    for r, values in enumerate([header, *rows], start=1):
        cells = []
        for c, value in enumerate(values):
            ref = f"{column(c)}{r}"
            if value is None:
                cells.append(f'<c r="{ref}" s="1"/>')
            elif isinstance(value, str):
                strings.append(value)
                cells.append(f'<c r="{ref}" t="s"><v>{len(strings) - 1}</v></c>')
            else:
                cells.append(f'<c r="{ref}"><v>{value!r}</v></c>')
        cells_xml.append(f'<row r="{r}">{"".join(cells)}</row>')
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    shared = "".join(f"<si><t>{s}</t></si>" for s in strings)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("xl/sharedStrings.xml", f"<sst {ns}>{shared}</sst>")
        archive.writestr(
            "xl/worksheets/sheet1.xml",
            f"<worksheet {ns}><sheetData>{''.join(cells_xml)}</sheetData></worksheet>",
        )
    return buffer.getvalue()


def geojson(codes=CIRCUITS):
    features = [
        {
            "type": "Feature",
            "properties": {"INDRA_P": "02", "INDRA_D": "027", "CIRCUITO": code},
            "geometry": {"type": "MultiPolygon", "coordinates": SQUARE},
        }
        for code in codes
    ]
    return json.dumps({"type": "FeatureCollection", "features": features}).encode()


def archive(root, locales=None, circuits=None):
    """Archive both originals under content-addressed names and record them."""
    records = []
    for source_id, stem, suffix, payload in (
        (LOCALES_ID, "cne-rosales-2025-locales", "xlsx", locales or workbook(ROWS)),
        (CIRCUITS_ID, "cne-rosales-2025-supplied", "geojson", circuits or geojson()),
    ):
        digest = hashlib.sha256(payload).hexdigest()
        relative = f"archive/geography/{stem}.{digest}.{suffix}"
        (root / relative).parent.mkdir(parents=True, exist_ok=True)
        (root / relative).write_bytes(payload)
        records.append(
            {"id": source_id, "archived_path": relative, "sha256": digest, "status": "ok"}
        )
    manifest = root / "archive-manifest.json"
    manifest.write_text(json.dumps({"records": records}))
    return records


def check(monkeypatch, capsys, root):
    monkeypatch.setattr(
        sys,
        "argv",
        ["x", "check", "--manifest", str(root / "archive-manifest.json"), "--root", str(root)],
    )
    code = cli.main()
    return code, json.loads(capsys.readouterr().out)


def test_check_reports_locales_circuits_and_per_reason_exclusions(monkeypatch, capsys, tmp_path):
    records = archive(tmp_path)
    code, report = check(monkeypatch, capsys, tmp_path)
    assert code == 0
    assert report["counts"] == {
        "circuits": 3,
        "locales": 3,
        "plotted_locales": 2,
        "unique_coordinate_pairs": 2,
        "mesas": 9,
    }
    assert report["mesa_range"] == {"first": 1, "last": 9}
    assert report["exclusions"] == {"not_plotted": {"missing_coordinates": 1}}
    assert report["sources"] == {
        r["id"]: {"archived_path": r["archived_path"], "sha256": r["sha256"]} for r in records
    }


def test_check_refuses_a_missing_original(monkeypatch, capsys, tmp_path):
    records = archive(tmp_path)
    (tmp_path / records[0]["archived_path"]).unlink()
    code, report = check(monkeypatch, capsys, tmp_path)
    assert (code, report) == (1, {"error": "missing_source", "source": LOCALES_ID})


def test_check_refuses_corrupt_bytes(monkeypatch, capsys, tmp_path):
    records = archive(tmp_path)
    path = tmp_path / records[1]["archived_path"]
    path.write_bytes(path.read_bytes() + b" ")
    code, report = check(monkeypatch, capsys, tmp_path)
    assert (code, report) == (1, {"error": "checksum_mismatch", "source": CIRCUITS_ID})


def test_check_refuses_a_record_whose_name_and_checksum_disagree(monkeypatch, capsys, tmp_path):
    records = archive(tmp_path)
    records[0]["sha256"] = "0" * 64
    (tmp_path / "archive-manifest.json").write_text(json.dumps({"records": records}))
    code, report = check(monkeypatch, capsys, tmp_path)
    assert (code, report) == (1, {"error": "checksum_mismatch", "source": LOCALES_ID})


def test_check_refuses_a_missing_manifest_record(monkeypatch, capsys, tmp_path):
    records = archive(tmp_path)
    (tmp_path / "archive-manifest.json").write_text(json.dumps({"records": records[1:]}))
    code, report = check(monkeypatch, capsys, tmp_path)
    assert (code, report) == (1, {"error": "missing_manifest_record", "source": LOCALES_ID})


def refused(monkeypatch, capsys, tmp_path, **originals):
    archive(tmp_path, **originals)
    code, report = check(monkeypatch, capsys, tmp_path)
    assert code == 1
    return report


def with_row(index, **changes):
    rows = [list(row) for row in ROWS]
    for position, value in changes.items():
        rows[index][HEADER.index(position)] = value
    return workbook(rows)


def test_check_refuses_structural_problems_instead_of_excluding_rows(monkeypatch, capsys, tmp_path):
    cases = {
        "unreadable_workbook": b"not a workbook",
        "unexpected_header": workbook(ROWS, header=[*HEADER[:-1], "Lon"]),
        "invalid_mesa_number": with_row(0, Desde="1.5"),
        "unexpected_territory": with_row(0, **{"Secc.Elect.": "2_026"}),
        "invalid_circuit_code": with_row(0, **{"Circ.Elect.": "X1"}),
        "unknown_circuit": with_row(2, **{"Circ.Elect.": "0250"}),
        "mesa_count_mismatch": with_row(1, **{"Cant.Mesas": 4}),
        "mesa_ranges_not_contiguous": with_row(2, Desde=9, Hasta=10),
        "partial_coordinates": with_row(1, Longitud=None),
        "invalid_coordinates": with_row(1, Latitud=-138.0),
    }
    for reason, locales in cases.items():
        directory = tmp_path / reason
        report = refused(monkeypatch, capsys, directory, locales=locales)
        assert report["error"] == reason, reason
        assert report["source"] == LOCALES_ID


def test_check_refuses_invalid_circuit_geometry(monkeypatch, capsys, tmp_path):
    duplicate = refused(
        monkeypatch, capsys, tmp_path / "duplicate", circuits=geojson([*CIRCUITS, "0249"])
    )
    assert duplicate == {"error": "duplicate_circuit", "source": CIRCUITS_ID}
    polygon = json.loads(geojson())
    polygon["features"][0]["geometry"]["type"] = "Polygon"
    report = refused(
        monkeypatch, capsys, tmp_path / "polygon", circuits=json.dumps(polygon).encode()
    )
    assert report == {"error": "invalid_geometry", "source": CIRCUITS_ID}
    district = json.loads(geojson())
    district["features"][0]["properties"]["INDRA_D"] = "026"
    report = refused(
        monkeypatch, capsys, tmp_path / "district", circuits=json.dumps(district).encode()
    )
    assert report == {"error": "unexpected_territory", "source": CIRCUITS_ID}


def test_check_refuses_a_record_without_a_checksum(monkeypatch, capsys, tmp_path):
    records = archive(tmp_path)
    del records[1]["sha256"]
    (tmp_path / "archive-manifest.json").write_text(json.dumps({"records": records}))
    code, report = check(monkeypatch, capsys, tmp_path)
    assert (code, report) == (1, {"error": "missing_checksum", "source": CIRCUITS_ID})


def test_check_refuses_a_multipolygon_without_rings(monkeypatch, capsys, tmp_path):
    for name, coordinates in {"no_rings": [[]], "one_empty_polygon": [*SQUARE, []]}.items():
        empty = json.loads(geojson())
        empty["features"][0]["geometry"]["coordinates"] = coordinates
        report = refused(monkeypatch, capsys, tmp_path / name, circuits=json.dumps(empty).encode())
        assert report == {"error": "invalid_geometry", "source": CIRCUITS_ID}, name


ROOT = Path(__file__).resolve().parents[2]
ARTIFACT_DIR = ROOT / "apps/web/data/geography"
ARTIFACT_GLOB = "cne-rosales-2025-reference.*.json"


def build(monkeypatch, capsys, root, output_dir):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "x",
            "build",
            "--manifest",
            str(root / "archive-manifest.json"),
            "--root",
            str(root),
            "--output-dir",
            str(output_dir),
        ],
    )
    code = cli.main()
    return code, json.loads(capsys.readouterr().out)


def test_build_writes_a_deterministic_content_addressed_reference_artifact(
    monkeypatch, capsys, tmp_path
):
    records = archive(tmp_path)
    code, meta = build(monkeypatch, capsys, tmp_path, tmp_path / "a")
    again, repeat = build(monkeypatch, capsys, tmp_path, tmp_path / "b")
    assert (code, again) == (0, 0)
    payload = (tmp_path / "a" / meta["filename"]).read_bytes()
    digest = hashlib.sha256(payload).hexdigest()
    assert (
        meta
        == repeat
        == {
            "filename": f"cne-rosales-2025-reference.{digest}.json",
            "sha256": digest,
            "bytes": len(payload),
        }
    )
    assert (tmp_path / "b" / meta["filename"]).read_bytes() == payload
    artifact = json.loads(payload)
    assert artifact["schema_version"] == 1
    assert artifact["reference_only"] is True
    assert artifact["caveats"] == [
        "cne_reference_not_official_results",
        "not_valid_for_historical_elections",
        "circuits_0248B_0248C_overlap",
        "locales_in_0248_not_assigned_to_sub_circuits",
    ]
    assert artifact["sources"] == {
        r["id"]: {"archived_path": r["archived_path"], "sha256": r["sha256"]} for r in records
    }
    assert artifact["counts"]["plotted_locales"] == 2
    assert artifact["exclusions"] == {"not_plotted": {"missing_coordinates": 1}}
    assert [c["code"] for c in artifact["circuits"]] == CIRCUITS
    assert artifact["circuits"][0]["coordinates"] == SQUARE
    assert artifact["locales"][0] == {
        "circuit": "0248",
        "name": "ESCUELA A",
        "address": "CALLE 1",
        "locality": "PUNTA ALTA",
        "mesa_count": 4,
        "mesa_from": 1,
        "mesa_to": 4,
        "coordinates": None,
    }
    assert artifact["locales"][1]["coordinates"] == [-62.078329, -38.880471]
    # The workbook writes `248C`; the artifact carries the joined circuit code.
    assert artifact["locales"][1]["circuit"] == "0248C"
    assert [locale["mesa_from"] for locale in artifact["locales"]] == [1, 5, 8]


def test_build_refusal_writes_nothing(monkeypatch, capsys, tmp_path):
    records = archive(tmp_path)
    path = tmp_path / records[0]["archived_path"]
    path.write_bytes(path.read_bytes() + b" ")
    code, report = build(monkeypatch, capsys, tmp_path, tmp_path / "out")
    assert (code, report) == (1, {"error": "checksum_mismatch", "source": LOCALES_ID})
    assert not (tmp_path / "out").exists()


def test_failed_publication_leaves_no_partial_artifact(monkeypatch, capsys, tmp_path):
    archive(tmp_path)

    def fail(*_args):
        raise OSError("disk full")

    monkeypatch.setattr(cli.os, "replace", fail)
    code, report = build(monkeypatch, capsys, tmp_path, tmp_path / "out")
    assert (code, report) == (2, {"error": "publication_failed", "detail": "disk full"})
    assert list((tmp_path / "out").iterdir()) == []


def test_committed_artifact_is_content_addressed_and_pins_the_archived_sources():
    committed = sorted(ARTIFACT_DIR.glob(ARTIFACT_GLOB))
    assert len(committed) == 1
    payload = committed[0].read_bytes()
    assert (
        committed[0].name
        == f"cne-rosales-2025-reference.{hashlib.sha256(payload).hexdigest()}.json"
    )
    manifest = json.loads((ROOT / "archive-manifest.json").read_text(encoding="utf-8"))
    recorded = {
        r["id"]: {"archived_path": r["archived_path"], "sha256": r["sha256"]}
        for r in manifest["records"]
        if r.get("id") in (LOCALES_ID, CIRCUITS_ID) and r.get("status") == "ok"
    }
    artifact = json.loads(payload)
    assert artifact["sources"] == recorded
    assert artifact["counts"] == {
        "circuits": 10,
        "locales": 31,
        "plotted_locales": 28,
        "unique_coordinate_pairs": 28,
        "mesas": 153,
    }
    assert artifact["exclusions"] == {"not_plotted": {"missing_coordinates": 3}}


def test_committed_artifact_matches_regeneration_from_the_versioned_archive(
    monkeypatch, capsys, tmp_path
):
    committed = sorted(ARTIFACT_DIR.glob(ARTIFACT_GLOB))
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "x",
            "build",
            "--manifest",
            str(ROOT / "archive-manifest.json"),
            "--root",
            str(ROOT),
            "--output-dir",
            str(tmp_path),
        ],
    )
    assert cli.main() == 0
    meta = json.loads(capsys.readouterr().out)
    assert [p.name for p in committed] == [meta["filename"]]
    assert committed[0].read_bytes() == (tmp_path / meta["filename"]).read_bytes()
