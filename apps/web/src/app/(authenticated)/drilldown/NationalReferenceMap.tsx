"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./drilldown.module.css";
import { NATIONAL_REFERENCE_PATH, loadNationalReference, polarReferencePath, type ReferenceFeature } from "./national-reference-geometry";

export function NationalReferenceMap() {
  const canvas = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [feature, setFeature] = useState<ReferenceFeature | null>(null);
  const [polarPath, setPolarPath] = useState("");
  const [status, setStatus] = useState("Mapa opcional. Podés ir a Buenos Aires o usar los selectores sin WebGL.");
  const [continentalStatus, setContinentalStatus] = useState("Mapa continental aún no activado.");
  const [retry, setRetry] = useState(0);
  const [continentalRetry, setContinentalRetry] = useState(0);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let disposed = false;
    void loadNationalReference(controller.signal).then(async (verified) => {
      if (disposed) return;
      const projected = await polarReferencePath(verified);
      if (disposed) return;
      setFeature(verified);
      setPolarPath(projected);
      setStatus("Referencia IGN verificada. Ambas vistas son geográficas; ninguna muestra votos.");
    }).catch(() => {
      if (!disposed) { setFeature(null); setPolarPath(""); setStatus("No se pudo verificar la referencia IGN. Reintentá; los selectores siguen disponibles."); }
    });
    return () => { disposed = true; controller.abort(); };
  }, [active, retry]);

  useEffect(() => {
    if (!feature || !canvas.current) return;
    const verifiedFeature = feature;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    async function renderContinental() {
      try {
        if (!document.createElement("canvas").getContext("webgl2")) throw new Error("WebGL unavailable");
        await import("maplibre-gl/dist/maplibre-gl.css");
        const [maplibregl, { MapLibreOverlay }, { GeoJsonLayer }] = await Promise.all([
          import("maplibre-gl"), import("@deck.gl/maplibre"), import("@deck.gl/layers"),
        ]);
        if (disposed || !canvas.current) return;
        const map = new maplibregl.Map({
          container: canvas.current, style: { version: 8, sources: {}, layers: [] },
          center: [-64, -39], zoom: 2.8, attributionControl: false,
        });
        let loaded = false;
        const fitContinentalBounds = (duration: number) => map.fitBounds([[-74, -56], [-53, -21]], { padding: 24, duration });
        const observer = new ResizeObserver(() => {
          if (!loaded || disposed) return;
          map.resize();
          fitContinentalBounds(0);
        });
        observer.observe(canvas.current);
        cleanup = () => { observer.disconnect(); map.remove(); };
        map.on("error", () => { if (!disposed) { cleanup?.(); cleanup = undefined; setContinentalStatus("Mapa continental no disponible. La vista polar y los selectores siguen disponibles."); } });
        map.on("load", () => {
          if (disposed) return;
          try {
            // The continental window is a viewport, not a filtered data source: retain every polygon.
            map.addControl(new MapLibreOverlay({ layers: [new GeoJsonLayer({
              id: "ign-argentina-reference", data: verifiedFeature, filled: true, stroked: true,
              getFillColor: [37, 88, 120, 45], getLineColor: [27, 69, 96, 255],
              getLineWidth: 1, lineWidthMinPixels: 1, pickable: false,
            })] }));
            loaded = true;
            fitContinentalBounds(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 300);
            setContinentalStatus("Vista continental disponible; el territorio fuera del encuadre se muestra en la vista polar.");
          } catch {
            cleanup?.(); cleanup = undefined;
            setContinentalStatus("Mapa continental no disponible. La vista polar y los selectores siguen disponibles.");
          }
        });
      } catch {
        if (!disposed) setContinentalStatus("WebGL no disponible. La vista polar y los selectores siguen disponibles.");
      }
    }
    void renderContinental();
    return () => { disposed = true; cleanup?.(); };
  }, [feature, continentalRetry]);

  return <div className={styles.nationalMap}>
    {!active || !feature ? <button type="button" onClick={() => { setStatus("Cargando y verificando referencia geográfica…"); setContinentalStatus("Cargando vista continental…"); setActive(true); setRetry((value) => value + 1); }}>
      {active ? "Reintentar mapa nacional" : "Mostrar referencia nacional"}
    </button> : null}
    <p role="status">{status}</p>
    {active ? <div className={styles.nationalViews}>
      <section aria-labelledby="continental-heading">
        <h3 id="continental-heading">Vista continental americana</h3>
        <p>Encuadre de orientación de América continental; no incluye visualmente toda la extensión IGN.</p>
        <div ref={canvas} className={styles.nationalCanvas} aria-label="Mapa continental de referencia IGN, sin resultados electorales" />
        <p role="status">{continentalStatus}</p>
        {continentalStatus.includes("no disponible") || continentalStatus.includes("WebGL no disponible")
          ? <button type="button" onClick={() => { setContinentalStatus("Reintentando vista continental…"); setContinentalRetry((value) => value + 1); }}>Reintentar vista continental</button>
          : null}
      </section>
      <section aria-labelledby="polar-heading">
        <h3 id="polar-heading">Vista completa desde el polo sur</h3>
        <p>Proyección azimutal equivalente independiente, a otra escala. Incluye los 1980 componentes de la referencia IGN; no representa cobertura electoral.</p>
        {polarPath ? <svg viewBox="0 0 400 400" role="img" aria-label="Extensión completa de la referencia IGN en proyección polar, sin resultados electorales" className={styles.polarMap}>
          <path d={polarPath} fillRule="evenodd" />
        </svg> : <p>La vista polar estará disponible cuando se verifique la geometría.</p>}
      </section>
    </div> : null}
    <p className={styles.attribution}>Fuente: IGN · Derivado simplificado de referencia ({NATIONAL_REFERENCE_PATH.split(".")[1]}). Precisión cartográfica derivada; no son límites electorales.</p>
    <a href="#province-reference-heading">Ir a Buenos Aires</a>
    <a href="#national-reference-heading">Volver a Argentina</a>
    <a href="#explorer-election" onClick={() => document.getElementById("explorer-election")?.focus()}>Ir a la selección electoral exacta</a>
  </div>;
}
