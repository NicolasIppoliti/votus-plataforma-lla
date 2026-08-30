import Link from "next/link";
import type { ReactNode } from "react";
import { TableScroll } from "@/components/TableScroll";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { authorizedReviewItems } from "@/lib/workspace/context";

interface ReviewItemRow {
  id: string;
  kind: string;
  severity: string;
  detected_at: string;
}

/**
 * Authorized review queue — shares the exact scoped predicate used by the
 * authenticated layout count.
 */
export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ offset?: string }> }): Promise<ReactNode> {
  const rawOffset = (await searchParams).offset;
  const offset = rawOffset && /^\d{1,10}$/.test(rawOffset) && Number(rawOffset) <= 2_000_000_000 ? Number(rawOffset) : 0;
  const payload = (await authorizedReviewItems(
    await createSupabaseServerClient(), 50, offset,
  )) as { status: string; items: ReviewItemRow[]; total: number; truncated: boolean };
  if (payload.status !== "ok") {
    return <main><h1>Cola de revisión</h1><p>No se pudo autorizar la cola de revisión.</p></main>;
  }
  const items = payload.items;

  return (
    <main>
      <h1>Cola de revisión</h1>
      <p>
        Esta pantalla es solo de consulta. Puede inspeccionar los elementos
        pendientes, pero no modificarlos ni resolverlos aquí.
      </p>
      {payload.total > 0 ? <p>Mostrando {items.length} de {payload.total}. {offset > 0 ? <Link href={`/review?offset=${Math.max(0, offset - 50)}`}>Anterior</Link> : null} {payload.truncated && offset <= 1_999_999_950 ? <Link href={`/review?offset=${offset + 50}`}>Siguiente</Link> : null}</p> : null}
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
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="table-cell--short">{item.kind}</td>
<td className="table-cell--short">{item.severity}</td>
                  <td className="evidence-token table-cell--identity">Oculto por alcance</td>
                  <td className="table-cell--timestamp">{item.detected_at}</td>
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
