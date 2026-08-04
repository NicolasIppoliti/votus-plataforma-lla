import type { ReactNode } from "react";
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
    throw new Error(`ReviewPage: failed to read review_item: ${error.message}`);
  }

  const items = (data ?? []) as ReviewItemRow[];

  return (
    <main>
      <h1>Review queue</h1>
      {items.length === 0 ? (
        <p>No unresolved review items.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Kind</th>
              <th>Severity</th>
              <th>Subject</th>
              <th>Detected</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.kind}</td>
                <td>{item.severity}</td>
                <td>{item.subject_ref}</td>
                <td>{item.detected_at}</td>
                <td>{item.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
