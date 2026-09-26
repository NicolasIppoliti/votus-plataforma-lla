"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./municipal.module.css";

interface Props {
  coordinates: number[][][][];
  name: string;
}

export function MunicipalSectionMap({ coordinates, name }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState("Mapa opcional: el contorno y la tabla están disponibles sin interacción.");

  function focusResults() {
    document.getElementById("municipal-results-heading")?.focus();
    setStatus(`Sección ${name} seleccionada. Resultados exactos en la tabla.`);
  }

  useEffect(() => {
    if (!active || !container.current) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    async function initialize() {
      try {
        const canvas = document.createElement("canvas");
        if (!canvas.getContext("webgl2")) throw new Error("WebGL no disponible");
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
        const map = new maplibregl.Map({
          container: container.current,
          style: { version: 8, sources: {}, layers: [] },
          center: [(west + east) / 2, (south + north) / 2], zoom: 8,
          attributionControl: false,
        });
        cleanup = () => map.remove();
        const overlay = new MapLibreOverlay({ layers: [new GeoJsonLayer({
          id: "cne-section-outline",
          data: { type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates } },
          stroked: true, filled: true, getFillColor: [37, 88, 120, 45],
          getLineColor: [27, 69, 96, 255], getLineWidth: 2, lineWidthMinPixels: 2,
          pickable: true, onClick: focusResults,
        })] });
        map.on("error", () => { if (!disposed) { cleanup?.(); cleanup = undefined; setActive(false); setStatus("No se pudo mostrar el mapa; el contorno y la tabla siguen disponibles."); } });
        map.on("load", () => {
          if (disposed) return;
          try {
            map.addControl(overlay);
            map.fitBounds([[west, south], [east, north]], { padding: 24, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 300 });
            setStatus(`Mapa de la sección ${name} disponible. Sin resultados por partido en el mapa.`);
          } catch {
            cleanup?.(); cleanup = undefined;
            setActive(false);
            setStatus("No se pudo mostrar el mapa; el contorno y la tabla siguen disponibles.");
          }
        });
      } catch {
        cleanup?.(); cleanup = undefined;
        if (!disposed) { setActive(false); setStatus("Mapa no disponible; el contorno y la tabla siguen disponibles."); }
      }
    }
    void initialize();
    return () => { disposed = true; cleanup?.(); };
  }, [active, coordinates, name]);

  return <div className={styles.mapEnhancement}>
    <button type="button" onClick={() => { setStatus("Cargando mapa de la sección…"); setActive(true); }} disabled={active} aria-label="Activar mapa interactivo de la sección">Mostrar mapa interactivo</button>
    <button type="button" onClick={focusResults}>Seleccionar sección y consultar resultados</button>
    <p role="status">{status}</p>
    <div ref={container} className={active ? styles.mapCanvas : styles.mapInactive} aria-label={`Mapa geográfico CNE de ${name}; no muestra votos por partido`} />
    <a href="#municipal-results-heading" onClick={focusResults}>Ir a los resultados exactos de la sección</a>
  </div>;
}
