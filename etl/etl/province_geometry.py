"""Pre-archive checks for the IGN Buenos Aires province GeoJSON snapshot."""

import json
import math


def province_failure(payload: bytes) -> str | None:
    try:
        document = json.loads(payload)
    except (ValueError, UnicodeError):
        return "invalid_json"
    if not isinstance(document, dict) or document.get("type") != "FeatureCollection":
        return "invalid_collection"
    features = document.get("features")
    if not isinstance(features, list):
        return "invalid_feature_list"
    if len(features) != 1:
        return f"feature_count (count={len(features)})"
    feature = features[0]
    if not isinstance(feature, dict) or feature.get("type") != "Feature":
        return "invalid_feature_type"
    if feature.get("id") != "provincia.68" or not isinstance(feature.get("properties"), dict) or feature["properties"].get("in1") != "06":
        return "wrong_province"
    crs = document.get("crs")
    if not isinstance(crs, dict) or crs.get("type") != "name" or not isinstance(crs.get("properties"), dict) or crs["properties"].get("name") not in ("EPSG:4326", "urn:ogc:def:crs:EPSG::4326"):
        return "invalid_crs"
    geometry = feature.get("geometry")
    if not isinstance(geometry, dict):
        return "invalid_geometry"
    kind = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if kind not in ("Polygon", "MultiPolygon") or not isinstance(coordinates, list) or not coordinates:
        return "invalid_geometry"
    polygons = [coordinates] if kind == "Polygon" else coordinates
    try:
        for polygon in polygons:
            if not isinstance(polygon, list) or not polygon:
                return "invalid_geometry"
            for ring in polygon:
                if not isinstance(ring, list) or len(ring) < 4:
                    return "invalid_geometry"
                for point in ring:
                    if not isinstance(point, list) or len(point) != 2 or any(
                        type(value) not in (int, float) or not math.isfinite(value)
                        for value in point
                    ) or not (-180 <= point[0] <= 180 and -90 <= point[1] <= 90):
                        return "invalid_geometry"
                if ring[0] != ring[-1]:
                    return "invalid_geometry"
    except (TypeError, ValueError, OverflowError):
        return "invalid_geometry"
    return None
