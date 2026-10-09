import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

/**
 * Slice 10 (#393): read-only 2027 Coronel Rosales CONCEJALES scenarios from the
 * ETL artifact written by `etl/etl/scenario_artifact.py`. The bytes must match
 * the pinned SHA-256 before parsing; every refusal returns a reason, never data.
 */
export const SCENARIO_ARTIFACT_SHA256 =
  "0a7c6c0e607f1f0e13534f7d7e1711b011faabaa2a6f6a3d47bc20b6bbcad2b4";
export const SCENARIO_ARTIFACT_PATH = `data/scenarios/rosales-concejales-2027.${SCENARIO_ARTIFACT_SHA256}.json`;
export const UNVALIDATED_LABEL = "supuestos sin validar";

const exactFraction = z.string().regex(/^\d+(\/[1-9]\d*)?$/);
const pp = z.string().regex(/^\d+\.\d{3}$/);
const source = z.strictObject({ path: z.string().min(1), sha256: z.string().regex(/^[0-9a-f]{64}$/) });

const listSchema = z.strictObject({
  list_id: z.string().min(1),
  label: z.string().min(1),
  share_exact: exactFraction,
  share_percent: z.string().regex(/^\d+\.\d{2}$/),
  seats: z.number().int().nonnegative(),
});

const scenarioSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  model: z.enum(["persistence", "relation_type"]),
  default: z.boolean(),
  seat_status: z.enum(["allocated", "ambiguous_tie"]),
  total_seats: z.number().int().nonnegative(),
  lists: z.array(listSchema).min(1),
  assumptions: z
    .strictObject({
      rates: z.record(z.string(), z.record(z.string(), exactFraction)),
      fallback_votes: z.record(z.string(), exactFraction),
    })
    .optional(),
});

const artifactSchema = z.strictObject({
  kind: z.literal("votus.scenario-artifact"),
  schema_version: z.literal(1),
  territory: z.strictObject({ pba_distrito: z.literal("027"), name: z.literal("Coronel Rosales") }),
  category: z.literal("CONCEJALES"),
  base_year: z.literal(2025),
  target_year: z.literal(2027),
  seats_per_renewal: z.literal(9),
  status: z.strictObject({ validated: z.boolean(), label: z.string().min(1) }),
  default_scenario: z.string().min(1),
  scenarios: z.array(scenarioSchema).min(1),
  backtest: z.strictObject({
    reference: z.string().min(1),
    development_pass: z.boolean(),
    development_mean_tv_pp: z.strictObject({ model: pp, reference: pp }),
    final_tv_pp: z.strictObject({ model: pp, reference: pp }),
  }),
  provenance: z.strictObject({
    generator: z.literal("etl/etl/scenario_artifact.py"),
    scenario_note: z.string(),
    sources: z.strictObject({
      jeba_totals: source,
      scenario: source,
      backtest_development: source,
      backtest_final: source,
    }),
  }),
});

export type ScenarioArtifact = z.infer<typeof artifactSchema>;
export type ScenarioRefusal =
  | "missing"
  | "hash_mismatch"
  | "validated_claim"
  | "invalid_artifact"
  | "unvalidated_label_missing"
  | "seat_total_mismatch"
  | "default_mismatch";
export type ScenarioArtifactResult =
  | { ok: true; artifact: ScenarioArtifact }
  | { ok: false; reason: ScenarioRefusal };

function refuse(reason: ScenarioRefusal): ScenarioArtifactResult {
  return { ok: false, reason };
}

function fraction(text: string): [bigint, bigint] {
  const [numerator, denominator = "1"] = text.split("/");
  return [BigInt(numerator ?? "0"), BigInt(denominator)];
}

/** Exact half-to-even rounding to two decimals, matching the ETL display shares. */
function percentText([numerator, denominator]: [bigint, bigint]): string {
  let quotient = (numerator * 10000n) / denominator;
  const twice = 2n * ((numerator * 10000n) % denominator);
  if (twice > denominator || (twice === denominator && quotient % 2n === 1n)) quotient += 1n;
  const digits = quotient.toString().padStart(3, "0");
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

function consistentShares(lists: ScenarioArtifact["scenarios"][number]["lists"]): boolean {
  let [sumNumerator, sumDenominator] = [0n, 1n];
  for (const row of lists) {
    const [numerator, denominator] = fraction(row.share_exact);
    if (percentText([numerator, denominator]) !== row.share_percent) return false;
    [sumNumerator, sumDenominator] = [sumNumerator * denominator + numerator * sumDenominator, sumDenominator * denominator];
  }
  return sumNumerator === sumDenominator;
}

export function parseScenarioArtifact(bytes: Buffer, expectedSha256: string): ScenarioArtifactResult {
  if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256) return refuse("hash_mismatch");
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    return refuse("invalid_artifact");
  }
  const parsed = artifactSchema.safeParse(raw);
  if (!parsed.success) return refuse("invalid_artifact");
  const artifact = parsed.data;
  // Slice 10 presents unvalidated scenarios only; a validated claim is out of scope.
  if (artifact.status.validated) return refuse("validated_claim");
  if (artifact.status.label !== UNVALIDATED_LABEL) return refuse("unvalidated_label_missing");
  const ids = artifact.scenarios.map((scenario) => scenario.id);
  const models = artifact.scenarios.map((scenario) => scenario.model);
  if (new Set(ids).size !== ids.length || new Set(models).size !== models.length) return refuse("invalid_artifact");
  for (const scenario of artifact.scenarios) {
    const listIds = scenario.lists.map((row) => row.list_id);
    if (new Set(listIds).size !== listIds.length || !consistentShares(scenario.lists)) return refuse("invalid_artifact");
  }
  const defaults = artifact.scenarios.filter((scenario) => scenario.default);
  const [only] = defaults;
  if (defaults.length !== 1 || only?.id !== artifact.default_scenario || only.model !== "persistence") {
    return refuse("default_mismatch");
  }
  for (const scenario of artifact.scenarios) {
    const seats = scenario.lists.reduce((total, row) => total + row.seats, 0);
    const expected = scenario.seat_status === "allocated" ? artifact.seats_per_renewal : 0;
    if (seats !== expected || scenario.total_seats !== expected) return refuse("seat_total_mismatch");
  }
  return { ok: true, artifact };
}

type ReadBytes = (path: string) => Promise<Buffer>;

export async function loadScenarioArtifact(read: ReadBytes = readFile): Promise<ScenarioArtifactResult> {
  let bytes: Buffer;
  try {
    bytes = await read(resolve(process.cwd(), SCENARIO_ARTIFACT_PATH));
  } catch {
    return refuse("missing");
  }
  return parseScenarioArtifact(bytes, SCENARIO_ARTIFACT_SHA256);
}
