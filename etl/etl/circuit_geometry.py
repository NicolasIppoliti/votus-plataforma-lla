"""Checksum-backed CNE circuit reference validation against the CNE section."""

import json

from shapely.geometry import shape
from shapely.ops import unary_union

# Reviewed original snapshots only: this is not a topology tolerance or a repair.
REVIEWED_CNE_REFERENCE = {
    "geography/cne-pba-circuits": (
        "215b9d53504b385db35825a1dead0af6c87494dbef541f0ab8acf61996852e71"
    ),
    "geography/cne-pba-sections": (
        "964af68999504c107c71eaccd8470055f990071eccba09f227e81b6dc31df673"
    ),
}


class CircuitGeometryError(ValueError):
    """The geographic reference cannot be trusted."""


def _features(payload: bytes) -> list[dict]:
    try:
        document = json.loads(payload)
        if (
            document["type"] != "FeatureCollection"
            or document["crs"]["properties"]["name"]
            not in ("urn:ogc:def:crs:EPSG::4326", "EPSG:4326")
            or not isinstance(document["features"], list)
        ):
            raise CircuitGeometryError("invalid_collection_or_crs")
        return document["features"]
    except (KeyError, TypeError, ValueError) as exc:
        raise CircuitGeometryError("invalid_collection_or_crs") from exc


def inspect_circuits(circuits: bytes, section: bytes) -> dict:
    """Validate source identity, GEOS topology, and section containment without repair."""
    parents = _features(section)
    selected_parents = []
    for feature in parents:
        props = feature.get("properties") if isinstance(feature, dict) else None
        if (
            isinstance(props, dict)
            and feature.get("type") == "Feature"
            and props.get("provincia") == "Buenos Aires"
            and props.get("departamen") == "Cnel. de Marina L.Rosales"
        ):
            selected_parents.append(feature)
    if (
        len(selected_parents) != 1
        or selected_parents[0]["properties"].get("cabecera") != "Punta Alta"
    ):
        raise CircuitGeometryError("wrong_parent_identity")
    try:
        parent = shape(selected_parents[0]["geometry"])
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise CircuitGeometryError("invalid_parent_geometry") from exc
    if (
        not parent.is_valid
        or parent.is_empty
        or parent.geom_type not in ("Polygon", "MultiPolygon")
    ):
        raise CircuitGeometryError("invalid_parent_geometry")
    source_features = _features(circuits)
    selected = []
    exclusion_reasons: dict[str, int] = {}
    excluded = 0
    for feature in source_features:
        props = feature.get("properties") if isinstance(feature, dict) else None
        props = props if isinstance(props, dict) else {}
        reason = None
        if not props.get("distrito") or not props.get("indec_d"):
            reason = "missing_scope_identity"
        elif props["distrito"] != "02":
            reason = "other_distrito"
        elif props["indec_d"] != "182":
            reason = "other_indec_d"
        if reason:
            excluded += 1
            exclusion_reasons[reason] = exclusion_reasons.get(reason, 0) + 1
            continue
        if props.get("departamen") != "Cnel. de Marina L.Rosales":
            raise CircuitGeometryError("wrong_circuit_identity")
        selected.append(feature)
    if not selected:
        raise CircuitGeometryError("missing_circuits")
    reasons: dict[str, int] = {}
    geometries = []
    names = set()
    normalized: dict[str, list[int]] = {}
    rejected = set()
    for index, feature in enumerate(selected):
        raw = feature["properties"].get("circuito")
        if not isinstance(raw, str) or not raw:
            rejected.add(index)
            reasons["missing_or_duplicate_circuit"] = (
                reasons.get("missing_or_duplicate_circuit", 0) + 1
            )
        else:
            names.add(raw)
            key = str(int(raw)) if raw.isascii() and raw.isdecimal() else raw
            normalized.setdefault(key, []).append(index)
        try:
            geometry = shape(feature["geometry"])
        except (KeyError, TypeError, ValueError, AttributeError):
            reasons["invalid_geometry"] = reasons.get("invalid_geometry", 0) + 1
            rejected.add(index)
            continue
        if (
            feature.get("type") != "Feature"
            or geometry.is_empty
            or not geometry.is_valid
            or geometry.geom_type not in ("Polygon", "MultiPolygon")
        ):
            reasons["invalid_geometry"] = reasons.get("invalid_geometry", 0) + 1
            rejected.add(index)
            continue
        geometries.append((index, geometry))
        if not parent.covers(geometry):
            reasons["outside_parent"] = reasons.get("outside_parent", 0) + 1
            rejected.add(index)
    for indices in normalized.values():
        if len(indices) > 1:
            reasons["missing_or_duplicate_circuit"] = reasons.get(
                "missing_or_duplicate_circuit", 0
            ) + len(indices)
            rejected.update(indices)
    overlapping = set()
    overlap_pairs = []
    for position, (index, geometry) in enumerate(geometries):
        for other_index, other in geometries[:position]:
            if geometry.intersection(other).area > 0:
                overlapping.update((index, other_index))
                raw_pair = [selected[i]["properties"].get("circuito") for i in (index, other_index)]
                overlap_pairs.append(sorted(raw_pair, key=lambda raw: json.dumps(raw)))
    if overlapping:
        reasons["overlap"] = len(overlapping)
        rejected.update(overlapping)
    if geometries and parent.difference(unary_union([g for _, g in geometries])).area > 0:
        reasons["gap"] = 1
    eligible = len(selected) - len(rejected)
    strict_partition = not reasons and not exclusion_reasons.get("missing_scope_identity", 0)
    return {
        "counts_basis": "strict-partition",
        "counts": {
            "accepted": eligible if strict_partition else 0,
            "eligible": eligible,
            "invalid": len(rejected),
            "total": len(selected),
            "source_total": len(source_features),
            "excluded": excluded,
        },
        "reasons": reasons,
        "overlap_pairs": sorted(overlap_pairs, key=json.dumps),
        "exclusion_reasons": exclusion_reasons,
        "geographic_coverage": "valid" if strict_partition else "unverified",
        "election_applicability": "unknown",
        "circuits": sorted(names),
    }


def reference_acceptance(report: dict, verified_snapshots: dict) -> dict:
    """Qualify reference use, never disjoint spatial attribution or election validity."""
    missing_scope = report["exclusion_reasons"].get("missing_scope_identity", 0)
    reviewed_overlap = (
        report["reasons"] == {"overlap": 2}
        and report["overlap_pairs"] == [["0248B", "0248C"]]
        and set(verified_snapshots) == set(REVIEWED_CNE_REFERENCE)
        and all(
            verified_snapshots[source]["sha256"] == digest
            for source, digest in REVIEWED_CNE_REFERENCE.items()
        )
    )
    accepted = not missing_scope and (not report["reasons"] or reviewed_overlap)
    return {
        "status": ("accepted_with_warning" if accepted and reviewed_overlap else "accepted")
        if accepted
        else "blocked",
        "warnings": ["reviewed_source_overlap"] if accepted and reviewed_overlap else [],
        "spatial_assignment": "unsupported",
    }
