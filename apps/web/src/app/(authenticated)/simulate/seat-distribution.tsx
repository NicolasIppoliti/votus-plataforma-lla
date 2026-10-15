import type { AllocationResult } from "@/domain/seat-allocation/types";

interface SeatDistributionProps {
  result: AllocationResult;
  baseResult?: AllocationResult | undefined;
}

export function SeatDistribution({ result, baseResult }: SeatDistributionProps) {
  const count = (allocation: AllocationResult, id: string) => {
    const row = allocation.results.find(list => list.listId === id);
    return row ? ("totalSeats" in row ? row.totalSeats : row.seats) : 0;
  };
  const rows = result.results.map(row => ({ ...row, count: count(result, row.listId), base: baseResult ? count(baseResult, row.listId) : null }));
  // Lists losing their last seat remain visible in the main comparison.
  const zero = rows.filter(row => row.count === 0 && (row.base === null || row.base === 0));
  const active = rows.filter(row => !zero.includes(row));
  const unallocated = result.seatsToFill - rows.reduce((sum, row) => sum + row.count, 0);
  const renderRows = (items: typeof rows) => <ul className="seat-distribution__rows">{items.map(row => <li key={row.listId} data-zero-seats={row.count === 0 ? "true" : undefined}>
    <div role="img" aria-label={`${row.listName}: ${row.count} de ${result.seatsToFill} bancas`} title={row.base === null ? undefined : `Base: ${row.base} bancas. Escenario: ${row.count} bancas.`}>
      <div className="seat-distribution__label"><span>{row.listName}</span><strong className="seat-distribution__comparison">{row.base === null ? row.count : `${row.base} → ${row.count}`}<span> / {result.seatsToFill}</span></strong></div>
    </div>
  </li>)}</ul>;
  return <section aria-label="Distribución de bancas" className="seat-distribution">
    <header className="seat-distribution__header"><h3>Distribución de bancas</h3><span>{baseResult ? "Base → escenario" : "Proyección hipotética"}</span></header>
    {renderRows(active)}
    {zero.length > 0 && <details className="simulation-disclosure simulation-impact-disclosure"><summary>Listas sin bancas ({zero.length})</summary>{renderRows(zero)}</details>}
    <details className="simulation-disclosure simulation-impact-disclosure"><summary>Cómo leer la distribución</summary>
      {result.seatsToFill <= 60 && rows.length * result.seatsToFill <= 600 ? <><p>Cada bloque en relieve es una banca asignada. Cada contorno vacío es una posición de la escala no asignada a esa lista, no una banca adicional.</p>{rows.map(row => <div key={row.listId} role="img" aria-label={`Detalle de ${row.listName}: ${row.count} de ${result.seatsToFill} bancas`}><p>{row.listName}</p><div className="seat-distribution__blocks" aria-hidden="true">{Array.from({ length: result.seatsToFill }, (_, index) => <span key={index} className="seat-distribution__block" data-seat-state={index < row.count ? "awarded" : "empty"} />)}</div></div>)}</> : <p>Dibujo de una banca por bloque no disponible para esta escala: se muestran los conteos exactos sobre la misma capacidad, sin truncar.</p>}
      <p>Escala común: {result.seatsToFill} bancas por asignar. Se muestran todas las listas, incluidas las que no reciben bancas.</p>
      {result.level === "pba_municipal" && <p>No representa la composición total del concejo.</p>}
      {baseResult && <p>Base → escenario compara las bancas asignadas antes y después del supuesto. Las listas sin bancas en ambos repartos se conservan en el desplegable.</p>}
    </details>
    {unallocated > 0 && <p role="note">Sin asignar: {unallocated} de {result.seatsToFill} bancas. La evidencia inferior explica las limitaciones de la asignación.</p>}
  </section>;
}
