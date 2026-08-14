import type { ReactNode } from "react";
import { TableScroll } from "@/components/TableScroll";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";

interface ReviewItemRow {
  id: string;
  kind: string;
  severity: string;
  subject_ref: string;
  detected_at: string;
  note: string | null;
}

/**
 * D7's review queue view — the target of the `(authenticated)/layout.tsx`
 * unresolved-count banner. Lists every unresolved `review_item` row
 * (`supabase/migrations/0007_review_item.sql`).
 */
export default async function ReviewPage(): Promise<ReactNode> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("review_item")
    .select("id, kind, severity, subject_ref, detected_at, note")
    .is("resolved_at", null)
    .order("detected_at", { ascending: false });

  if (error) {
    throw new Error(`ReviewPage: no se pudo leer review_item: ${error.message}`);
  }

  const items = (data ?? []) as ReviewItemRow[];

  return (
    <main>
      <h1>Cola de revisión</h1>
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
                  <td className="evidence-token table-cell--identity">
                    {item.subject_ref}
                  </td>
                  <td className="table-cell--timestamp">{item.detected_at}</td>
                  <td className="evidence-text">{item.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </main>
  );
}
