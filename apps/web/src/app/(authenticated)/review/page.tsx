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

/**
 * Authorized review queue — shares the exact scoped predicate used by the
 * authenticated layout count.
 */
export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ offset?: string }> }): Promise<ReactNode> {
  const rawOffset = (await searchParams).offset;
  const offset = rawOffset && /^\d{1,10}$/.test(rawOffset) && Number(rawOffset) <= 2_000_000_000 ? Number(rawOffset) : 0;
  const payload = await authorizedReviewItems(await createSupabaseServerClient(), 50, offset);
  if (payload.status !== "ok") {
    return <main><h1>Cola de revisión</h1><p>{REVIEW_STATE_COPY[payload.status]}</p></main>;
  }
  const { items, total, truncated } = payload;

  return (
    <main>
      <h1>Cola de revisión</h1>
      <p>
        Esta pantalla es solo de consulta. Puede inspeccionar los elementos
        pendientes, pero no modificarlos ni resolverlos aquí.
      </p>
      {total > 0 ? <p>Mostrando {items.length} de {total}. {offset > 0 ? <Link href={`/review?offset=${Math.max(0, offset - 50)}`}>Anterior</Link> : null} {truncated && offset <= 1_999_999_950 ? <Link href={`/review?offset=${offset + 50}`}>Siguiente</Link> : null}</p> : null}
      {items.length === 0 ? (
        <p>No hay elementos de revisión pendientes.</p>
      ) : (
        <TableScroll label="Elementos de revisión pendientes">
          <table className="data-table data-table--review">
            <caption>Elementos de revisión pendientes</caption>
            <colgroup>
              <col className="review-column review-column--kind" />
              <col className="review-column review-column--severity" />
              <col className="review-column review-column--subject" />
              <col className="review-column review-column--detected" />
              <col className="review-column review-column--note" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Tipo</th>
                <th scope="col">Severidad</th>
                <th scope="col">Asunto</th>
                <th scope="col">Detectado</th>
                <th scope="col">Nota</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={`${item.kind}:${item.severity}:${item.detectedAt}:${index}`}>
                  <td className="table-cell--short">{item.kind}</td>
                  <td className="table-cell--short">{item.severity}</td>
                  <td className="evidence-token table-cell--identity">Oculto por alcance</td>
                  <td className="table-cell--timestamp">{item.detectedAt}</td>
                  <td className="evidence-text">Oculto por alcance</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </main>
  );
}
