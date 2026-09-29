export const NATIONAL_REFERENCE_PATH = "/geography/argentina-reference.70b0b5bba80ce1e924159fcceb72560a0b67435fff3d8d11e5b6e70590999af5.geojson";
const HASH = "70b0b5bba80ce1e924159fcceb72560a0b67435fff3d8d11e5b6e70590999af5";
const SOURCE_HASH = "ae076881944abd36b79b0a68d14912ca475af95a2c2a9211910ffab81f6ca1e6";
type Ring = number[][];
type Polygon = Ring[];
export interface ReferenceFeature {
  type: "Feature";
  properties: { reference_only: true; source: "IGN"; input_sha256: string };
  geometry: { type: "MultiPolygon"; coordinates: Polygon[] };
}

// D3 spherical polygons expect clockwise small exteriors, opposite RFC 7946.
// Inspect each signed ring independently: this asset contains one exceptional exterior.
function signedArea(ring: Ring): number {
  let area = 0;
  for (let i = 1; i < ring.length; i++) area += ring[i - 1]![0]! * ring[i]![1]! - ring[i]![0]! * ring[i - 1]![1]!;
  return area;
}

export async function loadNationalReference(signal?: AbortSignal): Promise<ReferenceFeature> {
  const response = await fetch(NATIONAL_REFERENCE_PATH, signal ? { signal } : {});
  if (!response.ok) throw new Error("reference unavailable");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== 736599) throw new Error("reference size mismatch");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== HASH) throw new Error("reference checksum mismatch");
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!parsed || typeof parsed !== "object" || !("type" in parsed) || parsed.type !== "FeatureCollection" ||
      !("features" in parsed) || !Array.isArray(parsed.features) || parsed.features.length !== 1) throw new Error("reference collection mismatch");
  const feature: unknown = parsed.features[0];
  if (!feature || typeof feature !== "object" || !("type" in feature) || feature.type !== "Feature" ||
      !("properties" in feature) || !feature.properties || typeof feature.properties !== "object" ||
      !("reference_only" in feature.properties) || feature.properties.reference_only !== true ||
      !("source" in feature.properties) || feature.properties.source !== "IGN" ||
      !("input_sha256" in feature.properties) || feature.properties.input_sha256 !== SOURCE_HASH ||
      !("geometry" in feature) || !feature.geometry || typeof feature.geometry !== "object" ||
      !("type" in feature.geometry) || feature.geometry.type !== "MultiPolygon" ||
      !("coordinates" in feature.geometry) || !Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length !== 1980) throw new Error("reference provenance or geometry mismatch");
  const verified = feature as ReferenceFeature;
  let rings = 0, vertices = 0;
  for (const polygon of verified.geometry.coordinates) {
    if (!Array.isArray(polygon) || polygon.length < 1) throw new Error("invalid polygon");
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) throw new Error("invalid ring");
      rings++; vertices += ring.length;
      for (const point of ring) if (!Array.isArray(point) || point.length !== 2 ||
        !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || point[0]! < -180 || point[0]! > 180 || point[1]! < -90 || point[1]! > 90)
        throw new Error("invalid coordinate");
      if (ring[0]![0] !== ring.at(-1)![0] || ring[0]![1] !== ring.at(-1)![1] || signedArea(ring) === 0) throw new Error("invalid ring closure");
    }
  }
  if (rings !== 1991 || vertices !== 27460) throw new Error("reference component mismatch");
  return verified;
}

export async function polarReferencePath(feature: ReferenceFeature): Promise<string> {
  const { geoAzimuthalEqualArea, geoContains, geoPath } = await import("d3-geo");
  let adapted = 0, exceptions = 0;
  const coordinates = feature.geometry.coordinates.map((polygon) => polygon.map((ring, index) => {
    const reverse = index === 0 && signedArea(ring) > 0 || index > 0 && signedArea(ring) < 0;
    if (index === 0 && reverse) exceptions++;
    if (reverse) adapted++;
    return reverse ? [...ring].reverse() : [...ring];
  }));
  // Explicitly reject source-shape drift; do not silently pick or omit a component.
  if (coordinates.length !== 1980 || coordinates.reduce((total, polygon) => total + polygon.length, 0) !== 1991 || exceptions !== 1 || adapted !== 1)
    throw new Error("unexpected winding distribution");
  const geometry = { type: "MultiPolygon" as const, coordinates };
  if (!geoContains(geometry, [-58, -35]) || !geoContains(geometry, [-50, -89.9]) || geoContains(geometry, [0, 0]))
    throw new Error("polar interior/exterior check failed");
  const projection = geoAzimuthalEqualArea().rotate([0, 90]).clipAngle(179.999).fitExtent([[8, 8], [392, 392]], geometry);
  const path = geoPath(projection)(geometry);
  if (!path || /NaN|Infinity/.test(path)) throw new Error("invalid polar projection");
  return path;
}
