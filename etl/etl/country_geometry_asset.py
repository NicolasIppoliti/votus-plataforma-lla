"""Deterministic, reference-only browser derivative of a verified IGN snapshot."""

import gzip
import hashlib
import json
from pathlib import Path

from shapely.geometry import MultiPolygon, Polygon, mapping

from .country_geometry import inspect_country

TOLERANCE_DEGREES = 0.005


def generate_country_asset(payload: bytes, input_sha256: str, output_dir: Path) -> dict:
    inspected = inspect_country(payload)
    source = json.loads(payload)
    original = source["features"][0]["geometry"]
    polygons = (
        original["coordinates"] if original["type"] == "MultiPolygon" else [original["coordinates"]]
    )
    corrected = [
        [[[lon, -90 if lat == -90.00000001 else lat] for lon, lat in ring] for ring in polygon]
        for polygon in polygons
    ]
    before_vertices = sum(len(ring) for polygon in corrected for ring in polygon)
    source_geometry = MultiPolygon([Polygon(rings[0], rings[1:]) for rings in corrected])
    if not source_geometry.is_valid:
        raise ValueError("invalid_source_multipolygon")
    fallbacks: dict[str, int] = {}
    try:
        simplified = source_geometry.simplify(TOLERANCE_DEGREES, preserve_topology=True)
    except Exception:
        simplified = source_geometry
        fallbacks["simplification_error"] = 1
    if simplified.geom_type != "MultiPolygon" or not simplified.is_valid:
        simplified = source_geometry
        fallbacks["invalid_or_changed_structure"] = 1
    if (
        len(simplified.geoms) != len(source_geometry.geoms)
        or any(
            len(a.interiors) != len(b.interiors)
            for a, b in zip(source_geometry.geoms, simplified.geoms)
        )
        or any(
            abs(a - b) > TOLERANCE_DEGREES
            for a, b in zip(source_geometry.bounds, simplified.bounds)
        )
    ):
        simplified = source_geometry
        fallbacks["changed_structure_or_extent"] = 1
    result = mapping(simplified)["coordinates"]
    geometry = {"type": "MultiPolygon", "coordinates": result}
    feature = {
        "type": "Feature",
        "geometry": geometry,
        "properties": {"reference_only": True, "input_sha256": input_sha256, "source": "IGN"},
    }
    asset = {"type": "FeatureCollection", "features": [feature]}
    data = json.dumps(asset, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    digest = hashlib.sha256(data).hexdigest()
    filename = f"argentina-reference.{digest}.geojson"
    output_dir.mkdir(parents=True, exist_ok=True)
    destination = output_dir / filename
    if destination.exists() and destination.read_bytes() != data:
        raise ValueError("existing_asset_content_mismatch")
    destination.write_bytes(data)
    after_vertices = sum(len(ring) for polygon in result for ring in polygon)
    return {
        "filename": filename,
        "sha256": digest,
        "input_sha256": input_sha256,
        "bytes": len(data),
        "gzip_bytes": len(gzip.compress(data, mtime=0)),
        "tolerance_degrees": TOLERANCE_DEGREES,
        "input_bounds": inspected["bbox"],
        "output_bounds": [
            min(point[0] for poly in result for ring in poly for point in ring),
            min(point[1] for poly in result for ring in poly for point in ring),
            max(point[0] for poly in result for ring in poly for point in ring),
            max(point[1] for poly in result for ring in poly for point in ring),
        ],
        "counts": {
            "polygons": len(result),
            "rings": sum(map(len, result)),
            "vertices_before": before_vertices,
            "vertices_after": after_vertices,
        },
        "polar_corrections": inspected["corrections"],
        "fallbacks": fallbacks,
        "reference_only": True,
    }
