"""Exercise the offline country asset through the real CLI and verified archive."""

import hashlib
import json
from pathlib import Path

import yaml
from shapely.geometry import shape

from etl.__main__ import main
from etl.manifest import save_manifest


def country_asset_case(tmp_path: Path, coordinates=None):
    source = "geography/ign-argentina-country"
    entry = {
        "id": source,
        "source": "IGN",
        "source_url": "https://example.test/country",
        "mime": "application/geo+json",
        "notes": "fixture",
        "reference_kind": "country_geometry",
        "max_response_bytes": 134217728,
    }
    sources = tmp_path / "sources.yaml"
    sources.write_text(yaml.safe_dump({"geography": [entry]}))
    if coordinates is None:
        coordinates = [
            [[[-74, -40], [-73, -40], [-73, -39], [-74, -40]]],
            [[[-50, -80], [-49, -80], [-49, -79], [-50, -80]]],
        ]
    document = {
        "type": "FeatureCollection",
        "crs": {"type": "name", "properties": {"name": "EPSG:4326"}},
        "features": [
            {
                "type": "Feature",
                "id": "pais.885",
                "properties": {"fna": "República Argentina", "nam": "Argentina", "sag": "IGN"},
                "geometry": {"type": "MultiPolygon", "coordinates": coordinates},
            }
        ],
    }
    payload = json.dumps(document, ensure_ascii=False).encode()
    archive = tmp_path / "archive" / "geography" / "country.geojson"
    archive.parent.mkdir(parents=True)
    archive.write_bytes(payload)
    digest = hashlib.sha256(payload).hexdigest()
    manifest = tmp_path / "manifest.json"
    save_manifest(
        manifest,
        [
            {
                "id": source,
                "capability": "geography",
                "source": "IGN",
                "source_url": entry["source_url"],
                "status": "ok",
                "sha256": digest,
                "archived_path": "archive/geography/country.geojson",
                "fetched_at": "2026-01-01T00:00:00Z",
            }
        ],
        events=[],
    )
    output = tmp_path / "output"
    args = [
        "--sources-path",
        str(sources),
        "--manifest-path",
        str(manifest),
        "--local-root",
        str(archive.parent.parent),
        "generate-country-geometry",
        "--source",
        source,
        "--output-dir",
        str(output),
    ]
    return args, archive, output, manifest


def test_country_asset_cli_generates_deterministic_verified_asset(tmp_path, capsys):
    args, archive, output, _ = country_asset_case(tmp_path)
    original = archive.read_bytes()
    assert main(args) == 0
    report = json.loads(capsys.readouterr().out)
    asset = output / report["filename"]
    data = asset.read_bytes()
    assert report["sha256"] == hashlib.sha256(data).hexdigest()
    assert report["input_sha256"] == hashlib.sha256(original).hexdigest()
    assert json.loads(data)["features"][0]["properties"]["reference_only"] is True
    assert main(args) == 0
    assert json.loads(capsys.readouterr().out) == report
    assert asset.read_bytes() == data
    assert archive.read_bytes() == original


def test_country_asset_cli_corrects_only_exact_polar_coordinate(tmp_path, capsys):
    coordinates = [[[[-50, -90.00000001], [-49, -89], [-48, -89], [-50, -90.00000001]]]]
    args, archive, output, _ = country_asset_case(tmp_path, coordinates)
    assert main(args) == 0
    report = json.loads(capsys.readouterr().out)
    feature = json.loads((output / report["filename"]).read_text())["features"][0]
    points = feature["geometry"]["coordinates"]
    assert min(point[1] for poly in points for ring in poly for point in ring) == -90
    assert report["polar_corrections"] == [
        {"polygon": 0, "ring": 0, "vertex": index, "original": -90.00000001, "corrected": -90}
        for index in (0, 3)
    ]
    assert b"-90.00000001" in archive.read_bytes()


def test_country_asset_cli_refuses_other_invalid_latitude(tmp_path, capsys):
    coordinates = [[[[-50, -90.1], [-49, -89], [-48, -89], [-50, -90.1]]]]
    args, _, output, _ = country_asset_case(tmp_path, coordinates)
    assert main(args) == 1
    assert "invalid_geometry" in capsys.readouterr().err
    assert not output.exists()


def test_country_asset_cli_refuses_invalid_source_without_artifact(tmp_path, capsys):
    coordinates = [
        [
            [[-74, -40], [-70, -40], [-70, -36], [-74, -36], [-74, -40]],
            [[-73, -39], [-72, -39], [-72, -38], [-73, -38], [-73, -39]],
        ],
        [[[-50, -80], [-49, -79], [-50, -79], [-49, -80], [-50, -80]]],
    ]
    args, _, output, _ = country_asset_case(tmp_path, coordinates)
    assert main(args) == 1
    assert "invalid_source_multipolygon" in capsys.readouterr().err
    assert not output.exists()


def test_country_asset_cli_preserves_whole_multipolygon_validity(tmp_path, capsys):
    coordinates = [
        [
            [(0, 0), (4, 0), (4, 4), (0, 4), (0, 0)],
            [(1, 1), (3, 1), (3, 3), (2, 3.004), (1, 3), (1, 1)],
        ],
        [[(1.99, 2.999), (2.01, 2.999), (2.01, 3.001), (1.99, 3.001), (1.99, 2.999)]],
    ]
    args, archive, output, _ = country_asset_case(tmp_path, coordinates)
    original = archive.read_bytes()
    assert shape(json.loads(original)["features"][0]["geometry"]).is_valid
    assert main(args) == 0
    report = json.loads(capsys.readouterr().out)
    geometry = json.loads((output / report["filename"]).read_bytes())["features"][0]["geometry"]
    assert shape(geometry).is_valid
    assert report["counts"]["polygons"] == 2
    assert report["counts"]["rings"] == 3
    assert report["fallbacks"] == {}
    assert archive.read_bytes() == original


def test_country_asset_cli_refuses_invalid_archive_hash_and_path(tmp_path, capsys):
    args, archive, output, manifest = country_asset_case(tmp_path)
    archive.write_bytes(archive.read_bytes() + b" ")
    assert main(args) == 1
    assert not output.exists()
    archive.write_bytes(archive.read_bytes()[:-1])
    document = json.loads(manifest.read_text())
    document["records"][0]["archived_path"] = "elsewhere/geography/country.geojson"
    manifest.write_text(json.dumps(document))
    assert main(args) == 1
    assert not output.exists()
    assert capsys.readouterr().err
