"use client";

import { useState } from "react";
import { SectionReferenceMap, SHARE_COLORS } from "@/components/maps/SectionReferenceMap";
import type { UnitSwing, PartyShare } from "@/lib/results/compare";
import styles from "./comparison.module.css";

interface Props {
  coordinates: number[][][][];
  name: string;
  fetchedAt: string;
  sha256: string;
  swing: UnitSwing;
  leftNames: Record<string, string>;
  rightNames: Record<string, string>;
}

const percent = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const count = new Intl.NumberFormat("es-AR");

function leader(shares: PartyShare[]): PartyShare | undefined {
  const total = shares.reduce((sum, entry) => sum + entry.votes, 0);
  if (total === 0) return undefined;
  return shares.reduce<PartyShare | undefined>((highest, entry) => !highest || entry.votes > highest.votes ? entry : highest, undefined);
}

function Leader({ shares, names }: { shares: PartyShare[]; names: Record<string, string> }) {
  const highest = leader(shares);
  if (!highest) return <p>Mayor participación: observación insuficiente; sin color electoral.</p>;
  const total = shares.reduce((sum, entry) => sum + entry.votes, 0);
  return <p>Mayor participación en la sección: {names[highest.party]} — {percent.format(highest.sharePercent)} % ({count.format(highest.votes)} votos de {count.format(total)} votos partidarios incluidos).</p>;
}

export function ComparisonMap({ coordinates, name, fetchedAt, sha256, swing, leftNames, rightNames }: Props) {
  const [camera, setCamera] = useState<{ center: [number, number]; zoom: number }>();
  const updateCamera = (center: [number, number], zoom: number) => setCamera((previous) =>
    previous && Math.abs(previous.center[0] - center[0]) < 0.000001 && Math.abs(previous.center[1] - center[1]) < 0.000001 && Math.abs(previous.zoom - zoom) < 0.000001 ? previous : { center, zoom });
  const sides = [
    { id: "a", label: "Lado A — 2023 generales", shares: swing.shares2023, names: leftNames },
    { id: "b", label: "Lado B — 2025 legislativas", shares: swing.shares2025, names: rightNames },
  ];
  return <section className={styles.spatial} aria-labelledby="compare-spatial-heading">
    <h2 id="compare-spatial-heading">Comparación territorial de referencia</h2>
    <p>Un único contorno para toda la sección 02/027; no representa variaciones dentro de la sección. Escala común 0–100 % de votos partidarios incluidos en cada selección; no representa el padrón ni todos los votos emitidos.</p>
    <div className={styles.spatialLegend} aria-label="Escala de color común: 0 % a 100 %">
      <p>Mayor participación del partido canónico por elección. El color representa porcentaje, no identidad partidaria; los partidos pueden ser distintos.</p>
      <div className={styles.spatialGradient} style={{ background: `linear-gradient(to right, rgb(${SHARE_COLORS.low.join(",")}), rgb(${SHARE_COLORS.high.join(",")}))` }} aria-hidden="true" /><div className={styles.spatialTicks}><span>0 %</span><span>50 %</span><span>100 %</span></div>
    </div>
    <p>Referencia geográfica oficial CNE actual, archivada el <time dateTime={fetchedAt}>{fetchedAt.slice(0, 10)}</time>; no certifica límites históricos. SHA-256 {sha256}.</p>
    <div className={styles.spatialPair}>
      {sides.map(({ id, label, shares, names }) => <article key={id} aria-label={label}>
        <h3>{label}</h3>
        <p>Denominador: {count.format(shares.reduce((sum, share) => sum + share.votes, 0))} votos partidarios.</p>
        <Leader shares={shares} names={names} />
        <SectionReferenceMap coordinates={coordinates} name={name} label={label} resultId="compare-results-heading" camera={camera} onCamera={updateCamera} sharePercent={leader(shares)?.sharePercent} />
      </article>)}
    </div>
  </section>;
}
