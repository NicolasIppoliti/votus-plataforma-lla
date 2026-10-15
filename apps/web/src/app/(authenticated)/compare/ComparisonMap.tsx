"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { SectionReferenceMap } from "@/components/maps/SectionReferenceMap";
import { Legend, shareFill, WINNER_COLORS, NEUTRAL_FILL, CHANGE_NEGATIVE, SHARE_COLORS, SHARE_GRADIENT, CHANGE_GRADIENT } from "@/components/maps/reference-colors";
import type { UnitSwing, PartyShare } from "@/lib/results/compare";
import styles from "./comparison.module.css";
import { formatCount, formatFixed2 } from "@/lib/format/number";

export const ComparisonPartyContext = createContext<string | undefined>(undefined);
export type MapMetric = "Participación" | "Cambio" | "Ganadores";
interface Props {
  coordinates: number[][][][];
  name: string;
  fetchedAt: string;
  sha256: string;
  swing: UnitSwing;
  leftNames: Record<string, string>;
  rightNames: Record<string, string>;
}
// Specimen categories, not real-party branding. Sorted winner IDs share colors across sides.
// At section granularity there are at most two displayed winner categories.
const palette = WINNER_COLORS;
const neutral = NEUTRAL_FILL;
function leader(shares: PartyShare[]): PartyShare | undefined {
  const maximum = Math.max(...shares.map(entry => entry.sharePercent));
  const leaders = shares.filter(entry => entry.sharePercent === maximum);
  return shares.reduce((sum, entry) => sum + entry.votes, 0) > 0 && leaders.length === 1 ? leaders[0] : undefined;
}
function Leader({ shares, names }: { shares: PartyShare[]; names: Record<string, string> }) {
  const highest = leader(shares);
  if (!highest) return <p>Mayor participación: observación insuficiente; sin color electoral.</p>;
  return <p>Mayor participación en la sección: {names[highest.party]} — {formatFixed2(highest.sharePercent)} % ({formatCount(highest.votes)} votos de {formatCount(shares.reduce((sum, entry) => sum + entry.votes, 0))} votos partidarios incluidos).</p>;
}
export function ComparisonMap(props: Props) {
  const [metric, setMetric] = useState<MapMetric>("Participación");
  const selected = useContext(ComparisonPartyContext) ?? props.swing.swings[0]?.party ?? "";
  return <ComparisonMapView {...props} party={selected} metric={metric} onMetric={setMetric} />;
}

// Controlled view keeps metric state separate from geometry and synchronized interactive cameras.
export function ComparisonMapView({ coordinates, name, fetchedAt, sha256, swing, leftNames, rightNames, party, metric, onMetric }: Props & { party: string; metric: MapMetric; onMetric: (metric: MapMetric) => void }) {
  const [camera, setCamera] = useState<{ center: [number, number]; zoom: number }>();
  const updateCamera = (center: [number, number], zoom: number) => setCamera(previous => previous && Math.abs(previous.center[0] - center[0]) < 0.000001 && Math.abs(previous.center[1] - center[1]) < 0.000001 && Math.abs(previous.zoom - zoom) < 0.000001 ? previous : { center, zoom });
  const a = swing.shares2023.find(entry => entry.party === party);
  const b = swing.shares2025.find(entry => entry.party === party);
  const ids = useMemo(() => [...new Set([leader(swing.shares2023), leader(swing.shares2025)].flatMap(winner => winner ? [winner.party] : []))].sort(), [swing]);
  const winners = [leader(swing.shares2023), leader(swing.shares2025)];
  const reasons: Record<MapMetric, string | undefined> = {
    Participación: !a || !b ? "Participación no disponible: falta una observación de la agrupación en uno de los lados." : undefined,
    Cambio: !a || !b ? "Cambio no disponible: se requieren observaciones de la agrupación en ambos lados; no se reemplazan ausencias con cero." : undefined,
    Ganadores: winners.some(winner => !winner) ? "Ganadores no disponible: no hay un máximo único por lado." : undefined,
  };
  const change = a && b ? b.sharePercent - a.sharePercent : undefined;
  const fills = useMemo((): [number, number, number, number][] => {
    if (metric === "Participación") return [a, b].map(entry => entry ? shareFill(entry.sharePercent) : neutral);
    if (metric === "Cambio") {
      if (change === undefined) return [neutral, neutral];
      const endpoint = change < 0 ? CHANGE_NEGATIVE : SHARE_COLORS.high;
      const fraction = Math.abs(change) / 100;
      return [neutral, [...endpoint.map((channel, index) => Math.round(neutral[index]! + (channel - neutral[index]!) * fraction)), 255] as [number, number, number, number]];
    }
    return [swing.shares2023, swing.shares2025].map(shares => {
      const winner = leader(shares);
      const color = winner ? palette[ids.indexOf(winner.party)] : undefined;
      return color ? [...color] : neutral;
    });
  }, [metric, a, b, change, swing, ids]);
  const labels = metric === "Participación" ? [a, b].map((entry, index) => entry ? `${index === 0 ? leftNames[party] : rightNames[party]}: ${formatFixed2(entry.sharePercent)} %` : "Observación no disponible") : metric === "Cambio" ? ["Línea de base A; cambio 0,00 pp", change === undefined ? "Observación no disponible" : `${rightNames[party]}: B − A ${change > 0 ? "+" : ""}${formatFixed2(change)} pp`] : winners.map((winner, index) => winner ? `Ganador: ${index === 0 ? leftNames[winner.party] : rightNames[winner.party]}` : "Sin ganador único");
  return <section className={styles.spatial} aria-labelledby="compare-spatial-heading">
    <header className={styles.mapHeader}><h2 id="compare-spatial-heading">Comparación territorial de referencia</h2>
      <div className={styles.metricSwitch} role="group" aria-label="Métrica de los mapas">{(["Participación", "Cambio", "Ganadores"] as const).map(view => <button key={view} type="button" disabled={Boolean(reasons[view])} aria-describedby={reasons[view] ? `metric-reason-${view}` : undefined} aria-pressed={metric === view} onClick={() => onMetric(view)}>{view}</button>)}</div>
    </header>
    {Object.entries(reasons).filter(([, reason]) => reason).map(([view, reason]) => <p key={view} id={`metric-reason-${view}`} role="note">{reason}</p>)}
    <p>Un único contorno para toda la sección 02/027; no representa variaciones dentro de la sección.</p>
    <div className={styles.spatialPair}>{[{ id: "a", label: "Lado A — 2023 generales", shares: swing.shares2023, names: leftNames }, { id: "b", label: "Lado B — 2025 legislativas", shares: swing.shares2025, names: rightNames }].map(({ id, label, shares, names }, index) => <article key={id} aria-label={label}>
      <h3>{label}</h3><p>{labels[index]}</p>
      <SectionReferenceMap compactControls coordinates={coordinates} name={name} label={label} resultId="compare-results-heading" camera={camera} onCamera={updateCamera} fillColor={fills[index]} staticLabel={labels[index]} />
      <details className={styles.sideFigures}><summary>Cifras — Lado {id.toUpperCase()}</summary><p>Denominador: {formatCount(shares.reduce((sum, entry) => sum + entry.votes, 0))} votos partidarios.</p><Leader shares={shares} names={names} /></details>
    </article>)}</div>
    <div className={styles.spatialLegend}><Legend label={metric === "Participación" ? "Escala de color común: 0 % a 100 %" : metric === "Cambio" ? "Escala de cambio: −100 pp a +100 pp" : "Leyenda categórica de ganadores"}>
      {metric === "Participación" ? <><p>Escala común 0–100 % de votos partidarios incluidos en cada selección; no representa el padrón ni todos los votos emitidos. Participación de la agrupación seleccionada.</p><div className={styles.spatialGradient} style={{ background: SHARE_GRADIENT }} aria-hidden="true" /><div className={styles.spatialTicks}><span>0 %</span><span>50 %</span><span>100 %</span></div></> : metric === "Cambio" ? <><p>Cambio B − A de la agrupación seleccionada, en puntos porcentuales. A muestra la línea de base, no su participación.</p><div className={styles.spatialGradient} style={{ background: CHANGE_GRADIENT }} aria-hidden="true" /><div className={styles.spatialTicks}><span>−100 pp</span><span>0 pp</span><span>+100 pp</span></div></> : <><p>Mayor participación del partido canónico por elección. Paleta categórica, no colores partidarios ni escala de magnitud.</p>{winners.map((winner, index) => winner && <p key={index}><span className={styles.swatch} style={{ background: `rgb(${fills[index]!.slice(0, 3).join(",")})` }} aria-hidden="true" />{index === 0 ? "A" : "B"}: {index === 0 ? leftNames[winner.party] : rightNames[winner.party]}</p>)}</>}
    </Legend></div>
    <p className={styles.provenance}>Referencia geográfica oficial CNE actual, archivada el <time dateTime={fetchedAt}>{fetchedAt.slice(0, 10)}</time>; no certifica límites históricos. SHA-256 {sha256}.</p>
  </section>;
}
