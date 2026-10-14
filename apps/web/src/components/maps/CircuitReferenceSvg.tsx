"use client";
import { useId } from "react";
import type { CircuitOutcome } from "@/lib/workspace/official-section-circuit-outcomes";
import { circuitPresentation, circuitBandColor } from "@/lib/geography/circuit-presentation";
import styles from "./circuit-reference.module.css";
export interface CircuitMapProps {
  geometry: { code: string; coordinates: [number, number][][][] }[];
  circuits: CircuitOutcome[];
  selected: string | null;
  onSelect: (code: string) => void;
}
/** SVG clipping draws the exact B∩C shared area without changing either source polygon. */
export function CircuitReferenceSvg({ geometry, circuits, selected, onSelect }: CircuitMapProps) {
  const id = useId().replaceAll(":", ""), hatch = `${id}-hatch`, overlap = `${id}-overlap`;
  const points = geometry.flatMap(c => c.coordinates.flat(2));
  const west = Math.min(...points.map(p => p[0])), east = Math.max(...points.map(p => p[0]));
  const south = Math.min(...points.map(p => p[1])), north = Math.max(...points.map(p => p[1]));
  const height = 600 * (north - south) / ((east - west) * Math.cos((north + south) / 2 * Math.PI / 180));
  const path = (c: CircuitMapProps["geometry"][number]) => c.coordinates.flat().map(ring => ring.map(([x, y], i) =>
    `${i ? "L" : "M"}${(x - west) / (east - west) * 600} ${(north - y) / (north - south) * height}`).join(" ") + " Z").join(" ");
  const b = geometry.find(c => c.code === "0248B"), c = geometry.find(c => c.code === "0248C");
  return <svg className={styles.map} viewBox={`-8 -8 616 ${height + 16}`} role="group" aria-label="Circuitos de Coronel Rosales: geometría de referencia CNE">
    <defs><pattern id={hatch} width="8" height="8" patternUnits="userSpaceOnUse"><path d="M-2 2L2-2M0 8L8 0M6 10L10 6" stroke="currentColor" strokeWidth="1.5" /></pattern>
      {b && <clipPath id={overlap}><path d={path(b)} clipRule="evenodd" /></clipPath>}
    </defs>
    {geometry.map(g => {
      const outcome = circuits.find(c => c.circuito_code === g.code);
      const p = outcome ? circuitPresentation(outcome) : null;
      const name = `Circuito ${g.code}: ${p ? `${p.winner}; ${p.coverage}; margen ${p.margin === null ? "no disponible" : p.margin.toFixed(2) + " pp"}` : "sin resultados"}`;
      return <g key={g.code}>
        <path d={path(g)} fill={p ? circuitBandColor(p.color, p.band) : "var(--surface-muted)"} fillOpacity={1}
          fillRule="evenodd" stroke="currentColor" strokeWidth={selected === g.code ? 3 : 1} vectorEffect="non-scaling-stroke"
          tabIndex={0} role="button" aria-label={name} aria-pressed={selected === g.code} className={styles.unit}
          onClick={() => onSelect(g.code)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(g.code); } }}><title>{name}</title></path>
        {outcome?.status === "partial" && <path d={path(g)} fill={`url(#${hatch})`} fillRule="evenodd" pointerEvents="none" data-hatched="true" />}
      </g>;
    })}
    {b && c && <g clipPath={`url(#${overlap})`} pointerEvents="none" aria-label="0248B/0248C: superposición en la fuente">
      <path d={path(c)} fill="var(--surface-muted)" fillRule="evenodd" />
      <path d={path(c)} fill={`url(#${hatch})`} fillRule="evenodd" data-hatched="true" />
    </g>}
  </svg>;
}
