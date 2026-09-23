import { Map as MapLibreMap } from "maplibre-gl";
import { MapLibreOverlay } from "@deck.gl/maplibre";
import { GeoJsonLayer } from "@deck.gl/layers";

const status = document.querySelector<HTMLElement>("#renderer-status")!;
const selection = document.querySelector<HTMLElement>("#selection")!;
const focus = document.querySelector<HTMLButtonElement>("#focus")!;
const mapElement = document.querySelector<HTMLElement>("#map")!;
let map: MapLibreMap | undefined;
let overlay: MapLibreOverlay | undefined;
let boundary: NonNullable<ConstructorParameters<typeof GeoJsonLayer>[0]["data"]> | undefined;
let bounds: [[number, number], [number, number]] | undefined;
let selected = false;
let lastFocusDurationMs: number | undefined;

// Evaluator-only observation seam; this page is never bundled into Next.
const evaluationWindow = window as Window & { __territorialRendererEvaluation?: {
  camera: () => { longitude: number; latitude: number; zoom: number; moving: boolean } | null;
  lastFocusDurationMs: () => number | undefined;
} };
evaluationWindow.__territorialRendererEvaluation = {
  camera: () => map ? { longitude: map.getCenter().lng, latitude: map.getCenter().lat, zoom: map.getZoom(), moving: map.isMoving() } : null,
  lastFocusDurationMs: () => lastFocusDurationMs,
};

function boundaryLayer() {
  return new GeoJsonLayer({ id: "partido-boundary", data: boundary!, filled: true, stroked: true, getFillColor: [36, 101, 122, 50], getLineColor: selected ? [8, 48, 72, 255] : [23, 68, 87, 255], lineWidthMinPixels: selected ? 5 : 2, pickable: false });
}

function select() {
  selected = !selected;
  selection.textContent = selected ? "Selection: Coronel Rosales boundary selected; outline emphasized." : "Selection: Coronel Rosales boundary not selected.";
  if (map && bounds) {
    overlay?.setProps({ layers: [boundaryLayer()] });
    lastFocusDurationMs = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 250;
    map.fitBounds(bounds, { padding: 24, duration: lastFocusDurationMs });
  }
}
focus.addEventListener("click", select);

async function render() {
  try {
    const canvas = document.createElement("canvas");
    if (!canvas.getContext("webgl2") && !canvas.getContext("webgl")) throw new Error("WebGL unavailable");
    const response = await fetch("/_evaluation/geometry");
    if (!response.ok) throw new Error("Verified geometry unavailable");
    const data = await response.json() as { features: Array<{ geometry: { type: string; coordinates: number[][][][] } }> };
    if (data.features.length !== 1 || data.features[0]?.geometry.type !== "MultiPolygon") throw new Error("Unexpected geometry");
    const points = data.features[0].geometry.coordinates.flat(2);
    if (!points.length || points.some((point) => point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) throw new Error("Invalid geometry coordinates");
    bounds = [[Math.min(...points.map((point) => point[0]!)), Math.min(...points.map((point) => point[1]!))], [Math.max(...points.map((point) => point[0]!)), Math.max(...points.map((point) => point[1]!))]];
    boundary = data as NonNullable<ConstructorParameters<typeof GeoJsonLayer>[0]["data"]>;
    map = new MapLibreMap({ container: mapElement, style: { version: 8, sources: {}, layers: [] }, bounds, fitBoundsOptions: { padding: 64 }, interactive: false, attributionControl: false });
    overlay = new MapLibreOverlay({ layers: [boundaryLayer()] });
    map.addControl(overlay);
    map.once("load", () => { status.textContent = "Renderer ready: one partido boundary; no election metric."; });
  } catch {
    status.textContent = "WebGL unavailable: map unavailable; exact boundary evidence table remains available.";
    map?.remove();
    map = undefined;
  }
}
void render();
