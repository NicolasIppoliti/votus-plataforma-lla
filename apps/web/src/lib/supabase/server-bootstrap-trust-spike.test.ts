import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const runner = new URL("../../../scripts/server-bootstrap-trust-spike.ts", import.meta.url);

function canonicalObservationSource(source: string): string {
  const match = source.match(
    /create function workspace_api\.context_observation[\s\S]*?alter function workspace_api\.context_observation/,
  );
  if (!match) throw new Error("canonical observation function missing");
  return match[0];
}

describe("server bootstrap trust spike runner", () => {
  it(
    "executes the real local Supabase trust boundary and cleans it up",
    () => {
      const output = execFileSync(
        process.execPath,
        ["--experimental-strip-types", fileURLToPath(runner)],
        {
          encoding: "utf8",
          env: process.env,
          timeout: 240_000,
        },
      );

      expect(output.trim()).toBe("local server-bootstrap trust spike passed");
    },
    300_000,
  );

  it("keeps bootstrap direct, parameterized, and separate from Data API exposure", async () => {
    const source = await readFile(runner, "utf8");
    expect(source).toContain("bootstrap_selection_context");
    expect(source).toContain("workspace_bootstrap_caller");
    expect(source).toContain("WITH INHERIT TRUE, SET FALSE, ADMIN FALSE");
    expect(source).toContain("pgrst.db_schemas");
    expect(source).toContain("p_session !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'");
    expect(source).not.toContain("p_session !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'");
    expect(source).not.toContain("getSession(");
    expect(source).not.toContain("service_role");
  });

  it("uses workspace_api for the canonical context observation POST", async () => {
    const source = await readFile(runner, "utf8");
    expect(source).toMatch(
      /const call = \(body: unknown[^)]*\) => fetch\([\s\S]*?headers: \{[\s\S]*?"Content-Profile": "workspace_api"[\s\S]*?\}/,
    );
  });

  it("captures one PostgREST claims GUC before canonical relation access", async () => {
    const source = canonicalObservationSource(await readFile(runner, "utf8"));
    expect(source.match(/pg_catalog\.current_setting\('request\.jwt\.claims', true\)/g)).toHaveLength(1);
    expect(source).not.toMatch(/\bauth\.(uid|jwt|sessions)\b/);
    expect(source).not.toMatch(/\bauth\./);
    expect(source.indexOf("pg_catalog.current_setting")).toBeLessThan(
      source.indexOf("from workspace_private.organization_context"),
    );
  });

  it("keeps strict claims parsing and emits only a safe parity digest", async () => {
    const source = canonicalObservationSource(await readFile(runner, "utf8"));
    expect(source).toContain("jsonb_typeof(v_claims) <> 'object'");
    expect(source).toContain("jsonb_typeof(v_sub) <> 'string'");
    expect(source).toContain("jsonb_typeof(v_session) <> 'string'");
    expect(source).toContain("jsonb_typeof(v_exp) <> 'number'");
    expect(source).toContain("253402300799");
    expect(source).toContain("raise exception using errcode = 'VOT02'");
    expect(source).toContain("'claimsDigest'");
    expect(source).not.toContain("'sessionId'");
    expect(source).not.toContain("'userId'");
  });
});
