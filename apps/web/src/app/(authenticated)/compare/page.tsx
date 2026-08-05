import type { ReactNode } from "react";
import { GranularityBadge } from "@/components/GranularityBadge";
import { ProvenanceLink } from "@/components/ProvenanceLink";
import { compareResults } from "@/lib/results/compare";
import type { CompareInput, UnitResult } from "@/lib/results/compare";
import type { Granularity } from "@/lib/results/types";
import { createResultsRepository, fetchSourceRefs } from "@/lib/fiscalizacion/repository";
import type { ResultRow } from "@/lib/fiscalizacion/repository";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";

interface ComparePageProps {
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
 * Groups official rows into `compare.ts`'s per-unit shape. `listId` stands
 * in for `party` here — resolving `listId` to a canonical party name is
 * `party-identity-mapping`'s job and is not wired into `ResultsRepository`
 * yet; this is a disclosed simplification, not a silent gap.
 */
function toCompareUnits(rows: ResultRow[]): { granularity: Granularity; units: UnitResult[] } {
  const votesByUnitAndParty = new Map<string, Map<string, number>>();
  let granularity: Granularity = "distrito";

  for (const row of rows) {
    granularity = row.granularity;
    const party = row.listId ?? "unmapped";
    const parties = votesByUnitAndParty.get(row.jurisdictionId) ?? new Map<string, number>();
    parties.set(party, (parties.get(party) ?? 0) + row.votes);
    votesByUnitAndParty.set(row.jurisdictionId, parties);
  }

  const units: UnitResult[] = [...votesByUnitAndParty.entries()].map(([unitId, parties]) => ({
    unitId,
    parties: [...parties.entries()].map(([party, votes]) => ({ party, votes })),
  }));

  return { granularity, units };
}

/**
 * `results-analysis` cross-year comparison view (RSC, server-only reads —
 * design.md's Data Flow: "Next.js RSC (server-only reads)").
 */
export default async function ComparePage({ searchParams }: ComparePageProps): Promise<ReactNode> {
  const params = await searchParams;
  const electionId2023 = stringParam(params, "election2023");
  const electionId2025 = stringParam(params, "election2025");
  const jurisdictionId = stringParam(params, "jurisdictionId");
  const categoryId = stringParam(params, "categoryId");
  const aggregateTo = stringParam(params, "aggregateTo") as Granularity | undefined;

  if (!electionId2023 || !electionId2025 || !jurisdictionId || !categoryId) {
    return (
      <main>
        <h1>Compare 2023 vs 2025</h1>
        <p>
          Provide <code>election2023</code>, <code>election2025</code>,{" "}
          <code>jurisdictionId</code> and <code>categoryId</code> query parameters.
        </p>
      </main>
    );
  }

  const repository = await createResultsRepository();
  const baseQuery2023 = { electionId: electionId2023, jurisdictionId, categoryId };
  const baseQuery2025 = { electionId: electionId2025, jurisdictionId, categoryId };
  const [response2023, response2025] = await Promise.all([
    repository.queryOfficial(baseQuery2023),
    repository.queryOfficial(baseQuery2025),
  ]);

  const rows2023 = response2023.status === "ok" ? response2023.rows : [];
  const rows2025 = response2025.status === "ok" ? response2025.rows : [];

  const { granularity: granularity2023, units: units2023 } = toCompareUnits(rows2023);
  const { granularity: granularity2025, units: units2025 } = toCompareUnits(rows2025);

  const compareInput: CompareInput = {
    granularity2023,
    granularity2025,
    units2023,
    units2025,
    ...(aggregateTo ? { aggregateTo } : {}),
  };
  const result = compareResults(compareInput);

  if (result.status === "requires_explicit_aggregation") {
    return (
      <main>
        <h1>Compare 2023 vs 2025</h1>
        {/* Task 11.14: flagged in the DISPLAY, not only in the API's
            `status` field — an operator scanning this page sees the
            refusal directly, with no figures rendered alongside it. */}
        <p role="alert">
          Mixed granularity: 2023 data is at {result.granularity2023}-level and 2025
          data is at {result.granularity2025}-level. Re-request with an explicit{" "}
          <code>aggregateTo</code> query parameter to combine them — this comparison
          refuses to guess (design.md D6).
        </p>
      </main>
    );
  }

  const archiveEntryIds = [...new Set([...rows2023, ...rows2025].map((row) => row.archiveEntryId))];
  const supabase = await createSupabaseServerClient();
  const sources = await fetchSourceRefs(supabase, archiveEntryIds);

  return (
    <main>
      <h1>Compare 2023 vs 2025</h1>
      <GranularityBadge granularity={result.granularity} />
      {result.aggregatedFrom ? (
        <p>
          Aggregated from {result.aggregatedFrom}-level data per an explicit operator
          choice.
        </p>
      ) : null}
      <ul>
        {result.swings.map((swing) => (
          <li key={swing.unitId}>
            {swing.unitId}:{" "}
            {swing.flipped
              ? `flipped ${swing.fromParty ?? "?"} → ${swing.toParty ?? "?"}`
              : "no flip"}
          </li>
        ))}
      </ul>
      {result.discontinuities.length > 0 ? (
        <section aria-label="discontinuities">
          <h2>Discontinuous units</h2>
          <ul>
            {result.discontinuities.map((discontinuity) => (
              <li key={discontinuity.unitId}>
                {discontinuity.unitId} — present only in {discontinuity.presentIn}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ProvenanceLink sources={sources} />
    </main>
  );
}
