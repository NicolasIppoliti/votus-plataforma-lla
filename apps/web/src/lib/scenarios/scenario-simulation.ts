import "server-only";
import { loadScenarioArtifact } from "./scenario-artifact";

/** Exact rational largest remainder; no floating point participates in ordering. */
export function scenarioVotes(shares: string[], requireExact: boolean) {
  const rows = shares.map((share, index) => {
    const [n, d = "1"] = share.split("/");
    const numerator = BigInt(n!);
    const denominator = BigInt(d);
    if (numerator < 0n || denominator <= 0n) throw new Error("Invalid share");
    const scaled = numerator * 32291n;
    return { numerator, denominator, index, floor: scaled / denominator, remainder: scaled % denominator };
  });
  let sumN = 0n, sumD = 1n;
  for (const row of rows) {
    sumN = sumN * row.denominator + row.numerator * sumD;
    sumD *= row.denominator;
  }
  if (sumN !== sumD || (requireExact && rows.some((row) => row.remainder !== 0n))) throw new Error("Invalid exact totals");
  const votes = rows.map((row) => Number(row.floor));
  const remaining = 32291 - votes.reduce((sum, vote) => sum + vote, 0);
  const ranked = [...rows].sort((a, b) => {
    const remainder = b.remainder * a.denominator - a.remainder * b.denominator;
    const share = b.numerator * a.denominator - a.numerator * b.denominator;
    const difference = remainder || share;
    return difference > 0n ? 1 : difference < 0n ? -1 : a.index - b.index;
  });
  for (const row of ranked.slice(0, remaining)) votes[row.index]! += 1;
  const apportioned = rows.some((row) => row.remainder !== 0n);
  // Display only; exact arithmetic above governs every vote and tie.
  const maxDifference = Math.max(...rows.map((row) => Math.abs(votes[row.index]! - Number(row.floor) - Number(row.remainder) / Number(row.denominator))));
  return { votes, apportioned, maxDifference };
}

export async function loadScenarioSimulation(id: string) {
  const result = await loadScenarioArtifact();
  if (!result.ok) return undefined;
  const scenario = result.artifact.scenarios.find((entry) => entry.id === id);
  if (!scenario) return undefined;
  try {
    const totals = scenarioVotes(scenario.lists.map((row) => row.share_exact), scenario.model === "persistence");
    return {
      ...totals, name: scenario.name,
      input: {
        level: "pba_municipal" as const, isProjection: true as const,
        granularity: "seccion" as const, councilTotal: 18, seatsToFill: 9,
        voteTotals: { kind: "valid_votes_only" as const, validVotes: 32291 },
        unmodeledVotes: 0, unmodeledVoteBreakdown: [],
        lists: scenario.lists.map((row, index) => ({ listId: row.list_id, listName: row.label, votes: totals.votes[index]! })),
      },
    };
  } catch { return undefined; }
}
