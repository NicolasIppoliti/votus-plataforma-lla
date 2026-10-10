import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  type RosalesReference,
  ROSALES_REFERENCE_PATH,
  ROSALES_REFERENCE_SHA256,
  loadRosalesReference,
  parseRosalesReference,
} from "./cne-rosales-reference";

const directory = resolve(process.cwd(), "data/geography");
const committed = readFileSync(resolve(process.cwd(), ROSALES_REFERENCE_PATH));

function sha(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function variant(edit: (artifact: RosalesReference) => void) {
  const artifact = JSON.parse(committed.toString("utf8")) as RosalesReference;
  edit(artifact);
  const bytes = Buffer.from(JSON.stringify(artifact), "utf8");
  return parseRosalesReference(bytes, sha(bytes));
}

describe("CNE Rosales 2025 reference artifact", () => {
  it("pins the only committed artifact by its content hash", () => {
    expect(readdirSync(directory)).toEqual([`cne-rosales-2025-reference.${ROSALES_REFERENCE_SHA256}.json`]);
    expect(sha(committed)).toBe(ROSALES_REFERENCE_SHA256);
  });

  it("loads the committed artifact as reference-only geography", async () => {
    const result = await loadRosalesReference();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { reference } = result;
    expect(reference.reference_only).toBe(true);
    expect(reference.circuits).toHaveLength(10);
    expect(reference.locales).toHaveLength(31);
    expect(reference.locales.filter((locale) => locale.coordinates === null)).toHaveLength(3);
    expect(reference.counts).toEqual({ circuits: 10, locales: 31, plotted_locales: 28, unique_coordinate_pairs: 28, mesas: 153 });
    expect(reference.exclusions).toEqual({ not_plotted: { missing_coordinates: 3 } });
  });

  it("refuses bytes whose hash differs from the pinned SHA-256 before parsing", () => {
    const tampered = Buffer.concat([committed, Buffer.from(" ")]);
    expect(parseRosalesReference(tampered, ROSALES_REFERENCE_SHA256)).toEqual({ ok: false, reason: "hash_mismatch" });
    expect(parseRosalesReference(Buffer.from("not json"), ROSALES_REFERENCE_SHA256)).toEqual({ ok: false, reason: "hash_mismatch" });
  });

  it("refuses a missing artifact", async () => {
    const result = await loadRosalesReference(async () => {
      throw new Error("ENOENT");
    });
    expect(result).toEqual({ ok: false, reason: "missing" });
  });

  it("refuses malformed JSON and schema violations", () => {
    const bytes = Buffer.from("{", "utf8");
    expect(parseRosalesReference(bytes, sha(bytes))).toEqual({ ok: false, reason: "invalid_artifact" });
    expect(variant((a) => Object.assign(a, { extra: 1 }))).toEqual({ ok: false, reason: "invalid_artifact" });
    expect(variant((a) => { a.locales[0]!.coordinates = [-200, -38]; })).toEqual({ ok: false, reason: "invalid_artifact" });
  });

  it("refuses an artifact that does not declare itself reference-only with every caveat", () => {
    expect(variant((a) => Object.assign(a, { reference_only: false }))).toEqual({ ok: false, reason: "invalid_artifact" });
    expect(variant((a) => { a.caveats = a.caveats.slice(1); })).toEqual({ ok: false, reason: "invalid_artifact" });
  });

  it("refuses counts that disagree with the circuits and locales it carries", () => {
    expect(variant((a) => { a.counts.locales = 30; })).toEqual({ ok: false, reason: "count_mismatch" });
    expect(variant((a) => { a.counts.plotted_locales = 31; })).toEqual({ ok: false, reason: "count_mismatch" });
    expect(variant((a) => { a.exclusions.not_plotted.missing_coordinates = 0; })).toEqual({ ok: false, reason: "count_mismatch" });
    expect(variant((a) => { a.counts.mesas = 154; })).toEqual({ ok: false, reason: "count_mismatch" });
  });

  it("refuses locales outside the carried circuits or with broken mesa ranges", () => {
    expect(variant((a) => { a.locales[0]!.circuit = "0999"; })).toEqual({ ok: false, reason: "unknown_circuit" });
    expect(variant((a) => { a.locales[0]!.mesa_to += 1; })).toEqual({ ok: false, reason: "mesa_range_mismatch" });
    expect(variant((a) => { a.circuits[1]!.code = a.circuits[0]!.code; })).toEqual({ ok: false, reason: "invalid_artifact" });
  });
});
