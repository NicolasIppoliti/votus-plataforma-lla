"use client";

import { useEffect, useState } from "react";
import { loadSectionReferenceGeometry } from "../drilldown/circuit-geometry";
import house from "../drilldown/drilldown.module.css";
import { Alert } from "@/components/ui/alert";
import styles from "./evidence.module.css";

/** Availability qualifies a selected section, never the electoral validity of its reference outline. */
export function EvidenceMap({ rosales, title, availability }: { rosales: boolean; title: string; availability: "complete" | "partial" | "unknown" | "unavailable" }) {
  const [reference, setReference] = useState<Awaited<ReturnType<typeof loadSectionReferenceGeometry>> | undefined>();
  useEffect(() => {
    if (!rosales) return;
    let active = true;
    loadSectionReferenceGeometry().then(value => { if (active) setReference(value); }).catch(() => { if (active) setReference(null); });
    return () => { active = false; };
  }, [rosales]);
  let drawing;
  if (!rosales) drawing = <Alert variant="caveat">Referencia geográfica no disponible para esta selección. Consulte las unidades y la evidencia exacta.</Alert>;
  else if (!reference) drawing = <Alert variant="caveat">{reference === undefined ? "Preparando contorno de referencia…" : "Contorno de referencia no disponible; consulte la evidencia exacta."}</Alert>;
  else {
    const points = reference.geometry.coordinates.flat(2);
    const west = Math.min(...points.map(p => p[0]!)), east = Math.max(...points.map(p => p[0]!));
    const south = Math.min(...points.map(p => p[1]!)), north = Math.max(...points.map(p => p[1]!));
    const height = 600 * (north - south) / ((east - west) * Math.cos((north + south) / 2 * Math.PI / 180));
    const path = reference.geometry.coordinates.flat().map(ring => ring.map(([x, y], index) => `${index ? "L" : "M"}${(x! - west) / (east - west) * 600} ${(north - y!) / (north - south) * height}`).join(" ") + " Z").join(" ");
    drawing = <svg viewBox={`-30 -30 660 ${height + 60}`} role="img" aria-label={`Referencia CNE de ${title}; completitud ${availability === "complete" ? "completa" : availability === "partial" ? "parcial" : availability === "unavailable" ? "no disponible" : "desconocida"} de la sección, no validez electoral del límite`}>
      <path d={path} fillRule="evenodd" className={styles[availability === "unavailable" ? "unknown" : availability]} />
    </svg>;
  }
  return <div className={`${house.mapStage} ${styles.mapStage}`}><div className={styles.mapDrawing}>{drawing}</div></div>;
}
