import type { ReactNode } from "react";
import { GranularityBadge } from "@/components/GranularityBadge";
import { ProvenanceLink } from "@/components/ProvenanceLink";
import { createResultsRepository, fetchSourceRefs } from "@/lib/fiscalizacion/repository";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";

interface DrilldownPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function stringParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Single-jurisdiction drilldown (RSC, server-only reads), officially
 * sourced only — this view never exercises `queryFiscalizacion`; the
 * unofficial opt-in path is a distinct, explicit request the design does
 * not fold into the default drilldown.
 */
export default async function DrilldownPage({ searchParams }: DrilldownPageProps): Promise<ReactNode> {
  const params = await searchParams;
  const electionId = stringParam(params, "electionId");
  const jurisdictionId = stringParam(params, "jurisdictionId");
  const categoryId = stringParam(params, "categoryId");

  if (!electionId || !jurisdictionId || !categoryId) {
    return (
      <main>
        <h1>Drilldown</h1>
        <p>
          Provide <code>electionId</code>, <code>jurisdictionId</code> and{" "}
          <code>categoryId</code> query parameters.
        </p>
      </main>
    );
  }

  const repository = await createResultsRepository();
  const response = await repository.queryOfficial({ electionId, jurisdictionId, categoryId });
  const rows = response.status === "ok" ? response.rows : [];

  const supabase = await createSupabaseServerClient();
  const sources = await fetchSourceRefs(
    supabase,
    [...new Set(rows.map((row) => row.archiveEntryId))],
  );

  return (
    <main>
      <h1>Drilldown</h1>
      {rows.length === 0 ? (
        <p>No official results found for this jurisdiction/category/election.</p>
      ) : (
        <>
          <GranularityBadge granularity={rows[0]?.granularity ?? "distrito"} />
          <ul>
            {rows.map((row, index) => (
              <li key={`${row.listId ?? "unmapped"}-${index}`}>
                list {row.listId ?? "unmapped"}: {row.votes} votes
              </li>
            ))}
          </ul>
          <ProvenanceLink sources={sources} />
        </>
      )}
    </main>
  );
}
