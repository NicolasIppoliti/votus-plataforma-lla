import type { ReactNode } from "react";
import { GranularityBadge } from "@/components/GranularityBadge";
import { JuxtapositionBadge } from "@/components/JuxtapositionBadge";
import type { ElectionFigure } from "@/components/JuxtapositionBadge";
import { ProvenanceLink } from "@/components/ProvenanceLink";
import {
  createResultsRepository,
  fetchSourceRefs,
  type BaseQuery,
  type ResultRow,
  type ResultsRepository,
} from "@/lib/fiscalizacion/repository";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import type { Coverage } from "@/lib/results/types";

/**
 * fiscalizacion-analysis spec, Requirement 8. The 26 Oct 2025 fiscalización
 * sheet's sourced coverage (design.md D9.2): 93 of 153 Coronel Rosales
 * mesas, exactly the mesas where the party had a fiscal present — never a
 * random sample. This is the ONLY coverage value this route ever supplies;
 * the route does not accept an operator-controlled coverage override.
 */
export const FISCALIZACION_COVERAGE: Coverage = {
  observedUnits: 93,
  denominatorUnits: 153,
  denominatorBasis: "distinct mesa_id, distrito_id=02 seccion_id=027 (26 Oct 2025)",
  isRandomSample: false,
};

export type FiscalizacionQuery = BaseQuery;

export type FiscalizacionView =
  | { status: "refused"; reason: string }
  | { status: "ok"; rows: ResultRow[]; coverage: Coverage };

/**
 * The single function through which this route reaches fiscalización
 * data. It always calls `repository.queryFiscalizacion` with an explicit
 * `coverage` opt-in — never `queryOfficial`, and never a second query
 * path (spec Requirement 8, scenario "The route requests fiscalización
 * explicitly"). When `coverage` is absent it refuses WITHOUT calling the
 * repository at all, so an unlabelled figure is never reachable, not
 * merely undisplayed (scenario "The route refuses to render without
 * coverage").
 */
export async function loadFiscalizacionView(
  repository: ResultsRepository,
  query: FiscalizacionQuery,
  // `null` is a distinct, explicit "no coverage supplied" sentinel — a
  // default parameter alone cannot distinguish an omitted third argument
  // (production callers always want `FISCALIZACION_COVERAGE`) from a
  // caller that explicitly passes no coverage (the refusal scenario under
  // test), because JS defaults trigger on `undefined` either way.
  coverage: Coverage | null = FISCALIZACION_COVERAGE,
): Promise<FiscalizacionView> {
  if (!coverage) {
    return {
      status: "refused",
      reason: "no coverage supplied — refusing rather than rendering an unlabelled figure",
    };
  }

  const response = await repository.queryFiscalizacion(query, { coverage });

  if (response.status !== "ok") {
    return { status: "refused", reason: response.reason };
  }

  return { status: "ok", rows: response.rows, coverage };
}

/**
 * Vote share of the highest-voted list among the returned rows, as a
 * percentage of the total votes cast across all rows. Used only for the
 * juxtaposition figure's headline share when a comparison figure is
 * supplied; returns 0 when there are no rows to avoid a division by zero.
 */
function sharePercentOfTopList(rows: ResultRow[]): number {
  const totalVotes = rows.reduce((sum, row) => sum + row.votes, 0);
  if (totalVotes === 0) return 0;
  const topVotes = rows.reduce((max, row) => Math.max(max, row.votes), 0);
  return Number(((topVotes / totalVotes) * 100).toFixed(2));
}

/**
 * Pure render function, testable via `renderToStaticMarkup` without
 * mounting the async RSC page component. Every fiscalización figure MUST
 * carry a visible unofficial-source indicator AND its coverage denominator
 * (scenario "Every rendered fiscalización figure is labelled unofficial").
 * When an official `comparison` figure is supplied for context, it carries
 * its OWN, visually distinct official-source indicator (scenario "Official
 * figures are never rendered inside the fiscalización view without their
 * own label") via `JuxtapositionBadge`.
 */
export function renderFiscalizacionView(
  view: FiscalizacionView,
  comparison?: ElectionFigure,
  sources: Parameters<typeof ProvenanceLink>[0]["sources"] = [],
): ReactNode {
  if (view.status === "refused") {
    return (
      <main>
        <h1>Fiscalización (unofficial)</h1>
        <p role="alert">Refused: {view.reason}</p>
      </main>
    );
  }

  const { rows, coverage } = view;

  return (
    <main>
      <h1>Fiscalización (unofficial)</h1>
      <p role="status">
        Unofficial source — party-internal fiscalización, not an official
        Junta Electoral result.
      </p>
      <p role="note">
        Coverage: {coverage.observedUnits} of {coverage.denominatorUnits} mesas
        — not a random sample; these are exactly the mesas where the party
        had a fiscal present.
      </p>
      {rows.length === 0 ? (
        <p>No fiscalización rows found for this jurisdiction/category/election.</p>
      ) : (
        <>
          <GranularityBadge granularity={rows[0]?.granularity ?? "mesa"} />
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
      {comparison ? (
        <JuxtapositionBadge
          fiscalizacion={{
            electionId: "2025-legislativas-nacional",
            electionLabel: "26 Oct 2025 national legislative",
            sourceKind: "fiscalizacion",
            sharePercent: sharePercentOfTopList(rows),
            coverage,
          }}
          official={comparison}
        />
      ) : null}
    </main>
  );
}

interface FiscalizacionPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Builds the optional official comparison figure from query parameters.
 *
 * Requirement 9 says the cross-election juxtaposition badge must be "reachable
 * and exercised". It was neither: the production call site passed `undefined`
 * for `comparison`, so the badge branch could never render through any real
 * HTTP request even though its component tests all passed. That is the same
 * failure shape as the capability's original reachability gap — built, tested,
 * unreachable.
 *
 * `sourceKind` is forced to `official` rather than read from the request: the
 * badge exists to contrast an unofficial figure against an official one from a
 * DIFFERENT election, and a comparison that could itself be fiscalización would
 * defeat the contrast the requirement exists to enforce. A half-specified
 * comparison yields none at all, so a figure never renders with a missing label
 * or a NaN share.
 */
export function comparisonFromParams(
  params: Record<string, string | string[] | undefined>,
): ElectionFigure | undefined {
  const electionId = stringParam(params, "compareElectionId");
  const electionLabel = stringParam(params, "compareElectionLabel");
  const rawShare = stringParam(params, "compareSharePercent");

  if (!electionId || !electionLabel || !rawShare) {
    return undefined;
  }

  const sharePercent = Number(rawShare);
  if (!Number.isFinite(sharePercent)) {
    return undefined;
  }

  return { electionId, electionLabel, sourceKind: "official", sharePercent };
}

function stringParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Authenticated operator route for the fiscalización capability
 * (fiscalizacion-analysis spec, Requirement 8). RSC, server-only reads —
 * reaches data ONLY through `repository.queryFiscalizacion()` via
 * `loadFiscalizacionView`.
 */
export default async function FiscalizacionPage({
  searchParams,
}: FiscalizacionPageProps): Promise<ReactNode> {
  const params = await searchParams;
  const electionId = stringParam(params, "electionId");
  const jurisdictionId = stringParam(params, "jurisdictionId");
  const categoryId = stringParam(params, "categoryId");

  if (!electionId || !jurisdictionId || !categoryId) {
    return (
      <main>
        <h1>Fiscalización (unofficial)</h1>
        <p>
          Provide <code>electionId</code>, <code>jurisdictionId</code> and{" "}
          <code>categoryId</code> query parameters.
        </p>
      </main>
    );
  }

  const repository = await createResultsRepository();
  const view = await loadFiscalizacionView(repository, {
    electionId,
    jurisdictionId,
    categoryId,
  });

  const supabase = await createSupabaseServerClient();
  const sources =
    view.status === "ok"
      ? await fetchSourceRefs(supabase, [...new Set(view.rows.map((row) => row.archiveEntryId))])
      : [];

  return renderFiscalizacionView(view, comparisonFromParams(params), sources);
}
