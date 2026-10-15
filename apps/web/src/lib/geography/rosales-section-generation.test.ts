import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveRosalesSection, SECTION_SOURCE } from "./rosales-section-artifact";

// The immutable, gitignored original is deliberately read only. CLI output stays
// inside the authorized artifact directory; replay never creates a temp archive.
// Prefer the current checkout; a linked worktree can share the read-only original
// from its sibling main checkout. CI without the gitignored archive skips replay.
const checkout = resolve("../..");
const root = process.env.VOTUS_SECTION_SOURCE_ROOT ?? (existsSync(resolve(checkout, "archive/geography")) ? checkout : resolve(checkout, "../../votus-plataforma-lla"));
const output = resolve("data/geography");
describe("Rosales section offline CLI", () => {
  it.each([
    { records: [] },
    { records: [SECTION_SOURCE, SECTION_SOURCE] },
    { records: [{ ...SECTION_SOURCE, fetched_at: "2020-01-01" }] },
    { records: [{ ...SECTION_SOURCE, archived_path: "other.geojson" }] },
  ])("refuses unpinned or ambiguous manifests before selecting", (manifest) => {
    expect(() => deriveRosalesSection(manifest, Buffer.from("{}"))).toThrow("source_manifest_mismatch");
  });
  it("refuses truncated and same-length corrupt originals", () => {
    const manifest = { records: [SECTION_SOURCE] };
    expect(() => deriveRosalesSection(manifest, Buffer.from("{}"))).toThrow("source_bytes_mismatch");
    expect(() => deriveRosalesSection(manifest, Buffer.alloc(SECTION_SOURCE.bytes, 32))).toThrow("source_bytes_mismatch");
  });
  it.skipIf(!existsSync(resolve(root, "archive/geography/cne-pba-sections.964af68999504c107c71eaccd8470055f990071eccba09f227e81b6dc31df673.geojson")))("replays byte-identically and retains every coordinate from the original", () => {
    const run = () => JSON.parse(execFileSync(process.execPath, [
      "scripts/generate-rosales-section.ts", "--source-root", root, "--output-dir", output,
    ], { encoding: "utf8" })) as { filename: string; sha256: string };
    const first = run();
    const bytes = readFileSync(resolve(output, first.filename));
    expect(run()).toEqual(first);
    expect(readFileSync(resolve(output, first.filename))).toEqual(bytes);
    expect(readdirSync(output).filter((name) => name.startsWith("cne-rosales-section."))).toEqual([first.filename]);
    const artifact = JSON.parse(bytes.toString());
    const original = JSON.parse(readFileSync(resolve(root, artifact.source.archived_path), "utf8"));
    const matching = original.features.filter((f: { properties: { gid: number } }) => f.properties.gid === 30556);
    expect(matching).toHaveLength(1);
    expect(artifact.feature).toEqual(matching[0]);
    expect(artifact.reference_only).toBe(true);
    expect(artifact.historical_applicability).toBe("not_verified");
  });
});
