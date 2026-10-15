"use client";
import { useId } from "react";
import type { CircuitOutcome } from "@/lib/workspace/official-section-circuit-outcomes";
import { circuitPresentation } from "@/lib/geography/circuit-presentation";
import { circuitBandColor, MARGIN_BANDS, NEUTRAL_COLOR, REFERENCE_COLOR, Legend } from "./reference-colors";
import styles from "./circuit-reference.module.css";
import { formatFixed2 } from "@/lib/format/number";
export interface CircuitMapProps {
  geometry: { code: string; coordinates: [number, number][][][] }[];
  circuits: CircuitOutcome[];
  selected: string | null;
  highlighted?: string | null;
  onSelect?: (code: string) => void;
}
/** SVG clipping draws the exact B∩C shared area without changing either source polygon. */
export function CircuitReferenceSvg({ geometry, circuits, selected, highlighted = null, onSelect }: CircuitMapProps) {
  const id = useId().replaceAll(":", ""), hatch = `${id}-hatch`, overlap = `${id}-overlap`;
  const points = geometry.flatMap(c => c.coordinates.flat(2));
  const west = Math.min(...points.map(p => p[0])), east = Math.max(...points.map(p => p[0]));
  const south = Math.min(...points.map(p => p[1])), north = Math.max(...points.map(p => p[1]));
  const height = 600 * (north - south) / ((east - west) * Math.cos((north + south) / 2 * Math.PI / 180));
  const path = (c: CircuitMapProps["geometry"][number]) => c.coordinates.flat().map(ring => ring.map(([x, y], i) =>
    `${i ? "L" : "M"}${(x - west) / (east - west) * 600} ${(north - y) / (north - south) * height}`).join(" ") + " Z").join(" ");
  const b = geometry.find(c => c.code === "0248B"), c = geometry.find(c => c.code === "0248C");
  return <><svg className={styles.map} viewBox={`-8 -8 616 ${height + 16}`} role="group" aria-label="Circuitos de Coronel Rosales: geometría de referencia CNE">
    <defs><pattern id={hatch} width="8" height="8" patternUnits="userSpaceOnUse"><path d="M-2 2L2-2M0 8L8 0M6 10L10 6" stroke={REFERENCE_COLOR} strokeWidth="1.5" /></pattern>
      {b && <clipPath id={overlap}><path d={path(b)} clipRule="evenodd" /></clipPath>}
    </defs>
    {geometry.map(g => {
      const outcome = circuits.find(c => c.circuito_code === g.code);
      const p = outcome ? circuitPresentation(outcome) : null;
      const name = `Circuito ${g.code}: ${p ? `${p.winner}; ${p.coverage}; margen ${p.margin === null ? "no disponible" : formatFixed2(p.margin) + " pp"}` : "sin resultados"}`;
      const accessibility = onSelect
        ? { role: "button" as const, tabIndex: 0, "aria-pressed": selected === g.code }
        : { role: "img" as const };
      return <g key={g.code}>
        <path d={path(g)} fill={p ? circuitBandColor(p.color, p.band) : NEUTRAL_COLOR} fillOpacity={1}
          fillRule="evenodd" stroke={REFERENCE_COLOR} strokeWidth={selected === g.code || highlighted === g.code ? 3 : 1} vectorEffect="non-scaling-stroke"
          {...accessibility} aria-label={name} className={styles.unit}
          onClick={onSelect ? () => onSelect(g.code) : undefined} onKeyDown={onSelect ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(g.code); } } : undefined}><title>{name}</title></path>
        {outcome?.status === "partial" && <path d={path(g)} fill={`url(#${hatch})`} fillRule="evenodd" pointerEvents="none" data-hatched="true" />}
      </g>;
    })}
    {b && c && <g clipPath={`url(#${overlap})`} pointerEvents="none" aria-label="0248B/0248C: superposición en la fuente">
      <path d={path(c)} fill={NEUTRAL_COLOR} fillRule="evenodd" />
      <path d={path(c)} fill={`url(#${hatch})`} fillRule="evenodd" data-hatched="true" />
    </g>}
  </svg><Legend label="Codificación de circuitos" entries={[
    { label: "Relleno: ganador y margen; neutro sin resultado atribuible", encoding: "fill", color: NEUTRAL_COLOR },
    { label: `Margen sobre votos positivos: claro < ${MARGIN_BANDS.light.below} pp; medio ${MARGIN_BANDS.light.below}–${MARGIN_BANDS.medium.through} pp; intenso > ${MARGIN_BANDS.medium.through} pp`, encoding: "fill", color: REFERENCE_COLOR },
    { label: "Rayado: escrutinio provisorio o superposición en la fuente", encoding: "hatch" },
    { label: "Contorno de referencia CNE", encoding: "outline" },
  ]} /></>;
}
