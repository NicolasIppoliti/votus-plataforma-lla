import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
const command = fileURLToPath(new URL("../scripts/etl-verification.ts", import.meta.url));
const webRoot = fileURLToPath(new URL("../", import.meta.url));

describe("verify:etl-isolated public command", () => {
  it("preflights the package command before exposing the read-only plan", () => {
    const preflight = spawnSync("pnpm", ["toolchain:check", "--scope", "etl"], {
      cwd: webRoot,
      env: { ...process.env, COREPACK_ENABLE_NETWORK: "0" },
      encoding: "utf8",
      timeout: 20_000,
    });
    const result = spawnSync("pnpm", ["verify:etl-isolated", "--plan"], {
      cwd: webRoot,
      env: { ...process.env, COREPACK_ENABLE_NETWORK: "0" },
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(preflight.error).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(preflight.status);
    if (preflight.status === 0) {
      expect(result.stdout).toContain("Plan: run etl-verify only inside a fresh isolated");
    } else {
      expect(preflight.stderr).toContain("Corré `mise install`");
      expect(result.stderr).toContain(preflight.stderr.trim());
      expect(result.stdout).not.toContain("Plan: run etl-verify");
    }
  });
  it("rejects invalid arguments directly with usage exit code before infrastructure actions", () => {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", command, "--invalid"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("details redacted");
  });

  it("prints an inspection plan without starting an isolated stack", () => {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", command, "--plan"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("etl-verify");
    expect(result.stdout).toContain("isolated");
    expect(result.stdout).not.toContain("127.0.0.1:54322");
  });
});
