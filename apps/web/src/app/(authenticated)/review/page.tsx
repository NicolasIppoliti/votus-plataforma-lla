import Link from "next/link";
import type { ReactNode } from "react";
import { TableScroll } from "@/components/TableScroll";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { authorizedReviewItems } from "@/lib/workspace/context";
import type { AuthorizedReviewItems } from "@/lib/workspace/review-items";

const REVIEW_STATE_COPY = {
  authorization_denied: "No se pudo autorizar la cola de revisión.",
  authorized_empty: "No hay elementos de revisión pendientes.",
  payload_too_large: "La respuesta de la cola de revisión supera el límite seguro.",
  unavailable: "La cola de revisión no está disponible por el momento.",
} as const satisfies Record<Exclude<AuthorizedReviewItems["status"], "ok">, string>;

const REVIEW_STATE_TITLE = {
  authorization_denied: "Acceso no autorizado",
  authorized_empty: "Sin elementos pendientes",
  payload_too_large: "Respuesta fuera del límite seguro",
  unavailable: "Cola no disponible",
} as const satisfies Record<Exclude<AuthorizedReviewItems["status"], "ok">, string>;

/**
 * Authorized review queue — shares the exact scoped predicate used by the
 * authenticated layout count.
 */
export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ offset?: string }> }): Promise<ReactNode> {
  const rawOffset = (await searchParams).offset;
  const offset = rawOffset && /^\d{1,10}$/.test(rawOffset) && Number(rawOffset) <= 2_000_000_000 ? Number(rawOffset) : 0;
  const payload = await authorizedReviewItems(await createSupabaseServerClient(), 50, offset);
  if (payload.status !== "ok") {
    return (
      <main className="review-queue page-shell">
        <header className="review-queue__header">
          <p className="eyebrow">Operaciones · revisión</p>
          <h1>Cola de revisión</h1>
        </header>
        <aside
          className="review-queue__attention review-queue__state"
          role={payload.status === "authorized_empty" ? "status" : "alert"}
          aria-labelledby="review-state-heading"
        >
          <p className="eyebrow">Atención operativa</p>
          <h2 id="review-state-heading">{REVIEW_STATE_TITLE[payload.status]}</h2>
          <p>{REVIEW_STATE_COPY[payload.status]}</p>
        </aside>
      </main>
    );
  }
  const { items, total, truncated } = payload;

  return (
    <main className="review-queue page-shell">
      <header className="review-queue__header">
        <p className="eyebrow">Operaciones · revisión</p>
        <h1>Cola de revisión</h1>
        <p className="review-queue__lede">Atención operativa sobre señales pendientes.</p>
      </header>
      <aside className="review-queue__attention" role="status">
        <p className="eyebrow">Atención operativa</p>
        <p>{total} elementos requieren revisión.</p>
        <p>
          Esta pantalla es solo de consulta. Puede inspeccionar los elementos
          pendientes, pero no modificarlos ni resolverlos aquí.
        </p>
      </aside>
      <section className="review-queue__results" aria-labelledby="review-results-heading">
        <div className="review-queue__results-heading">
          <h2 id="review-results-heading">Elementos pendientes</h2>
          <p>Mostrando {items.length} de {total}.</p>
        </div>
        {items.length === 0 ? (
          <p>{total > 0 ? "No hay elementos de revisión en esta página." : "No hay elementos de revisión pendientes."}</p>
        ) : (
          <TableScroll label="Elementos de revisión pendientes">
            <table className="data-table data-table--review">
              <caption>Elementos de revisión pendientes</caption>
              <colgroup>
                <col className="review-column review-column--kind" />
                <col className="review-column review-column--severity" />
                <col className="review-column review-column--detected" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Tipo</th>
                  <th scope="col">Severidad</th>
                  <th scope="col">Detectado</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={`${item.kind}:${item.severity}:${item.detectedAt}:${index}`}>
                    <td className="table-cell--short">{item.kind}</td>
                    <td className="table-cell--short">{item.severity}</td>
                    <td className="table-cell--timestamp">{item.detectedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
        {offset > 0 || (truncated && offset <= 1_999_999_950) ? (
          <nav className="review-queue__pagination" aria-label="Paginación de la cola de revisión">
            {offset > 0 ? <Link className="button button--secondary" href={`/review?offset=${Math.max(0, offset - 50)}`} aria-label="Página anterior de la cola de revisión">Anterior</Link> : null}
            {truncated && offset <= 1_999_999_950 ? <Link className="button button--secondary" href={`/review?offset=${offset + 50}`} aria-label="Página siguiente de la cola de revisión">Siguiente</Link> : null}
          </nav>
        ) : null}
      </section>
    </main>
  );
}
