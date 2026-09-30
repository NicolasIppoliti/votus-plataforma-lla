import type { AllocationResult } from "@/domain/seat-allocation/types";

interface SeatDistributionProps {
  result: AllocationResult;
}

export function SeatDistribution({ result }: SeatDistributionProps) {
  const rows = result.level === "national"
    ? result.results.map((list) => ({ ...list, count: list.seats }))
    : result.results.map((list) => ({ ...list, count: list.totalSeats }));
  const unallocated = result.seatsToFill - rows.reduce((sum, row) => sum + row.count, 0);
  // Input accepts positive integers without a seat/list upper bound. Bound only
  // this presentation, not allocation or its canonical numerical evidence.
  const drawIndividualSeats = result.seatsToFill <= 60 &&
    rows.length * result.seatsToFill <= 600;

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
      {drawIndividualSeats ? (
        <p className="seat-distribution__legend">
          Cada bloque en relieve es una banca asignada. Cada contorno vacío es
          una posición de la escala no asignada a esa lista, no una banca adicional.
          Todas las filas usan la misma capacidad y el mismo tamaño de bloque.
        </p>
      ) : (
        <p role="note">
          Dibujo de una banca por bloque no disponible para esta escala:
          se muestran los conteos exactos sobre la misma capacidad, sin truncar.
        </p>
      )}
      <ul className="seat-distribution__rows">
        {rows.map((row) => (
          <li key={row.listId}>
            <div role="img" aria-label={`${row.listName}: ${row.count} de ${result.seatsToFill} bancas`}>
              <div className="seat-distribution__label">
                <span>{row.listName}</span>
                <strong>{row.count}<span> / {result.seatsToFill}</span></strong>
              </div>
              {drawIndividualSeats ? (
                <div className="seat-distribution__blocks" aria-hidden="true">
                  {Array.from({ length: result.seatsToFill }, (_, index) => (
                    <span
                      key={index}
                      className="seat-distribution__block"
                      data-seat-state={index < row.count ? "awarded" : "empty"}
                    />
                  ))}
                </div>
              ) : null}
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
