import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
	classifyNameStatus,
	parseNameStatus,
} from "../scripts/ci-path-scope";

const ALL_GATES = ["web-static", "etl-release", "e2e-release"];

describe("CI path scope", () => {
	it.each([
		["ordinary ETL changes", "M\0etl/loaders/results.py\0", ["etl-release"]],
		[
			"web runtime changes",
			"A\0apps/web/app/page.tsx\0",
			["web-static", "e2e-release"],
		],
		[
			"mixed ordinary changes",
			"M\0etl/loaders/results.py\0M\0apps/web/app/page.tsx\0",
			ALL_GATES,
		],
	] as const)("routes %s", (_name, input, gates) => {
		expect(classifyNameStatus(input).gates).toEqual(gates);
	});

	it.each([
		"M\0apps/web/pnpm-lock.yaml\0",
		"D\0etl/loaders/results.py\0",
		"R100\0etl/old.py\0etl/new.py\0",
		"T\0etl/loaders/results.py\0",
		"M\0.github/workflows/release-gates.yml\0",
		"M\0supabase/migrations/0001.sql\0",
		"M\0etl/archive/results.csv\0",
		"M\0etl/curated/results.csv\0",
		"M\0shared/contracts.ts\0",
		"M\0README.md\0",
		"M\0unknown/file.txt\0",
	])("fails closed for explicit escalation input %j", (input) => {
		expect(classifyNameStatus(input).gates).toEqual(ALL_GATES);
	});

	it("fails closed on malformed input and duplicate paths while preserving bounded inventory", () => {
		expect(classifyNameStatus("M\0etl/a.py").gates).toEqual(ALL_GATES);
		const result = classifyNameStatus("M\0etl/a.py\0M\0etl/a.py\0");
		expect(result.gates).toEqual(ALL_GATES);
		expect(result.inventory).toEqual({ records: 2, paths: 2, duplicates: 1 });
		expect(result.decisions).toHaveLength(2);
		expect(result.decisions.map(({ path }) => path)).toEqual([
			"etl/a.py",
			"etl/a.py",
		]);
	});

	it("parses NUL-delimited name-status records in order", () => {
		expect(parseNameStatus("A\0etl/a.py\0M\0apps/web/app/page.tsx\0")).toEqual([
			{ status: "A", paths: ["etl/a.py"] },
			{ status: "M", paths: ["apps/web/app/page.tsx"] },
		]);
	});

	it("rejects malformed scored non-rename statuses", () => {
		expect(() => parseNameStatus("M100\0etl/a.py\0")).toThrow(
			"invalid name-status record",
		);
	});

	it("provides a versioned stdin CLI contract without leaking checkout paths", () => {
		const script = new URL("../scripts/ci-path-scope.ts", import.meta.url);
		const result = spawnSync(
			process.execPath,
			["--experimental-strip-types", script.pathname, "--stdin"],
			{ encoding: "utf8", input: "M\0etl/a.py\0" },
		);
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({
			schemaVersion: 1,
			decision: "etl-only",
			gates: ["etl-release"],
			inventory: { records: 1, paths: 1, duplicates: 0 },
			decisions: [{ status: "M", path: "etl/a.py", reason: "etl" }],
		});
		expect(result.stdout).not.toContain(process.cwd());
	});

	it("makes main pushes explicit all-gate decisions", () => {
		const script = new URL("../scripts/ci-path-scope.ts", import.meta.url);
		const result = spawnSync(
			process.execPath,
			["--experimental-strip-types", script.pathname, "--all"],
			{ encoding: "utf8" },
		);
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout).gates).toEqual(ALL_GATES);
	});

	it("rejects an invalid CLI invocation with a non-zero exit", () => {
		const script = new URL("../scripts/ci-path-scope.ts", import.meta.url);
		const result = spawnSync(process.execPath, ["--experimental-strip-types", script.pathname], {
			encoding: "utf8",
		});
		expect(result.status).toBe(2);
		expect(result.stderr).toContain("usage:");
	});
});
