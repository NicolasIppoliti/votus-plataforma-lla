import type { ReactNode } from "react";
import { GranularityBadge } from "@/components/GranularityBadge";
import { ProvenanceLink } from "@/components/ProvenanceLink";
import {
  createResultsRepository,
  fetchSourceRefs,
  type BaseQuery,
  type PartyMappingContext,
  type ResultRow,
  type ResultsQueryResponse,
  type ResultsRepository,
} from "@/lib/fiscalizacion/repository";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";

/**
 * Phase 16c: `curated/party_map.yaml`'s `coronel_rosales_municipal`
 * mappings (2025 CONCEJALES, list 2206 = LLA+PRO alliance) were loaded
 * into `party_mapping` in Phase 15 but no route ever read them — only the
 * national DIPUTADO NACIONAL path (`/fiscalizacion`) was wired. Same
 * shape this change has hit eight times: shipped correct, tested,
 * unreachable code.
 */
export const MUNICIPAL_PARTY_CONTEXT: PartyMappingContext = {
  year: 2025,
  jurisdiction: "coronel_rosales_municipal",
  category: "CONCEJALES",
};

export type MunicipalQuery = BaseQuery;
export type MunicipalView = ResultsQueryResponse;

/**
 * Reads through `ResultsRepository.queryOfficial` ONLY — never a second
 * query path that could bypass the `source_kind = 'official'` default
 * (D9.1 threat-matrix control). Municipal results are always official;
 * there is no fiscalización coverage opt-in on this route.
 */
export async function loadMunicipalView(
  repository: ResultsRepository,
  query: MunicipalQuery,
): Promise<MunicipalView> {
  return repository.queryOfficial(query, MUNICIPAL_PARTY_CONTEXT);
}

/**
 * Pure render function, testable via `renderToStaticMarkup` without
 * mounting the async RSC page component (same convention as
 * `renderFiscalizacionView`).
 *
 * The PBA municipal source publishes DISTRITO totals, never mesa —
 * `GranularityBadge` always renders `distrito` here with
 * `degradedFrom="mesa"`, per provenance-display's "Degraded-granularity
 * figure discloses the degradation" scenario: an operator must see that
 * this figure is coarser than the mesa-level detail available for
 * national results, never a silent distrito total presented as if it
 * were mesa-level.
 */
export function renderMunicipalView(
  view: MunicipalView,
  sources: Parameters<typeof ProvenanceLink>[0]["sources"] = [],
): ReactNode {
  if (view.status !== "ok") {
    return (
      <main>
        <h1>Municipal (Concejales)</h1>
        <p role="alert">Refused: {view.reason}</p>
      </main>
    );
  }

  const { rows } = view;

  return (
    <main>
      <h1>Municipal (Concejales)</h1>
      <GranularityBadge granularity="distrito" degradedFrom="mesa" />
      {rows.length === 0 ? (
        <p>No municipal results found for this jurisdiction/category/election.</p>
      ) : (
        <>
          <ul>
            {rows.map((row: ResultRow, index: number) => (
              <li key={`${row.listId ?? "unmapped"}-${index}`}>
                {row.partyName ?? `unmapped (list ${row.listId ?? "?"})`}: {row.votes} votes
              </li>
            ))}
          </ul>
          <ProvenanceLink sources={sources} />
        </>
      )}
    </main>
  );
}

interface MunicipalPageProps {
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
 * Authenticated operator route for PBA municipal (Concejales) results.
 * RSC, server-only reads — reaches data ONLY through
 * `repository.queryOfficial()` via `loadMunicipalView`. Linked from
 * `(authenticated)/layout.tsx` so it is reachable by an operator
 * navigating the app, not merely addressable by URL.
 */
export default async function MunicipalPage({
  searchParams,
}: MunicipalPageProps): Promise<ReactNode> {
  const params = await searchParams;
  const electionId = stringParam(params, "electionId");
  const jurisdictionId = stringParam(params, "jurisdictionId");
  const categoryId = stringParam(params, "categoryId");

  if (!electionId || !jurisdictionId || !categoryId) {
    return (
      <main>
        <h1>Municipal (Concejales)</h1>
        <p>
          Provide <code>electionId</code>, <code>jurisdictionId</code> and{" "}
          <code>categoryId</code> query parameters.
        </p>
      </main>
    );
  }

  const repository = await createResultsRepository();
  const view = await loadMunicipalView(repository, { electionId, jurisdictionId, categoryId });

  const supabase = await createSupabaseServerClient();
  const sources =
    view.status === "ok"
      ? await fetchSourceRefs(supabase, [...new Set(view.rows.map((row) => row.archiveEntryId))])
      : [];

  return renderMunicipalView(view, sources);
}
