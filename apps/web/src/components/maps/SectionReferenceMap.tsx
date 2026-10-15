"use client";

import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import styles from "./SectionReferenceMap.module.css";
import { REFERENCE_FILL, REFERENCE_LINE, REFERENCE_COLOR, Legend, shareFill } from "./reference-colors";

interface Props {
  coordinates: number[][][][];
  name: string;
  label: string;
  resultId: string;
  onCamera?: (center: [number, number], zoom: number) => void;
  camera?: { center: [number, number]; zoom: number } | undefined;
  onSelect?: (() => void) | undefined;
  municipal?: boolean;
  sharePercent?: number | undefined;
  fillColor?: [number, number, number, number] | undefined;
  staticLabel?: string | undefined;
}

interface ResultsDocument {
  getElementById(id: string): { focus(): void } | null;
  querySelectorAll(selector: string): ArrayLike<{ open: boolean }>;
}

/** Focus the exact-results heading and open any disclosure that folds the table it announces. */
export function revealExactResults(doc: ResultsDocument, resultId: string): void {
  Array.from(doc.querySelectorAll(`[data-results-for="${resultId}"]`)).forEach((disclosure) => { disclosure.open = true; });
  doc.getElementById(resultId)?.focus();
}

export function SectionReferenceMap({ coordinates, name, label, resultId, onCamera, camera, onSelect, municipal = false, sharePercent, fillColor, staticLabel }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const cameraCallback = useRef(onCamera);
  const latestCamera = useRef(camera);
  const selectCallback = useRef(onSelect);
  useEffect(() => { cameraCallback.current = onCamera; latestCamera.current = camera; selectCallback.current = onSelect; }, [onCamera, camera, onSelect]);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState(municipal ? "Mapa opcional: el contorno y la tabla están disponibles sin interacción." : "Mapa opcional: los resultados exactos están disponibles sin interacción.");
  const focusResults = () => {
    if (selectCallback.current) selectCallback.current();
    else revealExactResults(document as unknown as ResultsDocument, resultId);
    setStatus(`Sección ${name} seleccionada. Resultados exactos en la tabla.`);
  };

  useEffect(() => {
    if (!active || !container.current) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    async function initialize() {
      try {
        if (!document.createElement("canvas").getContext("webgl2")) throw new Error("WebGL unavailable");
        await import("maplibre-gl/dist/maplibre-gl.css");
        if (disposed || !container.current) return;
        const [maplibregl, { MapLibreOverlay }, { GeoJsonLayer }] = await Promise.all([
          import("maplibre-gl"), import("@deck.gl/maplibre"), import("@deck.gl/layers"),
        ]);
        if (disposed || !container.current) return;
        const points = coordinates.flat(2);
        const west = Math.min(...points.map(([longitude]) => longitude!));
        const east = Math.max(...points.map(([longitude]) => longitude!));
        const south = Math.min(...points.map(([, latitude]) => latitude!));
        const north = Math.max(...points.map(([, latitude]) => latitude!));
        const initialCamera = latestCamera.current;
        const map = new maplibregl.Map({
          container: container.current,
          style: { version: 8, sources: {}, layers: [] },
          center: initialCamera?.center ?? [(west + east) / 2, (south + north) / 2], zoom: initialCamera?.zoom ?? 8,
          attributionControl: false,
        });
        mapRef.current = map;
        cleanup = () => { mapRef.current = null; map.remove(); };
        const overlay = new MapLibreOverlay({ layers: [new GeoJsonLayer({
          id: "cne-section-outline", data: { type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates } },
          stroked: true, filled: true, getFillColor: fillColor ?? (sharePercent === undefined ? [...REFERENCE_FILL] : shareFill(sharePercent)),
          getLineColor: [...REFERENCE_LINE], getLineWidth: 2, lineWidthMinPixels: 2,
          pickable: true, onClick: () => {
            if (selectCallback.current) selectCallback.current();
            else revealExactResults(document as unknown as ResultsDocument, resultId);
            setStatus(`Sección ${name} seleccionada. Resultados exactos en la tabla.`);
          },
        })] });
        map.on("error", () => { if (!disposed) { cleanup?.(); cleanup = undefined; setActive(false); setStatus(municipal ? "No se pudo mostrar el mapa; el contorno y la tabla siguen disponibles." : "No se pudo mostrar el mapa; los resultados exactos siguen disponibles."); } });
        map.on("load", () => {
          if (disposed) return;
          try {
            map.addControl(overlay);
            const sharedCamera = latestCamera.current;
            if (sharedCamera) map.jumpTo(sharedCamera);
            else map.fitBounds([[west, south], [east, north]], { padding: 24, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 300 });
            setStatus(municipal ? `Mapa de la sección ${name} disponible. Sin resultados por partido en el mapa.` : `Mapa de ${name} disponible. Contorno de referencia; no muestra diferencias dentro de la sección.`);
          } catch {
            cleanup?.(); cleanup = undefined;
            setActive(false);
            setStatus(municipal ? "No se pudo mostrar el mapa; el contorno y la tabla siguen disponibles." : "No se pudo mostrar el mapa; los resultados exactos siguen disponibles.");
          }
        });
        map.on("moveend", () => {
          if (disposed || !cameraCallback.current) return;
          const center = map.getCenter();
          const shared = latestCamera.current;
          if (shared && Math.abs(center.lng - shared.center[0]) < 0.000001 && Math.abs(center.lat - shared.center[1]) < 0.000001 && Math.abs(map.getZoom() - shared.zoom) < 0.000001) return;
          cameraCallback.current([center.lng, center.lat], map.getZoom());
        });
      } catch {
        cleanup?.(); cleanup = undefined;
        if (!disposed) { setActive(false); setStatus(municipal ? "Mapa no disponible; el contorno y la tabla siguen disponibles." : "Mapa no disponible; los resultados exactos siguen disponibles."); }
      }
    }
    void initialize();
    return () => { disposed = true; cleanup?.(); };
  }, [active, coordinates, name, resultId, municipal, sharePercent, fillColor]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !camera) return;
    const center = map.getCenter();
    if (Math.abs(center.lng - camera.center[0]) < 0.000001 && Math.abs(center.lat - camera.center[1]) < 0.000001 && Math.abs(map.getZoom() - camera.zoom) < 0.000001) return;
    map.jumpTo(camera);
  }, [camera]);

  // Local equirectangular projection with longitude correction at this section's latitude.
  // Preserve every polygon and hole from the verified loader; identical frames on both sides.
  const points = coordinates.flat(2);
  const west = Math.min(...points.map(point => point[0]!));
  const east = Math.max(...points.map(point => point[0]!));
  const south = Math.min(...points.map(point => point[1]!));
  const north = Math.max(...points.map(point => point[1]!));
  const longitudeScale = Math.cos((south + north) / 2 * Math.PI / 180);
  const width = (east - west) * longitudeScale;
  const height = north - south;
  const scale = 260 / Math.max(width, height, Number.EPSILON);
  const project = ([longitude, latitude]: number[]) => `${(160 + ((longitude! - west) * longitudeScale - width / 2) * scale).toFixed(3)},${(160 - (latitude! - south - height / 2) * scale).toFixed(3)}`;
  const fill = fillColor ?? (sharePercent === undefined ? [...REFERENCE_FILL] : shareFill(sharePercent));
  return <div className={styles.root}>
    {!active && staticLabel && <svg className={styles.staticMap} viewBox="0 0 320 320" role="img" aria-label={`Mapa estático de ${name}; ${label}; ${staticLabel}`}>
      {coordinates.map((polygon, index) => <path key={index} d={polygon.map(ring => `M${ring.map(project).join("L")}Z`).join(" ")} fill={`rgba(${fill[0]},${fill[1]},${fill[2]},${fill[3]! / 255})`} fillRule="evenodd" stroke={REFERENCE_COLOR} strokeWidth="1" />)}
    </svg>}
    {fillColor === undefined && sharePercent === undefined && <Legend label="Referencia geográfica" entries={[{ label: "Contorno de referencia; sin resultados electorales", encoding: "outline" }]} />}
    <button type="button" onClick={() => { setStatus("Cargando mapa de la sección…"); setActive(true); }} disabled={active} aria-label={`Activar mapa interactivo de ${label}`}>Mostrar mapa interactivo</button>
    <button type="button" onClick={focusResults}>Seleccionar sección y consultar resultados</button>
    <Alert variant="caveat">{status}</Alert>
    <div ref={container} className={active ? styles.canvas : styles.inactive} aria-label={municipal ? `Mapa geográfico CNE de ${name}; no muestra votos por partido` : `Mapa geográfico CNE de ${name}; ${label}`} />
    <a href={`#${resultId}`} onClick={focusResults}>Ir a los resultados exactos de la sección</a>
  </div>;
}
