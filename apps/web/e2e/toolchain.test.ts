import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { compareVersion, parsePins, parseVersion, selectTools, pythonProbe } from "../scripts/toolchain-check.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");
const web = JSON.parse(read("apps/web/package.json"));

describe("pure preflight logic", () => {
  it("parses exact mise pins", () => {
    expect(parsePins('[tools]\nnode = "24.21.0"\npnpm = "12.6.0"\npython = "3.13.12"\nuv = "0.12.19"')).toEqual({ node: "24.21.0", pnpm: "12.6.0", python: "3.13.12", uv: "0.12.19" });
    expect(() => parsePins('[tools]\nnode = "latest"')).toThrow();
  });
  it.each(["v24.21.0", "Python 24.21.0", "uv 24.21.0 (build)"])("parses %s", (output) => {
    expect(parseVersion(output)).toBe("24.21.0");
  });
  it("reports success, mismatch and missing tools", () => {
    expect(compareVersion("uv", "0.12.19", "0.12.19")).toBeNull();
    expect(compareVersion("uv", "0.12.19", "0.12.23")).toContain("uv 0.12.23 ≠ 0.12.19 fijado");
    expect(compareVersion("uv", "0.12.19", null)).toContain("no disponible");
    expect(compareVersion("supabase", "2.116.0", null)).toContain("pnpm install");
    expect(parseVersion("garbage")).toBeNull();
  });
  it("probes uv's ETL interpreter without syncing or installing", () => {
    expect(pythonProbe("0.12.19", "0.12.19")).toEqual({ command: "uv", args: ["run", "--project", "etl", "--no-sync", "--no-python-downloads", "python", "--version"] });
    expect(parseVersion("Python 3.13.12\n")).toBe("3.13.12");
  });
  it.each([null, "0.12.23"])("skips Python clearly when uv is unavailable or mismatched (%s)", (actual) => {
    expect(pythonProbe("0.12.19", actual)).toEqual({ skip: "Python no verificado: primero corregí la versión de uv; se omite su probe." });
  });
  it("checks only explicitly scoped tools without relying on CI detection", () => {
    expect(selectTools("web")).toEqual(["node", "pnpm", "supabase"]);
    expect(selectTools("etl")).toEqual(["node", "pnpm", "uv", "python"]);
    expect(selectTools("all")).toEqual(["node", "pnpm", "uv", "python", "supabase"]);
    expect(() => selectTools("unknown")).toThrow();
  });
});

describe("repository toolchain pins", () => {
  it("keeps every existing pin consistent with mise", () => {
    const mise = parsePins(read("mise.toml"));
    const pin = (tool: keyof typeof mise) => mise[tool];
    expect(pin("node")).toBe(read(".node-version").trim());
    expect(pin("python")).toBe(read(".python-version").trim());
    expect(`pnpm@${pin("pnpm")}`).toBe(web.packageManager);
    expect(`pnpm@${pin("pnpm")}`).toBe(JSON.parse(read("package.json")).packageManager);
    expect(pin("pnpm")).toBe(web.engines.pnpm);
    expect(web.engines.node).toBe(`${pin("node")?.split(".")[0]}.x`);
    expect(read("etl/pyproject.toml")).toContain(`required-version = "==${pin("uv")}"`);
    expect(web.devDependencies.supabase).toMatch(/^\d+\.\d+\.\d+$/);
    expect(read(".github/workflows/release-gates.yml")).toContain("devDependencies?.supabase");
    expect(web.scripts["toolchain:check"]).toBe("node --experimental-strip-types ./scripts/toolchain-check.ts");
    expect(JSON.parse(read("package.json")).scripts["toolchain:check"]).toBe("pnpm --dir apps/web toolchain:check");
  });
  it.each(["test:e2e:gate", "test:e2e:focused", "verify:etl-isolated"])("preflights %s before starting its runtime", (entry) => {
    expect(web.scripts[entry]).toMatch(new RegExp(`^pnpm toolchain:check --scope ${entry === "verify:etl-isolated" ? "etl" : "web"} && `));
  });
});
