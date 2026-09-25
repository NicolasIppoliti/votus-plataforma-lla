import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
const command = fileURLToPath(new URL("../scripts/etl-verification.ts", import.meta.url));
const webRoot = fileURLToPath(new URL("../", import.meta.url));

describe("verify:etl-isolated public command", () => {
  it("exposes the read-only plan through the package command", () => {
    const result = spawnSync("corepack", ["pnpm", "verify:etl-isolated", "--plan"], {
      cwd: webRoot,
      env: { ...process.env, COREPACK_ENABLE_NETWORK: "0" },
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Plan: run etl-verify only inside a fresh isolated");
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
