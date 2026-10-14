import type { CSSProperties, ReactNode } from "react";
import type { AllocationResult } from "@/domain/seat-allocation/types";
import type { ProjectionInput } from "./projection-input";

const COLORS = ["#65e5f2", "#aac0f1", "#efc58c", "#769598"];
const format = (value: number) => new Intl.NumberFormat("es-AR").format(value);
const seats = (result: AllocationResult, id: string) => result.seatAwards.filter((award) => award.listId === id).length;

export function RenewalStrip({ result, children }: { result: AllocationResult; children?: ReactNode }) {
  const awarded = result.seatAwards.length;
  const canDraw = result.seatsToFill <= 60 && result.seatsToFill * result.results.length <= 600;
  return (
    <section className="simulation-renewal" aria-label={`Bancas calculadas: ${awarded} de ${result.seatsToFill}`}>
      <h3>{result.level === "pba_municipal" ? "Impacto en la renovación" : "Bancas de la unidad de reparto"}</h3>
      <p className="simulation-renewal__method">{result.level === "national" ? "D’Hondt · Ley 19.945, art. 161" : "Hare y mayor residuo · Ley 5109, arts. 109–110"}</p>
      <p>{result.level === "pba_municipal" ? "Divisor Hare: 9 bancas renovadas, no 18 bancas totales" : `Bancas por asignar: ${result.seatsToFill}`}</p>
      <div className="simulation-renewal__count"><span>Bancas calculadas</span><strong>{awarded}</strong></div>
      {canDraw ? <div className="simulation-renewal__strip" aria-hidden="true">
        {result.results.flatMap((row, listIndex) => Array.from({ length: seats(result, row.listId) }, (_, index) => <span key={`${row.listId}-${index}`} style={{ backgroundColor: COLORS[listIndex % COLORS.length] }} />))}
        {Array.from({ length: result.seatsToFill - awarded }, (_, index) => <span key={`empty-${index}`} className="simulation-renewal__empty" />)}
      </div> : <p>Dibujo limitado a 60 bancas y 600 posiciones; los conteos exactos permanecen disponibles.</p>}
      <ul className="simulation-renewal__summary">{result.results.map((row, index) => seats(result, row.listId) > 0 ? <li key={row.listId} style={{ "--list-color": COLORS[index % COLORS.length] } as CSSProperties}><span>{row.listName}</span><strong>{seats(result, row.listId)}</strong></li> : null)}</ul>
      {result.results.some((row) => seats(result, row.listId) === 0) ? <details className="simulation-disclosure simulation-impact-disclosure"><summary>Sin bancas ({result.results.filter((row) => seats(result, row.listId) === 0).length})</summary><p>{result.results.filter((row) => seats(result, row.listId) === 0).map((row) => `${row.listName}: 0 bancas`).join(" · ")}</p></details> : null}
      <details className="simulation-disclosure simulation-impact-disclosure"><summary>Cómo se calcula</summary>
      <p>Paleta categórica de listas; no representa colores oficiales de partidos.</p>
      {awarded < result.seatsToFill ? <p role="note">Sin asignar: {result.seatsToFill - awarded} bancas. Consulte las limitaciones en la evidencia exacta.</p> : null}
      {result.level === "pba_municipal" ? <p className="simulation-renewal__retained">Las 9 bancas que continúan no se infieren de este reparto. Sin nómina aportada no se determina la composición ni una mayoría del concejo de 18 bancas.</p> : <p className="simulation-renewal__retained">Este reparto no determina la composición ni una mayoría de la cámara completa.</p>}
      {children}
      </details>
    </section>
  );
}

export function SimulationComparison({ base, scenario, baseResult, result }: {
  base: ProjectionInput; scenario: ProjectionInput; baseResult: AllocationResult; result: AllocationResult;
}) {
  const baseTotal = base.lists.reduce((sum, list) => sum + list.votes, 0);
  const scenarioTotal = scenario.lists.reduce((sum, list) => sum + list.votes, 0);
  const share = (votes: number, total: number) => total === 0 ? "No disponible" : `${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(votes / total * 100)} %`;
  const delta = (value: number) => `${value < 0 ? "−" : value > 0 ? "+" : ""}${format(Math.abs(value))}`;
  return (
    <section className="simulation-comparison" aria-labelledby="simulation-comparison-heading">
      <header><div><h2 id="simulation-comparison-heading">Base y escenario, lado a lado</h2><p>Base aportada y supuesto aplicado. Porcentajes sobre votos positivos incluidos en listas; excluyen votos fuera del modelo, blancos y anulados. No son participación ni pronóstico.</p></div>
        <dl><div><dt>Total base modelado</dt><dd>{format(baseTotal)}</dd></div><div><dt>Total escenario modelado</dt><dd>{format(scenarioTotal)}</dd></div></dl>
      </header>
      <div className="table-scroll" role="region" aria-label="Comparación exacta de base y escenario" tabIndex={0}>
        <table className="data-table"><caption>Comparación exacta de votos, proporciones y bancas</caption><thead><tr>
          {["Lista", "Votos base", "Votos escenario", "Cambio de votos", "% positivos modelados base", "% positivos modelados escenario", "Bancas base", "Bancas escenario"].map((heading) => <th key={heading} scope="col">{heading}</th>)}
        </tr></thead><tbody>{base.lists.map((list) => {
          const current = scenario.lists.find((row) => row.listId === list.listId)!;
          return <tr key={list.listId}><th scope="row">{list.listName}</th><td>{format(list.votes)}</td><td>{format(current.votes)}</td><td>{delta(current.votes - list.votes)}</td><td>{share(list.votes, baseTotal)}</td><td>{share(current.votes, scenarioTotal)}</td><td>{seats(baseResult, list.listId)}</td><td>{seats(result, list.listId)}</td></tr>;
        })}</tbody></table>
      </div>
    </section>
  );
}
