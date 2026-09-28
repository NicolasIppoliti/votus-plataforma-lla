"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./drilldown.module.css";

interface ProvinceFeature {
  type: "Feature";
  properties: Record<string, never>;
  geometry: { type: "MultiPolygon"; coordinates: number[][][][] };
}

export function ProvinceReferenceMap() {
  const container = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState("Mapa opcional; los selectores funcionan sin él.");

  useEffect(() => {
    if (!active || !container.current) return;
    const controller = new AbortController();
    let disposed = false;
    let cleanup: (() => void) | undefined;
    async function initialize() {
      try {
        const response = await fetch("/api/geography/buenos-aires", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("geometry unavailable");
        const feature = await response.json() as ProvinceFeature;
        if (disposed || !container.current) return;
        if (!document.createElement("canvas").getContext("webgl2")) throw new Error("WebGL unavailable");
        await import("maplibre-gl/dist/maplibre-gl.css");
        const [maplibregl, { MapLibreOverlay }, { GeoJsonLayer }] = await Promise.all([
          import("maplibre-gl"), import("@deck.gl/maplibre"), import("@deck.gl/layers"),
        ]);
        if (disposed || !container.current) return;
        // Bounded accumulation: never spread hundreds of thousands of points into Math.min/max.
        let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
        for (const polygon of feature.geometry.coordinates) for (const ring of polygon) for (const [lon, lat] of ring) {
          west = Math.min(west, lon!); east = Math.max(east, lon!);
          south = Math.min(south, lat!); north = Math.max(north, lat!);
        }
        if (![west, east, south, north].every(Number.isFinite)) throw new Error("invalid bounds");
        const map = new maplibregl.Map({
          container: container.current, style: { version: 8, sources: {}, layers: [] },
          center: [(west + east) / 2, (south + north) / 2], zoom: 5, attributionControl: false,
        });
        cleanup = () => map.remove();
        map.on("error", () => { if (!disposed) { cleanup?.(); cleanup = undefined; setActive(false); setStatus("No se pudo mostrar el mapa. Usá los selectores para continuar."); } });
        map.on("load", () => {
          if (disposed) return;
          try {
            map.addControl(new MapLibreOverlay({ layers: [new GeoJsonLayer({
              id: "ign-buenos-aires-reference", data: feature, stroked: true, filled: true,
              getFillColor: [37, 88, 120, 45], getLineColor: [27, 69, 96, 255],
              getLineWidth: 2, lineWidthMinPixels: 2, pickable: true,
              onClick: () => { document.getElementById("explorer-election")?.focus(); setStatus("Elegí una elección y una categoría para continuar hacia Coronel Rosales."); },
            })] }));
            map.fitBounds([[west, south], [east, north]], { padding: 24, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 300 });
            setStatus("Contorno geográfico de Buenos Aires disponible; no muestra resultados electorales.");
          } catch {
            cleanup?.(); cleanup = undefined; setActive(false);
            setStatus("No se pudo mostrar el mapa. Usá los selectores para continuar.");
          }
        });
      } catch {
        cleanup?.(); cleanup = undefined;
        if (!disposed) { setActive(false); setStatus("Mapa no disponible. Usá los selectores para continuar."); }
      }
    }
    void initialize();
    return () => { disposed = true; controller.abort(); cleanup?.(); };
  }, [active]);

  return <div className={styles.provinceMap}>
    <button type="button" disabled={active} onClick={() => { setStatus("Cargando contorno provincial…"); setActive(true); }}>Mostrar mapa geográfico</button>
    <p role="status">{status}</p>
    <div ref={container} className={active ? styles.provinceCanvas : styles.provinceInactive} aria-label="Mapa geográfico de Buenos Aires sin resultados electorales" />
    <a href="#explorer-election">Continuar con los selectores</a>
  </div>;
}
