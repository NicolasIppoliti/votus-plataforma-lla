"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./SectionReferenceMap.module.css";

// Fixed 0–100% domain; legend and layer use these same stops.
export const SHARE_COLORS = { low: [230, 241, 247], high: [18, 75, 110] } as const;
export function shareFill(percent: number): [number, number, number, number] {
  const fraction = Math.max(0, Math.min(100, percent)) / 100;
  return [0, 1, 2].map((index) => Math.round(SHARE_COLORS.low[index]! + (SHARE_COLORS.high[index]! - SHARE_COLORS.low[index]!) * fraction)).concat(220) as [number, number, number, number];
}

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
}

export function SectionReferenceMap({ coordinates, name, label, resultId, onCamera, camera, onSelect, municipal = false, sharePercent }: Props) {
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
    else document.getElementById(resultId)?.focus();
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
          stroked: true, filled: true, getFillColor: sharePercent === undefined ? [37, 88, 120, 45] : shareFill(sharePercent),
          getLineColor: [27, 69, 96, 255], getLineWidth: 2, lineWidthMinPixels: 2,
          pickable: true, onClick: () => {
            if (selectCallback.current) selectCallback.current();
            else document.getElementById(resultId)?.focus();
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
  }, [active, coordinates, name, resultId, municipal, sharePercent]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !camera) return;
    const center = map.getCenter();
    if (Math.abs(center.lng - camera.center[0]) < 0.000001 && Math.abs(center.lat - camera.center[1]) < 0.000001 && Math.abs(map.getZoom() - camera.zoom) < 0.000001) return;
    map.jumpTo(camera);
  }, [camera]);

  return <div className={styles.root}>
    <button type="button" onClick={() => { setStatus("Cargando mapa de la sección…"); setActive(true); }} disabled={active} aria-label={`Activar mapa interactivo de ${label}`}>Mostrar mapa interactivo</button>
    <button type="button" onClick={focusResults}>Seleccionar sección y consultar resultados</button>
    <p role="status">{status}</p>
    <div ref={container} className={active ? styles.canvas : styles.inactive} aria-label={municipal ? `Mapa geográfico CNE de ${name}; no muestra votos por partido` : `Mapa geográfico CNE de ${name}; ${label}`} />
    <a href={`#${resultId}`} onClick={focusResults}>Ir a los resultados exactos de la sección</a>
  </div>;
}
