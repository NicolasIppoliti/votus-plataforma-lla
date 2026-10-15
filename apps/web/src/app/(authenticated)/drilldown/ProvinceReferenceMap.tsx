"use client";

import { useEffect, useState } from "react";
import { REFERENCE_STYLE, Legend } from "@/components/maps/reference-colors";
import styles from "./drilldown.module.css";

interface ProvinceFeature {
  type: "Feature";
  properties: Record<string, never>;
  geometry: { type: "MultiPolygon"; coordinates: number[][][][] };
}

/** Public, verified IGN ancestor reference; no child areas or electoral figures are inferred. */
export function ProvinceReferenceMap() {
  const [path, setPath] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/geography/buenos-aires", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("reference unavailable");
        const feature = await response.json() as ProvinceFeature;
        let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
        for (const polygon of feature.geometry.coordinates) for (const ring of polygon) for (const [lon, lat] of ring) {
          west = Math.min(west, lon!); east = Math.max(east, lon!);
          south = Math.min(south, lat!); north = Math.max(north, lat!);
        }
        if (![west, east, south, north].every(Number.isFinite) || east <= west || north <= south) throw new Error("invalid reference");
        const aspect = Math.cos((north + south) / 2 * Math.PI / 180);
        const width = 600 * (east - west) * aspect / (north - south);
        const d = feature.geometry.coordinates.flat().map(ring => ring.map(([x, y], i) => `${i ? "L" : "M"}${(600 - width) / 2 + (x! - west) / (east - west) * width} ${(north - y!) / (north - south) * 600}`).join(" ") + " Z").join(" ");
        if (!controller.signal.aborted) setPath(d);
      } catch { if (!controller.signal.aborted) setFailed(true); }
    }
    void load();
    return () => controller.abort();
  }, []);
  return path ? <><svg className={styles.referenceOutline} viewBox="-20 -20 640 640" role="img" aria-label="Contorno de referencia IGN de Buenos Aires; sin resultados electorales"><path d={path} style={REFERENCE_STYLE} fillRule="evenodd" /></svg><Legend label="Referencia provincial" entries={[{ label: "Contorno de referencia IGN; sin resultados electorales", encoding: "outline" }]} /></>
    : <p role="status">{failed ? "Contorno de referencia no disponible; consulte la evidencia exacta." : "Preparando contorno de referencia provincial…"}</p>;
}
