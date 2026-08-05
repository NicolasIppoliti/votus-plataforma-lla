import type { Granularity } from "./types";

/**
 * Cross-year (2023 vs 2025) comparison, swing/flip detection and
 * mixed-granularity refusal (results-analysis spec; design.md D6).
 *
 * Pure function, no I/O: the caller (the results repository, task 11.16)
 * resolves the per-unit vote data at whatever granularity is actually
 * available for each year; this module only compares what it is given.
 */

export interface PartyVotes {
  party: string;
  votes: number;
}

export interface UnitResult {
  unitId: string;
  parties: PartyVotes[];
  /**
   * Phase 16a: the source's `mesa_tipo` (`NATIVOS` | `EXTRANJEROS`), when
   * known. `EXTRANJEROS` mesas vote in PBA provincial/municipal races but
   * not national ones — a real electoral fact, not a data defect. Optional
   * because it is only captured for national mesa-granularity rows so far
   * (migration 0011) and PBA ingestion has not shipped yet.
   */
  mesaTipo?: string;
}

export interface CompareInput {
  granularity2023: Granularity;
  granularity2025: Granularity;
  units2023: UnitResult[];
  units2025: UnitResult[];
  /** Explicit operator opt-in to aggregate a granularity mismatch (D6). */
  aggregateTo?: Granularity;
}

export interface PartyShare {
  party: string;
  votes: number;
  sharePercent: number;
}

export interface PartySwing {
  party: string;
  swingPercentPoints: number;
}

export interface UnitSwing {
  unitId: string;
  flipped: boolean;
  fromParty?: string;
  toParty?: string;
  shares2023: PartyShare[];
  shares2025: PartyShare[];
  swings: PartySwing[];
}

export interface DiscontinuousUnit {
  unitId: string;
  presentIn: "2023" | "2025";
}

/**
 * Surfaces a difference in the SET of `mesaTipo` values compared across
 * years — e.g. a 2023 category whose mesa set includes an `EXTRANJEROS`
 * mesa compared against a 2025 category that has none. Never silently
 * averaged over: an operator reading a swing figure must be able to see
 * that the two years compared different mesa populations.
 */
export interface MesaPopulationMismatch {
  types2023: string[];
  types2025: string[];
}

export type CompareResult =
  | {
      status: "ok";
      granularity: Granularity;
      aggregatedFrom?: Granularity;
      swings: UnitSwing[];
      discontinuities: DiscontinuousUnit[];
      mesaPopulationMismatch?: MesaPopulationMismatch;
    }
  | {
      status: "requires_explicit_aggregation";
      granularity2023: Granularity;
      granularity2025: Granularity;
    };

function toShares(parties: PartyVotes[]): PartyShare[] {
  const total = parties.reduce((sum, party) => sum + party.votes, 0);
  return parties.map((party) => ({
    party: party.party,
    votes: party.votes,
    sharePercent: total === 0 ? 0 : (party.votes / total) * 100,
  }));
}

function leadingParty(shares: PartyShare[]): string | undefined {
  if (shares.length === 0) return undefined;
  return shares.reduce((leader, share) => (share.votes > leader.votes ? share : leader)).party;
}

function computeUnitSwing(unit2023: UnitResult, unit2025: UnitResult): UnitSwing {
  const shares2023 = toShares(unit2023.parties);
  const shares2025 = toShares(unit2025.parties);
  const from = leadingParty(shares2023);
  const to = leadingParty(shares2025);

  const partyNames = new Set([
    ...shares2023.map((share) => share.party),
    ...shares2025.map((share) => share.party),
  ]);
  const swings: PartySwing[] = [...partyNames].map((party) => ({
    party,
    swingPercentPoints:
      (shares2025.find((share) => share.party === party)?.sharePercent ?? 0) -
      (shares2023.find((share) => share.party === party)?.sharePercent ?? 0),
  }));

  return {
    unitId: unit2023.unitId,
    flipped: from !== undefined && to !== undefined && from !== to,
    ...(from !== undefined ? { fromParty: from } : {}),
    ...(to !== undefined ? { toParty: to } : {}),
    shares2023,
    shares2025,
    swings,
  };
}

function distinctMesaTipos(units: UnitResult[]): string[] {
  const seen = new Set<string>();
  for (const unit of units) {
    if (unit.mesaTipo) seen.add(unit.mesaTipo);
  }
  return [...seen].sort();
}

function computeMesaPopulationMismatch(
  units2023: UnitResult[],
  units2025: UnitResult[],
): MesaPopulationMismatch | undefined {
  const types2023 = distinctMesaTipos(units2023);
  const types2025 = distinctMesaTipos(units2025);

  // Only compare when both years actually carry mesaTipo data — absence
  // (e.g. PBA sources that don't capture it yet) is not itself a mismatch.
  if (types2023.length === 0 || types2025.length === 0) return undefined;

  const sameSet =
    types2023.length === types2025.length && types2023.every((t) => types2025.includes(t));
  return sameSet ? undefined : { types2023, types2025 };
}

export function compareResults(input: CompareInput): CompareResult {
  const granularityMismatch = input.granularity2023 !== input.granularity2025;

  // D6: default is refuse. No figures are returned until the operator
  // makes an explicit aggregation choice — auto-aggregate-and-label was
  // rejected because it is exactly the misreading design.md's Risk 8 warns
  // about (an operator mistaking an aggregate for a mesa figure).
  if (granularityMismatch && !input.aggregateTo) {
    return {
      status: "requires_explicit_aggregation",
      granularity2023: input.granularity2023,
      granularity2025: input.granularity2025,
    };
  }

  const resultGranularity = granularityMismatch ? input.aggregateTo! : input.granularity2023;

  const byId2023 = new Map(input.units2023.map((unit) => [unit.unitId, unit]));
  const byId2025 = new Map(input.units2025.map((unit) => [unit.unitId, unit]));
  const allUnitIds = new Set([...byId2023.keys(), ...byId2025.keys()]);

  const swings: UnitSwing[] = [];
  const discontinuities: DiscontinuousUnit[] = [];

  for (const unitId of allUnitIds) {
    const unit2023 = byId2023.get(unitId);
    const unit2025 = byId2025.get(unitId);

    // A code present in only one year is a discontinuity, never a
    // zero-filled data point (jurisdiction-model's cross-year stability
    // tracking) — excluded from swing/flip, listed separately instead.
    if (!unit2023 || !unit2025) {
      discontinuities.push({ unitId, presentIn: unit2023 ? "2023" : "2025" });
      continue;
    }

    swings.push(computeUnitSwing(unit2023, unit2025));
  }

  const mesaPopulationMismatch = computeMesaPopulationMismatch(input.units2023, input.units2025);

  return {
    status: "ok",
    granularity: resultGranularity,
    ...(granularityMismatch ? { aggregatedFrom: input.granularity2023 } : {}),
    swings,
    discontinuities,
    ...(mesaPopulationMismatch ? { mesaPopulationMismatch } : {}),
  };
}
