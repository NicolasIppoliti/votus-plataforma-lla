import "server-only";
import { loadScenarioArtifact } from "./scenario-artifact";

/**
 * JEBA definitive 2025 CONCEJALES, argentinos + extranjeros.
 * Exact totals: curated/slice-09-jeba-definitive-totals.json (2025), pinned by
 * the scenario artifact's jeba_totals provenance. Null votes are unpublished;
 * use the allocator's valid-votes-only contract, never substitute zero.
 */
export async function loadOfficialSimulationBase() {
  const result = await loadScenarioArtifact();
  if (!result.ok) return result;
  const { artifact } = result;
  if (artifact.provenance.sources.jeba_totals.sha256 !==
    "455555f1336efaca66605dbd7f6441e78533f9e558568705b6c19779f73a42fd") {
    return { ok: false as const, reason: "invalid_artifact" };
  }
  const persistence = artifact.scenarios.filter((scenario) => scenario.model === "persistence");
  if (persistence.length !== 1) return { ok: false as const, reason: "invalid_artifact" };
  const positiveVotes = 32291n;
  const lists = [];
  for (const row of persistence[0]!.lists) {
    const [numerator, denominator = "1"] = row.share_exact.split("/");
    const scaled = BigInt(numerator!) * positiveVotes;
    if (scaled % BigInt(denominator) !== 0n) return { ok: false as const, reason: "invalid_artifact" };
    lists.push({ listId: row.list_id, listName: row.label, votes: Number(scaled / BigInt(denominator)) });
  }
  return {
    ok: true as const,
    input: {
      level: "pba_municipal" as const, isProjection: true as const,
      granularity: "seccion" as const, councilTotal: 18, seatsToFill: 9,
      voteTotals: { kind: "valid_votes_only" as const, validVotes: Number(positiveVotes) },
      unmodeledVotes: 0, unmodeledVoteBreakdown: [], lists,
    },
  };
}
