"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Map as MapIcon, Target, Check, Plus, Minus, RotateCcw, Info } from "lucide-react";
import { loadSectionReferenceGeometry } from "./circuit-geometry";
import { Alert } from "@/components/ui/alert";
import styles from "./drilldown.module.css";

function SectionReferenceOutline() {
  const [reference, setReference] = useState<Awaited<ReturnType<typeof loadSectionReferenceGeometry>> | undefined>(undefined);
  useEffect(() => {
    let active = true;
    loadSectionReferenceGeometry().then(value => { if (active) setReference(value); }).catch(() => { if (active) setReference(null); });
    return () => { active = false; };
  }, []);
  if (!reference) return <Alert variant="caveat">{reference === undefined ? "Preparando contorno de referencia…" : "Contorno de referencia no disponible; consulte la evidencia exacta."}</Alert>;
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const polygon of reference.geometry.coordinates) for (const ring of polygon) for (const point of ring) {
    west = Math.min(west, point[0]!); east = Math.max(east, point[0]!); south = Math.min(south, point[1]!); north = Math.max(north, point[1]!);
  }
  const aspect = Math.cos((north + south) / 2 * Math.PI / 180);
  const height = 600 * (north - south) / ((east - west) * aspect);
  const path = reference.geometry.coordinates.flat().map(ring => ring.map(([x, y], i) => `${i ? "L" : "M"}${(x! - west) / (east - west) * 600} ${(north - y!) / (north - south) * height}`).join(" ") + " Z").join(" ");
  return <svg className={styles.referenceOutline} viewBox={`-20 -20 640 ${height + 40}`} role="img" aria-label="Contorno de referencia CNE de Coronel Rosales; no geometría de la unidad seleccionada">
    <path d={path} fillRule="evenodd" />
  </svg>;
}

export function TerritorialMapStage({ title, subtitle, referenceRosales = false, children, footer }: {
  title: string; subtitle: string; referenceRosales?: boolean; children?: ReactNode; footer?: ReactNode;
}) {
  const [zoom, setZoom] = useState(100);
  return <section className={styles.mapPanel} aria-label="Mapa territorial de referencia">
    <header className={styles.mapHeading}><div><h2>Ganadores en el territorio</h2><p>{subtitle}</p></div><span className={styles.mapMode}><MapIcon aria-hidden="true" size={14} /> Vista territorial</span></header>
    <div className={styles.mapStage}>
      <span className={styles.coordinate}>Referencia geográfica</span>
      <div className={styles.northMark} role="img" aria-label="Norte"><span>N</span><svg viewBox="0 0 18 30" aria-hidden="true"><path d="m9 2 6 18-6-4-6 4zM9 16v12" /></svg></div>
      <div className={styles.mapCamera} style={{ transform: `scale(${zoom / 100})` }}>{referenceRosales ? <SectionReferenceOutline /> : children}</div>
      <div className={styles.territoryLabel}><Target aria-hidden="true" size={20} /><div><strong>{title}</strong><small>Seleccionado · no cobertura electoral</small></div><Check aria-hidden="true" size={15} /></div>
      <div className={styles.mapControls} role="group" aria-label="Controles de vista">
        <button type="button" aria-label="Acercar mapa" disabled={zoom === 180} onClick={() => setZoom(value => Math.min(180, value + 20))}><Plus aria-hidden="true" size={17} /></button>
        <button type="button" aria-label="Alejar mapa" disabled={zoom === 80} onClick={() => setZoom(value => Math.max(80, value - 20))}><Minus aria-hidden="true" size={17} /></button>
        <button type="button" aria-label="Restablecer vista" onClick={() => setZoom(100)}><RotateCcw aria-hidden="true" size={17} /></button>
      </div>
      <div className={styles.mapScale}><span aria-hidden="true" /><small>Vista de referencia · {zoom} %</small></div>
    </div>
    <footer className={styles.mapFooter}><div><span aria-hidden="true">■</span> Territorio seleccionado<small>Referencia geográfica, no cobertura electoral</small></div><a href="#official-evidence-heading"><Info aria-hidden="true" size={14} /> Ver evidencia</a></footer>
    {footer}
    {referenceRosales && <div className={styles.referenceNote}><p>Geometría de referencia CNE; no certificada como límite electoral 2025. Aplicabilidad electoral desconocida.</p><p>Fuente: CNE · recuperada el 24/09/2026. Contorno ancestro; sin geometría propia para la unidad seleccionada.</p></div>}
  </section>;
}
