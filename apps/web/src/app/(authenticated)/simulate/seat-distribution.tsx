import type { AllocationResult } from "@/domain/seat-allocation/types";

interface SeatDistributionProps {
  result: AllocationResult;
}

export function SeatDistribution({ result }: SeatDistributionProps) {
  const rows = result.level === "national"
    ? result.results.map((list) => ({ ...list, count: list.seats }))
    : result.results.map((list) => ({ ...list, count: list.totalSeats }));
  const unallocated = result.seatsToFill - rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <section aria-label="Distribución de bancas" className="seat-distribution">
      <header className="seat-distribution__header">
        <h3>Distribución de bancas</h3>
        <span>Proyección hipotética</span>
      </header>
      <p>
        Escala común: {result.seatsToFill} bancas por asignar.
        {result.level === "pba_municipal"
          ? " No representa la composición total del concejo."
          : " Se muestran todas las listas, incluidas las que no reciben bancas."}
      </p>
      <ul className="seat-distribution__rows">
        {rows.map((row) => (
          <li key={row.listId}>
            <div role="img" aria-label={`${row.listName}: ${row.count} de ${result.seatsToFill} bancas`}>
              <div className="seat-distribution__label">
                <span>{row.listName}</span>
                <strong>{row.count}<span> / {result.seatsToFill}</span></strong>
              </div>
              <div className="seat-distribution__track" aria-hidden="true">
                <span style={{ transform: `scaleX(${row.count / result.seatsToFill})` }} />
              </div>
            </div>
          </li>
        ))}
      </ul>
      {unallocated > 0 ? (
        <p role="note">Sin asignar: {unallocated} de {result.seatsToFill} bancas. La evidencia inferior explica las limitaciones de la asignación.</p>
      ) : null}
    </section>
  );
}
