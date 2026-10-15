"use client";
import { ResponsiveSelect } from "@/components/ResponsiveSelect";

import { useState, type ReactNode } from "react";
import type { UnitSwing } from "@/lib/results/compare";
import type { OfficialSectionCompleteness } from "@/lib/workspace/official-section-completeness";
import house from "../drilldown/drilldown.module.css";
import styles from "./comparison.module.css";
import { ComparisonChildren } from "./ComparisonChildren";
import { ComparisonPartyContext } from "./ComparisonMap";
import type { OfficialSectionCircuitOutcomes } from "@/lib/workspace/official-section-circuit-outcomes";
import { formatCount, formatFixed2 } from "@/lib/format/number";

const share = (value: number) => `${formatFixed2(value)} %`;
const delta = (value: number) => `${value > 0 ? "+" : ""}${formatFixed2(value)} pp`;
const votes = (value: number) => `${value > 0 ? "+" : ""}${formatCount(value)} votos`;

function Completeness({ value, side }: { value: OfficialSectionCompleteness; side: string }) {
  if (value.status === "unavailable") return <p>{side}: Completitud no disponible.</p>;
  if (value.status === "unknown") return <p>{side}: Completitud desconocida — {value.reason === "no_expected_catalogue" ? "sin catálogo oficial de mesas esperadas; no equivale a 100 %." : `sección ausente del catálogo; ${value.unlisted_status_mesas} mesas con estado, ${value.quarantined_mesas} en cuarentena y ${value.unattributed_quarantined} cuarentenas sin atribución.`}</p>;
  const n = value.counts;
  return <p>{side}: {value.status === "complete" ? "Completa" : "Parcial"} · {n.counted} de {n.expected} mesas escrutadas; {n.not_counted} no escrutadas, {n.missing} faltantes, {n.unexpected} inesperadas, {n.quarantined} en cuarentena y {n.unattributed_quarantined} cuarentenas sin atribución. Catálogo esperado para las categorías que la fuente informa en el distrito.</p>;
}

export function ComparisonWorkbench({ territory, swing, leftNames, rightNames, maps, completeness, outcomes, exactResults }: {
  territory: string; swing: UnitSwing; leftNames: Record<string, string>; rightNames: Record<string, string>;
  maps: ReactNode; exactResults: ReactNode; completeness: [OfficialSectionCompleteness, OfficialSectionCompleteness];
  outcomes: [OfficialSectionCircuitOutcomes, OfficialSectionCircuitOutcomes];
}) {
  const [party, setParty] = useState(swing.swings[0]?.party ?? "");
  const a = swing.shares2023.find(entry => entry.party === party);
  const b = swing.shares2025.find(entry => entry.party === party);
  return <><section className={house.workbench} aria-label="Mesa de comparación territorial">
    <div className={house.mapPanel}><ComparisonPartyContext.Provider value={party}>{maps}</ComparisonPartyContext.Provider></div>
    <aside className={house.inspector} aria-label="Detalle de comparación">
      <div className={house.detailTop}><span>Territorio compartido</span><span className={house.levelBadge}>Sección</span></div>
      <h2>{territory}</h2><p className={house.detailSubtitle}>Dos elecciones oficiales · mismo alcance autorizado</p>
      <section className={house.navigator} aria-label="Navegador territorial">
        <div className={house.navigatorLabel}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" aria-hidden="true"><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16m6-14v16" /></svg> Navegador territorial</div>
        <h3>Circuitos del territorio</h3>
        <p className={house.navigatorEmpty}>El recorrido comparativo termina en la sección. Los circuitos con pertenencia oficial en ambos lados se detallan abajo; no se inventan establecimientos ni mesas comparadas.</p>
        <a className={styles.evidenceLink} href="#compare-child-heading">Consultar siguiente nivel <span aria-hidden="true">›</span></a>
      </section>
      <section className={styles.selectedAnalytics} aria-label="Participación de la agrupación seleccionada">
        <label htmlFor="compare-party">Agrupación</label>
        <ResponsiveSelect id="compare-party" value={party} onChange={event => setParty(event.target.value)}>{swing.swings.map(entry => <option key={entry.party} value={entry.party}>{leftNames[entry.party]} / {rightNames[entry.party]}</option>)}</ResponsiveSelect>
        <div className={styles.pairedFigures}>{[{ value: a, label: "A · 2023", names: leftNames, total: swing.shares2023 }, { value: b, label: "B · 2025", names: rightNames, total: swing.shares2025 }].map(({ value, label, names, total }) => <div key={label}>
          <span>{label}</span><p>{names[party]}</p><strong>{value ? share(value.sharePercent) : "Observación no disponible"}</strong><small>Participación sobre votos partidarios incluidos</small>
          <dl><dt>Votos de agrupación</dt><dd>{value ? formatCount(value.votes) : "Observación no disponible"}</dd><dt>Total incluido</dt><dd>{formatCount(total.reduce((sum, entry) => sum + entry.votes, 0))}</dd></dl>
        </div>)}</div>
        <div className={styles.deltaReading}><span>Cambio B − A</span><strong>{a && b ? delta(b.sharePercent - a.sharePercent) : "Observación no disponible"}</strong><small>Puntos porcentuales, no crecimiento porcentual.</small><span>Votos B − A</span><p>{a && b ? votes(b.votes - a.votes) : "Observación no disponible"}</p></div>
      </section>
      <section className={styles.coverage} aria-label="Completitud oficial por lado"><h3>Completitud de la sección</h3><Completeness value={completeness[0]} side="Lado A" /><Completeness value={completeness[1]} side="Lado B" /></section>
      <p className={house.navigatorEmpty}>Las referencias actuales no certifican límites históricos ni transferencia de votos. Participación y Cambio describen la agrupación seleccionada; Ganadores considera todos los partidos canónicos.</p>
      <a className={styles.evidenceLink} href="#compare-evidence-heading">Ver evidencia oficial</a>
    </aside>
  </section>{exactResults}<ComparisonChildren outcomes={outcomes} party={party} /></>;
}
