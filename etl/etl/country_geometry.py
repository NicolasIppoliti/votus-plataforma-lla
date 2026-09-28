"""Validate IGN country reference snapshots without changing archived bytes."""

import json
import math


def inspect_country(payload: bytes) -> dict:
    try:
        document = json.loads(payload)
    except (ValueError, UnicodeError):
        raise ValueError("invalid_json") from None
    if not isinstance(document, dict) or document.get("type") != "FeatureCollection":
        raise ValueError("invalid_collection")
    features = document.get("features")
    if not isinstance(features, list) or len(features) != 1:
        raise ValueError("feature_count")
    feature = features[0]
    if not isinstance(feature, dict) or feature.get("type") != "Feature":
        raise ValueError("invalid_feature")
    properties = feature.get("properties")
    if (
        feature.get("id") != "pais.885"
        or not isinstance(properties, dict)
        or any(
            properties.get(key) != value
            for key, value in (("fna", "República Argentina"), ("nam", "Argentina"), ("sag", "IGN"))
        )
    ):
        raise ValueError("wrong_country")
    crs = document.get("crs")
    if (
        not isinstance(crs, dict)
        or crs.get("type") != "name"
        or not isinstance(crs.get("properties"), dict)
        or crs["properties"].get("name") not in ("EPSG:4326", "urn:ogc:def:crs:EPSG::4326")
    ):
        raise ValueError("invalid_crs")
    geometry = feature.get("geometry")
    if not isinstance(geometry, dict) or geometry.get("type") not in ("Polygon", "MultiPolygon"):
        raise ValueError("invalid_geometry")
    kind = geometry["type"]
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list) or not coordinates:
        raise ValueError("invalid_geometry")
    polygons = [coordinates] if kind == "Polygon" else coordinates
    corrections = []
    bounds = [180.0, 90.0, -180.0, -90.0]
    ring_count = vertex_count = 0
    for pi, polygon in enumerate(polygons):
        if not isinstance(polygon, list) or not polygon:
            raise ValueError("invalid_geometry")
        for ri, ring in enumerate(polygon):
            if not isinstance(ring, list) or len(ring) < 4:
                raise ValueError("invalid_geometry")
            ring_count += 1
            first = last = None
            for vi, point in enumerate(ring):
                if (
                    not isinstance(point, list)
                    or len(point) != 2
                    or any(type(v) not in (int, float) or not math.isfinite(v) for v in point)
                ):
                    raise ValueError("invalid_geometry")
                lon, lat = point
                if lat == -90.00000001:
                    corrections.append(
                        {"polygon": pi, "ring": ri, "vertex": vi, "original": lat, "corrected": -90}
                    )
                    lat = -90
                if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                    raise ValueError("invalid_geometry")
                bounds = [
                    min(bounds[0], lon),
                    min(bounds[1], lat),
                    max(bounds[2], lon),
                    max(bounds[3], lat),
                ]
                if first is None:
                    first = [lon, lat]
                last = [lon, lat]
                vertex_count += 1
            if first != last:
                raise ValueError("invalid_geometry")
    for key, actual in (
        ("totalFeatures", len(features)),
        ("numberMatched", len(features)),
        ("numberReturned", len(features)),
    ):
        if key in document and (type(document[key]) is not int or document[key] != actual):
            raise ValueError("declared_feature_count")
    return {
        "counts": {
            "features": 1,
            "polygons": len(polygons),
            "rings": ring_count,
            "vertices": vertex_count,
            "corrections": len(corrections),
        },
        "bbox": bounds,
        "corrections": corrections,
        "reference_only": True,
    }
