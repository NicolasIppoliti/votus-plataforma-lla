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

export interface MesaPopulationMetadata {
  knownTypes: string[];
  taggedRows: number;
  untaggedRows: number;
}

export interface UnitResult {
  unitId: string;
  parties: PartyVotes[];
  mesaPopulation?: MesaPopulationMetadata;
  mesaTipo?: string;
}

export interface CompareInput {
  granularity2023: Granularity;
  granularity2025: Granularity;
  units2023: UnitResult[];
  units2025: UnitResult[];
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

export const COMPARISON_YEAR = {
  YEAR_2023: "2023",
  YEAR_2025: "2025",
} as const;

export type ComparisonYear =
  (typeof COMPARISON_YEAR)[keyof typeof COMPARISON_YEAR];

export interface DiscontinuousUnit {
  unitId: string;
  presentIn: ComparisonYear;
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

export interface MesaPopulationCoverage {
  year: ComparisonYear;
  knownTypes: string[];
  taggedRows: number;
  untaggedRows: number;
}

export interface AmbiguousLeader {
  unitId: string;
  year: DiscontinuousUnit["presentIn"];
  parties: string[];
}

export const COMPARISON_INPUT_ISSUE_CODE = {
  DUPLICATE_UNIT_ID: "duplicate_unit_id",
  DUPLICATE_PARTY_ID: "duplicate_party_id",
  EMPTY_UNIT_ID: "empty_unit_id",
  EMPTY_PARTY_ID: "empty_party_id",
  EMPTY_PARTY_SET: "empty_party_set",
  INVALID_VOTES: "invalid_votes",
  INVALID_VOTE_TOTAL: "invalid_vote_total",
  INVALID_MESA_POPULATION: "invalid_mesa_population",
} as const;

export type ComparisonInputIssueCode =
  (typeof COMPARISON_INPUT_ISSUE_CODE)[keyof typeof COMPARISON_INPUT_ISSUE_CODE];

export interface ComparisonInputIssue {
  code: ComparisonInputIssueCode;
  year: ComparisonYear;
  unitId: string;
  partyId?: string;
}

const POSTGRES_INTEGER_MAX = 2_147_483_647;

export type CompareResult =
  | {
      status: "ok";
      granularity: Granularity;
      swings: UnitSwing[];
      discontinuities: DiscontinuousUnit[];
      mesaPopulationMismatch?: MesaPopulationMismatch;
    }
  | {
      status: "requires_explicit_aggregation";
      granularity2023: Granularity;
      granularity2025: Granularity;
    }
  | {
      status: "ambiguous_leader";
      ambiguities: AmbiguousLeader[];
    }
  | {
      status: "mesa_population_partial_coverage";
      coverages: MesaPopulationCoverage[];
    }
  | {
      status: "invalid_comparison_input";
      issues: ComparisonInputIssue[];
    };

function issueKey(issue: ComparisonInputIssue): string {
  return JSON.stringify([issue.year, issue.code, issue.unitId, issue.partyId ?? null]);
}

function validateUnits(units: UnitResult[], year: ComparisonYear): ComparisonInputIssue[] {
  const issues: ComparisonInputIssue[] = [];
  const seenUnitIds = new Set<string>();

  for (const unit of units) {
    if (unit.unitId.trim().length === 0) {
      issues.push({ code: COMPARISON_INPUT_ISSUE_CODE.EMPTY_UNIT_ID, year, unitId: unit.unitId });
    }
    if (seenUnitIds.has(unit.unitId)) {
      issues.push({ code: COMPARISON_INPUT_ISSUE_CODE.DUPLICATE_UNIT_ID, year, unitId: unit.unitId });
    }
    seenUnitIds.add(unit.unitId);

    if (unit.parties.length === 0) {
      issues.push({ code: COMPARISON_INPUT_ISSUE_CODE.EMPTY_PARTY_SET, year, unitId: unit.unitId });
    }
    const seenPartyIds = new Set<string>();
    let totalVotes = 0;
    let invalidVoteTotal = false;
    for (const party of unit.parties) {
      const location = { year, unitId: unit.unitId, partyId: party.party };
      if (party.party.trim().length === 0) {
        issues.push({ code: COMPARISON_INPUT_ISSUE_CODE.EMPTY_PARTY_ID, ...location });
      }
      if (seenPartyIds.has(party.party)) {
        issues.push({ code: COMPARISON_INPUT_ISSUE_CODE.DUPLICATE_PARTY_ID, ...location });
      }
      seenPartyIds.add(party.party);
      if (
        !Number.isSafeInteger(party.votes) ||
        party.votes < 0 ||
        party.votes > POSTGRES_INTEGER_MAX
      ) {
        issues.push({ code: COMPARISON_INPUT_ISSUE_CODE.INVALID_VOTES, ...location });
      }
      if (Number.isInteger(party.votes) && party.votes >= 0) {
        totalVotes += party.votes;
        invalidVoteTotal ||= !Number.isSafeInteger(totalVotes);
      }
    }
    if (invalidVoteTotal) {
      issues.push({ code: COMPARISON_INPUT_ISSUE_CODE.INVALID_VOTE_TOTAL, year, unitId: unit.unitId });
    }

    const population = unit.mesaPopulation;
    if (
      population &&
      (unit.mesaTipo !== undefined ||
        population.knownTypes.some((type) => type.trim().length === 0) ||
        new Set(population.knownTypes).size !== population.knownTypes.length ||
        !Number.isSafeInteger(population.taggedRows) ||
        population.taggedRows < 0 ||
        !Number.isSafeInteger(population.untaggedRows) ||
        population.untaggedRows < 0)
    ) {
      issues.push({ code: COMPARISON_INPUT_ISSUE_CODE.INVALID_MESA_POPULATION, year, unitId: unit.unitId });
    }
  }

  return issues;
}

function validateComparisonInput(input: CompareInput): ComparisonInputIssue[] {
  const issues = [
    ...validateUnits(input.units2023, COMPARISON_YEAR.YEAR_2023),
    ...validateUnits(input.units2025, COMPARISON_YEAR.YEAR_2025),
  ];
  issues.sort((left, right) => {
    const leftKey = issueKey(left);
    const rightKey = issueKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return issues.filter((issue, index) =>
    index === 0 || issueKey(issue) !== issueKey(issues[index - 1]!),
  );
}

function toShares(parties: PartyVotes[]): PartyShare[] {
  const total = parties.reduce((sum, party) => sum + party.votes, 0);
  return parties.map((party) => ({
    party: party.party,
    votes: party.votes,
    sharePercent: total === 0 ? 0 : (party.votes / total) * 100,
  }));
}

function leadingParties(parties: PartyVotes[]): string[] {
  if (parties.length === 0) return [];
  const highestVotes = Math.max(...parties.map((party) => party.votes));
  return [
    ...new Set(
      parties
        .filter((party) => party.votes === highestVotes)
        .map((party) => party.party),
    ),
  ].sort();
}

function leadingParty(shares: PartyShare[]): string | undefined {
  const leaders = leadingParties(shares);
  return leaders.length === 1 ? leaders[0] : undefined;
}

function computeUnitSwing(
  unit2023: UnitResult,
  unit2025: UnitResult,
): UnitSwing {
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

function mesaPopulationCoverage(
  units: UnitResult[],
  year: ComparisonYear,
): MesaPopulationCoverage {
  const knownTypes = new Set<string>();
  let taggedRows = 0;
  let untaggedRows = 0;

  for (const unit of units) {
    if (unit.mesaPopulation) {
      for (const type of unit.mesaPopulation.knownTypes) knownTypes.add(type);
      taggedRows += unit.mesaPopulation.taggedRows;
      untaggedRows += unit.mesaPopulation.untaggedRows;
    } else if (unit.mesaTipo) {
      knownTypes.add(unit.mesaTipo);
      taggedRows += 1;
    } else {
      untaggedRows += 1;
    }
  }

  return {
    year,
    knownTypes: [...knownTypes].sort(),
    taggedRows,
    untaggedRows,
  };
}

function computeMesaPopulationMismatch(
  coverage2023: MesaPopulationCoverage,
  coverage2025: MesaPopulationCoverage,
): MesaPopulationMismatch | undefined {
  if (
    coverage2023.taggedRows === 0 ||
    coverage2025.taggedRows === 0 ||
    coverage2023.untaggedRows > 0 ||
    coverage2025.untaggedRows > 0
  ) {
    return undefined;
  }

  const types2023 = coverage2023.knownTypes;
  const types2025 = coverage2025.knownTypes;
  const sameSet =
    types2023.length === types2025.length &&
    types2023.every((type) => types2025.includes(type));
  return sameSet ? undefined : { types2023, types2025 };
}

export function compareResults(input: CompareInput): CompareResult {
  const issues = validateComparisonInput(input);
  if (issues.length > 0) {
    return { status: "invalid_comparison_input", issues };
  }

  const granularityMismatch = input.granularity2023 !== input.granularity2025;

  // D6: always refuse mixed source granularities. This function receives
  // already-grouped units but no descendant hierarchy, so relabeling them at a
  // requested coarser level would claim an aggregation it did not perform.
  if (granularityMismatch) {
    return {
      status: "requires_explicit_aggregation",
      granularity2023: input.granularity2023,
      granularity2025: input.granularity2025,
    };
  }

  const coverage2023 = mesaPopulationCoverage(
    input.units2023,
    COMPARISON_YEAR.YEAR_2023,
  );
  const coverage2025 = mesaPopulationCoverage(
    input.units2025,
    COMPARISON_YEAR.YEAR_2025,
  );
  const partialCoverages = [coverage2023, coverage2025].filter(
    (coverage) => coverage.taggedRows > 0 && coverage.untaggedRows > 0,
  );
  if (partialCoverages.length > 0) {
    return {
      status: "mesa_population_partial_coverage",
      coverages: partialCoverages,
    };
  }

  const byId2023 = new Map(input.units2023.map((unit) => [unit.unitId, unit]));
  const byId2025 = new Map(input.units2025.map((unit) => [unit.unitId, unit]));
  const allUnitIds = new Set([...byId2023.keys(), ...byId2025.keys()]);
  const ambiguities: AmbiguousLeader[] = [];

  for (const unitId of allUnitIds) {
    const unit2023 = byId2023.get(unitId);
    const unit2025 = byId2025.get(unitId);
    if (!unit2023 || !unit2025) continue;

    for (const [year, unit] of [
      [COMPARISON_YEAR.YEAR_2023, unit2023],
      [COMPARISON_YEAR.YEAR_2025, unit2025],
    ] as const) {
      const parties = leadingParties(unit.parties);
      if (parties.length > 1) ambiguities.push({ unitId, year, parties });
    }
  }

  if (ambiguities.length > 0) {
    ambiguities.sort(
      (left, right) =>
        left.unitId.localeCompare(right.unitId) ||
        left.year.localeCompare(right.year),
    );
    return { status: "ambiguous_leader", ambiguities };
  }

  const swings: UnitSwing[] = [];
  const discontinuities: DiscontinuousUnit[] = [];

  for (const unitId of allUnitIds) {
    const unit2023 = byId2023.get(unitId);
    const unit2025 = byId2025.get(unitId);

    // A code present in only one year is a discontinuity, never a
    // zero-filled data point (jurisdiction-model's cross-year stability
    // tracking) — excluded from swing/flip, listed separately instead.
    if (!unit2023 || !unit2025) {
      discontinuities.push({
        unitId,
        presentIn: unit2023
          ? COMPARISON_YEAR.YEAR_2023
          : COMPARISON_YEAR.YEAR_2025,
      });
      continue;
    }

    swings.push(computeUnitSwing(unit2023, unit2025));
  }

  const mesaPopulationMismatch = computeMesaPopulationMismatch(
    coverage2023,
    coverage2025,
  );

  return {
    status: "ok",
    granularity: input.granularity2023,
    swings,
    discontinuities,
    ...(mesaPopulationMismatch ? { mesaPopulationMismatch } : {}),
  };
}
