import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  type ScenarioArtifact,
  SCENARIO_ARTIFACT_PATH,
  SCENARIO_ARTIFACT_SHA256,
  loadScenarioArtifact,
  parseScenarioArtifact,
} from "./scenario-artifact";

const directory = resolve(process.cwd(), "data/scenarios");
const committed = readFileSync(resolve(process.cwd(), SCENARIO_ARTIFACT_PATH));

function sha(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function first<T>(items: T[]): T {
  const [item] = items;
  if (item === undefined) throw new Error("empty fixture");
  return item;
}

function variant(edit: (artifact: ScenarioArtifact) => void) {
  const artifact = JSON.parse(committed.toString("utf8")) as ScenarioArtifact;
  edit(artifact);
  const bytes = Buffer.from(JSON.stringify(artifact), "utf8");
  return parseScenarioArtifact(bytes, sha(bytes));
}

describe("scenario artifact", () => {
  it("pins the only committed artifact by its content hash", () => {
    expect(readdirSync(directory)).toEqual([`rosales-concejales-2027.${SCENARIO_ARTIFACT_SHA256}.json`]);
    expect(sha(committed)).toBe(SCENARIO_ARTIFACT_SHA256);
  });

  it("loads the committed artifact as unvalidated scenarios", async () => {
    const result = await loadScenarioArtifact();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { artifact } = result;
    expect(artifact.status).toEqual({ validated: false, label: "supuestos sin validar" });
    expect(artifact.default_scenario).toBe("persistencia");
    expect(artifact.scenarios.map((s) => s.id)).toEqual(["persistencia", "transferencias_ei"]);
    for (const scenario of artifact.scenarios) {
      expect(scenario.lists.reduce((total, row) => total + row.seats, 0)).toBe(9);
    }
    expect(artifact.backtest.development_mean_tv_pp).toEqual({ model: "21.074", reference: "17.245" });
  });

  it("refuses missing files and bytes that do not match the pinned hash", async () => {
    expect(await loadScenarioArtifact(async () => {
      throw Object.assign(new Error("absent"), { code: "ENOENT" });
    })).toEqual({ ok: false, reason: "missing" });
    const tampered = Buffer.from(committed.toString("utf8").replace("45.06", "46.06"), "utf8");
    expect(await loadScenarioArtifact(async () => tampered)).toEqual({ ok: false, reason: "hash_mismatch" });
  });

  it.each([
    ["unvalidated_label_missing", (a: ScenarioArtifact) => { a.status.label = "proyección"; }],
    ["seat_total_mismatch", (a: ScenarioArtifact) => { first(first(a.scenarios).lists).seats = 4; }],
    ["default_mismatch", (a: ScenarioArtifact) => { first(a.scenarios).default = false; }],
    ["invalid_artifact", (a: ScenarioArtifact) => { Object.assign(a.territory, { pba_distrito: "028" }); }],
    ["invalid_artifact", (a: ScenarioArtifact) => { Object.assign(a, { category: "INTENDENTE" }); }],
    ["invalid_artifact", (a: ScenarioArtifact) => { Object.assign(a, { extra: true }); }],
    ["invalid_artifact", (a: ScenarioArtifact) => { first(first(a.scenarios).lists).share_exact = "0.45"; }],
    ["validated_claim", (a: ScenarioArtifact) => { a.status = { validated: true, label: "transferencias validadas" }; }],
    ["invalid_artifact", (a: ScenarioArtifact) => { first(a.scenarios.slice(1)).id = "persistencia"; }],
    ["invalid_artifact", (a: ScenarioArtifact) => { first(a.scenarios).lists.push(first(first(a.scenarios).lists)); }],
    ["invalid_artifact", (a: ScenarioArtifact) => {
      const row = first(first(a.scenarios).lists);
      row.share_exact = "1/2";
      row.share_percent = "50.00";
    }],
    ["invalid_artifact", (a: ScenarioArtifact) => { first(a.scenarios.slice(1)).model = "persistence"; }],
    ["invalid_artifact", (a: ScenarioArtifact) => { first(first(a.scenarios).lists).share_percent = "45.07"; }],
    ["default_mismatch", (a: ScenarioArtifact) => {
      a.default_scenario = "transferencias_ei";
      first(a.scenarios).default = false;
      first(a.scenarios.slice(1)).default = true;
    }],
    ["seat_total_mismatch", (a: ScenarioArtifact) => { first(a.scenarios).seat_status = "ambiguous_tie"; }],
  ])("refuses %s even when its hash is consistent", (reason, edit) => {
    expect(variant(edit)).toEqual({ ok: false, reason });
  });

  it("checks display shares with exact half-to-even rounding", () => {
    const shares = (a: ScenarioArtifact, percents: [string, string]) => {
      const lists = first(a.scenarios).lists;
      lists.forEach((row, index) => {
        row.share_exact = index === 0 ? "799/800" : index === 1 ? "1/800" : "0";
        row.share_percent = index === 0 ? percents[0] : index === 1 ? percents[1] : "0.00";
      });
    };
    expect(variant((a) => shares(a, ["99.88", "0.12"])).ok).toBe(true);
    expect(variant((a) => shares(a, ["99.87", "0.12"]))).toEqual({ ok: false, reason: "invalid_artifact" });
    expect(variant((a) => shares(a, ["99.88", "0.13"]))).toEqual({ ok: false, reason: "invalid_artifact" });
  });

  it("refuses bytes that are not JSON", () => {
    const bytes = Buffer.from("{not json", "utf8");
    expect(parseScenarioArtifact(bytes, sha(bytes))).toEqual({ ok: false, reason: "invalid_artifact" });
  });

  it("accepts an ambiguous tie only when declared, without a seat total", () => {
    const result = variant((a) => {
      const scenario = first(a.scenarios.slice(1));
      scenario.seat_status = "ambiguous_tie";
      for (const row of scenario.lists) row.seats = 0;
      scenario.total_seats = 0;
    });
    expect(result.ok).toBe(true);
  });
});
