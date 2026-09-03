import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const GATE = {
	WEB_STATIC: "web-static",
	ETL_RELEASE: "etl-release",
	E2E_RELEASE: "e2e-release",
} as const;
const DECISION = {
	ALL: "all",
	ETL_ONLY: "etl-only",
	WEB_AND_E2E: "web-and-e2e",
} as const;
const REASON = {
	ETL: "etl",
	WEB: "web-runtime",
	LOCKFILE: "lockfile",
	STATUS: "change-status",
	WORKFLOW: "workflow",
	SUPABASE: "supabase",
	ARCHIVE: "archive",
	CURATED: "curated",
	SHARED: "shared",
	ROOT: "root",
	UNKNOWN: "unknown",
	DUPLICATE: "duplicate",
	MALFORMED: "malformed-input",
} as const;

type Gate = (typeof GATE)[keyof typeof GATE];
type Decision = (typeof DECISION)[keyof typeof DECISION];
type Reason = (typeof REASON)[keyof typeof REASON];

interface NameStatusRecord {
	status: string;
	paths: string[];
}

interface Inventory {
	records: number;
	paths: number;
	duplicates: number;
}

interface PathDecision {
	status: string;
	path: string;
	reason: Reason;
}

interface ScopeResult {
	schemaVersion: number;
	decision: Decision;
	gates: Gate[];
	inventory: Inventory;
	decisions: PathDecision[];
}

const ALL_GATES: Gate[] = [GATE.WEB_STATIC, GATE.ETL_RELEASE, GATE.E2E_RELEASE];
const WEB_GATES: Gate[] = [GATE.WEB_STATIC, GATE.E2E_RELEASE];
const ORDINARY_REASONS = new Set<Reason>([REASON.ETL, REASON.WEB]);
const LOCKFILE = /(^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|uv\.lock|poetry\.lock)$/;

export function parseNameStatus(input: string): NameStatusRecord[] {
	if (!input.endsWith("\0")) throw new Error("NUL-delimited input must end with NUL");
	const fields = input.slice(0, -1).split("\0");
	if (fields.length === 1 && fields[0] === "") return [];
	const records: NameStatusRecord[] = [];
	for (let index = 0; index < fields.length; ) {
		const status = fields[index++];
		if (!status || !/^(?:[ADMTUXB]|[RC][0-9]+)$/.test(status))
			throw new Error("invalid name-status record");
		const pathCount = /^(?:R|C)/.test(status) ? 2 : 1;
		const paths = fields.slice(index, index + pathCount);
		if (paths.length !== pathCount || paths.some((path) => path.length === 0))
			throw new Error("name-status record is missing a path");
		index += pathCount;
		records.push({ status, paths });
	}
	return records;
}

function classifyPath(path: string, status: string, duplicate: boolean): Reason {
	if (duplicate) return REASON.DUPLICATE;
	if (!/^[AM]$/.test(status)) return REASON.STATUS;
	if (LOCKFILE.test(path)) return REASON.LOCKFILE;
	if (path.startsWith(".github/workflows/")) return REASON.WORKFLOW;
	if (path.startsWith("supabase/")) return REASON.SUPABASE;
	if (path === "archive" || path.startsWith("archive/") || path.includes("/archive/"))
		return REASON.ARCHIVE;
	if (path === "curated" || path.startsWith("curated/") || path.includes("/curated/"))
		return REASON.CURATED;
	if (path === "shared" || path.startsWith("shared/") || path.includes("/shared/"))
		return REASON.SHARED;
	if (!path.includes("/")) return REASON.ROOT;
	if (path.startsWith("etl/")) return REASON.ETL;
	if (path.startsWith("apps/web/")) return REASON.WEB;
	return REASON.UNKNOWN;
}

function boundedPath(path: string): string {
	const safePath = path.startsWith("/") ? "<invalid-path>" : path;
	return safePath.length <= 240 ? safePath : `${safePath.slice(0, 239)}…`;
}

function resultFor(
	decision: Decision,
	inventory: Inventory,
	decisions: PathDecision[],
): ScopeResult {
	const gates =
		decision === DECISION.ETL_ONLY
			? [GATE.ETL_RELEASE]
			: decision === DECISION.WEB_AND_E2E
				? WEB_GATES
				: ALL_GATES;
	return { schemaVersion: 1, decision, gates, inventory, decisions };
}

export function classifyNameStatus(input: string): ScopeResult {
	let records: NameStatusRecord[];
	try {
		records = parseNameStatus(input);
	} catch {
		return resultFor(DECISION.ALL, { records: 0, paths: 0, duplicates: 0 }, [
			{ status: "?", path: "<input>", reason: REASON.MALFORMED },
		]);
	}
	const allPaths = records.flatMap(({ paths }) => paths);
	const occurrences = new Map<string, number>();
	for (const path of allPaths) occurrences.set(path, (occurrences.get(path) ?? 0) + 1);
	const inventory = {
		records: records.length,
		paths: allPaths.length,
		duplicates: [...occurrences.values()].filter((count) => count > 1).length,
	};
	const decisions = records.flatMap(({ status, paths }) =>
		paths.map((path) => ({
			status,
			path: boundedPath(path),
			reason: classifyPath(path, status, (occurrences.get(path) ?? 0) > 1),
		})),
	);
	if (records.length === 0 || decisions.some(({ reason }) => !ORDINARY_REASONS.has(reason)))
		return resultFor(DECISION.ALL, inventory, decisions);
	const reasons = new Set(decisions.map(({ reason }) => reason));
	if (reasons.size === 1 && reasons.has(REASON.ETL))
		return resultFor(DECISION.ETL_ONLY, inventory, decisions);
	if (reasons.size === 1 && reasons.has(REASON.WEB))
		return resultFor(DECISION.WEB_AND_E2E, inventory, decisions);
	return resultFor(DECISION.ALL, inventory, decisions);
}

function usage(): string {
	return "usage: ci-path-scope.ts --stdin | --all | --base <sha> --head <sha>";
}

function diffNameStatus(base: string, head: string): string {
	const result = spawnSync(
		"git",
		["diff", "--name-status", "-z", "--find-renames", "--diff-filter=ACDMRTUXB", base, head],
		{ encoding: "utf8" },
	);
	if (result.status !== 0 || typeof result.stdout !== "string")
		throw new Error("git diff name-status failed");
	return result.stdout;
}

export function main(argv: readonly string[], stdin = readFileSync(0, "utf8")): ScopeResult {
	if (argv.length === 1 && argv[0] === "--stdin") return classifyNameStatus(stdin);
	if (argv.length === 1 && argv[0] === "--all")
		return resultFor(DECISION.ALL, { records: 0, paths: 0, duplicates: 0 }, []);
	if (argv.length === 4 && argv[0] === "--base" && argv[2] === "--head")
		return classifyNameStatus(diffNameStatus(argv[1]!, argv[3]!));
	throw new Error(usage());
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
	try {
		process.stdout.write(`${JSON.stringify(main(process.argv.slice(2)))}\n`);
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : usage()}\n`);
		process.exitCode = 2;
	}
}
