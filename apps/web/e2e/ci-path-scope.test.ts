import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// Execute the workflow boundaries; structural tests separately cover Actions wiring.
const workflow = readFileSync(
	new URL("../../../.github/workflows/release-gates.yml", import.meta.url), "utf8",
);
function shellFor(step: string): string {
	const body = workflow.split(`- name: ${step}\n`)[1]
		?.split(/\n {6}- /)[0]?.match(/        run: \|\n((?: {10}[^\n]*\n)+)/)?.[1];
	if (!body) throw new Error(`missing workflow shell: ${step}`);
	return body.replace(/^ {10}/gm, "");
}
const patterns = [
	["all", '["web-static","etl-release","e2e-release"]', "success", "success", "success"],
	["etl-only", '["etl-release"]', "skipped", "success", "skipped"],
	["web-and-e2e", '["web-static","e2e-release"]', "success", "skipped", "success"],
] as const;
function verify(gates: string, results: string[]) {
	return spawnSync("bash", ["-euc", shellFor("Require all release gates")], {
		encoding: "utf8",
		env: {
			NODE_ENV: "test", PATH: process.env.PATH, SCOPE_GATES: gates,
			SCOPE_RESULT: results[0], WEB_STATIC_RESULT: results[1],
			ETL_RELEASE_RESULT: results[2], E2E_RELEASE_RESULT: results[3],
		},
	});
}
function publish(input: string) {
	const directory = mkdtempSync(join(tmpdir(), "ci-scope-output-"));
	try {
		const outputPath = join(directory, "github-output");
		writeFileSync(outputPath, "");
		const result = spawnSync("bash", ["-euc", shellFor("Publish scope gates")], {
			encoding: "utf8",
			env: {
				NODE_ENV: "test", PATH: process.env.PATH,
				SCOPE_JSON: input, GITHUB_OUTPUT: outputPath,
			},
		});
		return { ...result, publishedOutput: readFileSync(outputPath, "utf8") };
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}
describe("workflow scope boundaries", () => {
	it.each(patterns)("accepts only the exact %s result pattern", (_decision, gates, ...results) => {
		expect(verify(gates, ["success", ...results]).status).toBe(0);
		for (let index = 0; index < 4; index++) {
			for (const result of ["", "success", "skipped", "failure", "cancelled"]) {
				const altered = ["success", ...results];
				if (altered[index] === result) continue;
				altered[index] = result;
				expect(verify(gates, altered).status, `${index}: ${result}`).not.toBe(0);
			}
		}
	});
	it.each([
		"", "null", "{}", "[]", "not-json", '["web-static"]',
		'["etl-release","etl-release"]', '["unknown"]', '["e2e-release","web-static"]',
	])("rejects noncanonical aggregate gates %s", (gates) => {
		expect(verify(gates, ["success", "success", "success", "success"]).status).not.toBe(0);
	});
	it.each(patterns)("publishes canonical %s gates", (decision, gates) => {
		const result = publish(JSON.stringify({ schemaVersion: 1, decision, gates: JSON.parse(gates) }));
		expect(result.status, result.stderr).toBe(0);
		expect(result.publishedOutput).toBe(`gates=${gates}\n`);
		expect(result.stdout).toBe("");
	});
	it.each([
		null, {},
		{ schemaVersion: 2, decision: "all", gates: ALL_GATES },
		{ schemaVersion: 1, decision: "unknown", gates: ALL_GATES },
		{ schemaVersion: 1, decision: "etl-only", gates: ALL_GATES },
		...[undefined, [], ["unknown"], ["etl-release", "etl-release"]].map((gates) => ({
			schemaVersion: 1, decision: "etl-only", gates,
		})),
	])("rejects invalid publisher contract %j", (contract) => {
		const result = publish(JSON.stringify(contract));
		expect(result.publishedOutput).toBe("");
		expect(result.status).not.toBe(0);
		expect(result.stdout).toBe("");
	});
	it.each(["", "not-json"])("rejects malformed publisher JSON %j", (input) => {
		const result = publish(input);
		expect(result.publishedOutput).toBe("");
		expect(result.status).not.toBe(0);
		expect(result.stdout).toBe("");
	});
	it.each([
		"", "malformed", "M\0etl/a.py", "D\0etl/a.py\0", "R100\0etl/a.py\0etl/b.py\0",
		...[
			"etl/uv.lock", "apps/web/pnpm-lock.yaml", ".github/workflows/release-gates.yml",
			"README.md", "shared/a.ts", "supabase/tests/a.sql", "unknown/a",
			"etl/archive/a", "etl/curated/a",
		].map((path) => `M\0${path}\0`),
		"M\0etl/a.py\0M\0apps/web/app/page.tsx\0", "M\0etl/a.py\0M\0etl/a.py\0",
	])("keeps conservative CLI input %j on all gates", (input) => {
		const result = spawnSync(process.execPath, [
			"--experimental-strip-types",
			new URL("../scripts/ci-path-scope.ts", import.meta.url).pathname, "--stdin",
		], { encoding: "utf8", input });
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout).gates).toEqual(ALL_GATES);
		expect(publish(result.stdout).publishedOutput).toBe(`gates=${JSON.stringify(ALL_GATES)}\n`);
	});
});
