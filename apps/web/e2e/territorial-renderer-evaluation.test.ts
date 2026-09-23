import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(import.meta.dirname, "..");

describe("territorial renderer evaluation command", () => {
	it("verifies the archived boundary and preserves the exact semantic fallback when WebGL fails", () => {
		const result = spawnSync("pnpm", ["--dir", webRoot, "evaluate:territorial-renderer", "--", "--verify"], {
			encoding: "utf8",
			timeout: 120_000,
		});
		expect(result.status, result.stderr).toBe(0);
		const report = JSON.parse(result.stdout) as Record<string, unknown>;
		expect(report).toMatchObject({
			archive: { source: "geography/arba-coronel-rosales-partido", bytes: 69544, sha256: "b502009185a5d6b1666312d2d91aa9b79053b2ee8a06f0aa683029b925c3ed13" },
			fallback: { webglFailure: "map unavailable", exactTableRetained: true },
			browser: { zoom200Method: "cdp-page-scale", zoom200EmulatedUsable: true, reducedMotionCameraChanged: true, reducedMotionDurationMs: 0, reducedMotionSettled: true, visibleKeyboardFocus: true },
		});
		expect(JSON.parse(spawnSync("pnpm", ["--dir", webRoot, "evaluate:territorial-renderer", "--", "--verify"], { encoding: "utf8", timeout: 120_000 }).stdout)).toEqual(report);
	}, 120_000);
});
