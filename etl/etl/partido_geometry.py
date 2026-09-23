"""Inspect archived ARBA partido evidence; not a topology validator."""

import json
import math

from .crosswalk import CrosswalkTable


def rejected_geometry(entry: dict, record: dict, reason: str, *, conflict: int = 0) -> dict:
    return {
        "counts": {"accepted": 0, "invalid": 0 if conflict else 1, "conflict": conflict},
        "reasons": {reason: conflict or 1},
        "snapshot": {
            "source": entry["id"],
            "sha256": record.get("sha256"),
            "timestamp": record.get("fetched_at"),
        },
        "feature": None,
        "feature_type": None,
        "geometry": None,
        "crs": None,
        "jurisdiction": None,
        "unsupported_depths": ["circuit", "establishment", "mesa"],
    }


def _valid_polygon(polygon: object) -> bool:
    if not isinstance(polygon, list) or not polygon:
        return False
    for ring in polygon:
        if not isinstance(ring, list) or len(ring) < 4:
            return False
        for position in ring:
            if not isinstance(position, list) or len(position) != 2:
                return False
            try:
                if not all(
                    type(value) in (int, float) and math.isfinite(value) for value in position
                ):
                    return False
            except OverflowError:
                return False
        if ring[0] != ring[-1]:
            return False
    return True


def inspect_partido_geometry(
    payload: bytes,
    entry: dict,
    record: dict,
    crosswalk: CrosswalkTable,
) -> dict:
    try:
        document = json.loads(payload)
    except (ValueError, UnicodeDecodeError):
        return rejected_geometry(entry, record, "invalid_json")
    if (
        not isinstance(document, dict)
        or document.get("type") != "FeatureCollection"
        or not isinstance(document.get("features"), list)
    ):
        return rejected_geometry(entry, record, "invalid_feature_collection")
    features = document["features"]
    if not features:
        return rejected_geometry(entry, record, "missing_feature")
    if len(features) != 1:
        return rejected_geometry(entry, record, "multiple_features", conflict=len(features))
    feature = features[0]
    if not isinstance(feature, dict) or feature.get("type") != "Feature":
        return rejected_geometry(entry, record, "invalid_feature")
    if document.get("crs") != {
        "type": "name",
        "properties": {"name": "urn:ogc:def:crs:EPSG::4326"},
    }:
        return rejected_geometry(entry, record, "wrong_crs")
    # GeoJSON omits the namespace; bind the local feature-id prefix to the
    # registered WFS type rather than pretending the payload declares a QName.
    feature_id = feature.get("id")
    if (
        entry.get("feature_type") != "idera:Departamento"
        or not isinstance(feature_id, str)
        or not feature_id.startswith("Departamento.")
        or not feature_id.removeprefix("Departamento.")
    ):
        return rejected_geometry(entry, record, "wrong_feature_type")
    expected = entry.get("expected_identity")
    if (
        not isinstance(expected, dict)
        or set(expected) != {"cca", "cde", "nam"}
        or not all(isinstance(value, str) and value for value in expected.values())
    ):
        return rejected_geometry(entry, record, "invalid_source_metadata")
    properties = feature.get("properties")
    if not isinstance(properties, dict) or any(
        properties.get(key) != value for key, value in expected.items()
    ):
        return rejected_geometry(entry, record, "wrong_identity")
    geometry = feature.get("geometry")
    if not isinstance(geometry, dict) or geometry.get("type") not in ("Polygon", "MultiPolygon"):
        return rejected_geometry(entry, record, "wrong_geometry_type")
    coordinates = geometry.get("coordinates")
    polygons = [coordinates] if geometry["type"] == "Polygon" else coordinates
    if not isinstance(polygons, list) or not polygons or not all(map(_valid_polygon, polygons)):
        return rejected_geometry(entry, record, "invalid_coordinates")
    pba_code = entry.get("pba_distrito_code")
    if not isinstance(pba_code, str) or not pba_code.strip():
        return rejected_geometry(entry, record, "invalid_source_metadata")
    jurisdiction = crosswalk.resolve_pba(pba_code)
    if jurisdiction is None:
        return rejected_geometry(entry, record, "unmapped_jurisdiction")
    return {
        "counts": {"accepted": 1, "invalid": 0, "conflict": 0},
        "reasons": {},
        "snapshot": {
            "source": entry["id"],
            "sha256": record["sha256"],
            "timestamp": record["fetched_at"],
        },
        "feature": feature["id"],
        "feature_type": entry["feature_type"],
        "geometry": feature["geometry"]["type"],
        "crs": "EPSG:4326",
        "jurisdiction": {
            "pba_distrito": jurisdiction.pba_distrito_code,
            "national_distrito": jurisdiction.national_distrito_code,
            "national_seccion": jurisdiction.national_seccion_code,
        },
        "unsupported_depths": ["circuit", "establishment", "mesa"],
    }
