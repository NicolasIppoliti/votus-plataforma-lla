import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertCrossBrowserInventory } from "./release-gate-reporter";
import { runReleaseGateCli, createReleaseGatePlan, RELEASE_GATE_MODE } from "../scripts/e2e-gate-runtime";

const selected = ["e2e/auth.spec.ts", "e2e/review.spec.ts", "e2e/root.spec.ts", "e2e/municipal.spec.ts"];
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("bounded cross-browser gate", () => {
  it("rejects missing engines, duplicated journeys, and untagged discoveries", () => {
    const inventory = ["firefox", "webkit"].flatMap(project => selected.map(spec => ({ project, spec, tags: ["@cross-browser"] })));
    expect(() => assertCrossBrowserInventory(inventory)).not.toThrow();
    expect(() => assertCrossBrowserInventory(inventory.slice(1))).toThrow();
    expect(() => assertCrossBrowserInventory([...inventory, inventory[0]!])).toThrow();
    expect(() => assertCrossBrowserInventory(inventory.map(item => ({ ...item, project: "firefox" })))).toThrow();
    expect(() => assertCrossBrowserInventory(inventory.map(item => ({ ...item, tags: [] })))).toThrow();
  });
  it("reaches browser execution through the real lane parser with only critical specs", async () => {
    const execute = vi.fn(async () => undefined);
    await runReleaseGateCli(["--lane", "cross-browser"], { execute, writeOutput: () => undefined });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      mode: "cross-browser", selectedSpecs: selected, runBrowser: true, requireBrowserCapability: true, pgTapProofs: [],
    }));
    expect(createReleaseGatePlan(RELEASE_GATE_MODE.BROWSER).selectedSpecs).toHaveLength(10);
  });

  it.each([false, true])("selects Chrome by default and only bounded extra engines when opted in (%s)", async crossBrowser => {
    vi.stubEnv("VOTUS_E2E_BASE_URL", "http://127.0.0.1:3000");
    vi.stubEnv("VOTUS_E2E_STORAGE_STATE", "/owned/state.json");
    vi.stubEnv("VOTUS_E2E_CROSS_BROWSER", crossBrowser ? "1" : "");
    const { default: config } = await import("../playwright.config");
    expect(config.projects?.map(project => project.name)).toEqual(crossBrowser ? ["firefox", "webkit"] : ["chrome"]);
    if (crossBrowser) for (const project of config.projects ?? []) {
      expect(project.grep).toEqual(/@cross-browser/);
      expect(project.grepInvert).toEqual(/@chromium-only/);
      expect(project.use?.channel).toBeUndefined();
      expect(project.use?.browserName).toBe(project.name);
    }
    else expect(config.projects?.[0]?.use).toMatchObject({ browserName: "chromium", channel: "chrome" });
  });

  it("requires the additional CI job only on develop push and release PR, without replacing Chrome", () => {
    const workflow = readFileSync(new URL("../../../.github/workflows/release-gates.yml", import.meta.url), "utf8");
    const job = workflow.split("  e2e-cross-browser:\n")[1]?.split("  e2e-sql:\n")[0] ?? "";
    expect(job).toContain("github.event_name == 'push' && github.ref == 'refs/heads/develop'");
    expect(job).toContain("github.event_name == 'pull_request' && github.base_ref == 'main'");
    expect(job).toContain("pnpm exec playwright install --with-deps firefox webkit");
    expect(job).toContain("pnpm test:e2e:gate --lane cross-browser");
    expect(job).not.toContain("continue-on-error");
    expect(workflow).toContain('test "$E2E_CROSS_BROWSER_RESULT" = "$cross_browser"');
  });

  it("tags exactly the four reused critical journeys and scopes native zoom", () => {
    for (const spec of selected) {
      const source = readFileSync(new URL(`../${spec}`, import.meta.url), "utf8");
      expect(source.match(/tag: "@cross-browser"/g), spec).toHaveLength(1);
    }
    const review = readFileSync(new URL("./review.spec.ts", import.meta.url), "utf8");
    expect(review).toContain('tag: "@chromium-only"');
  });
});
