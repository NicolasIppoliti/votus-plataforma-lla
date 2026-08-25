import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const RUNNER = path.join(
	WEB_ROOT,
	"scripts/organization-access-hosted-trust-rotation.ts",
);
const REQUIRED_ENVIRONMENT = [
	"SUPABASE_URL",
	"SUPABASE_ANON_KEY",
	"SUPABASE_DATABASE_URL",
	"SUPABASE_DB_CA_CERT_FILE",
	"SUPABASE_MANAGEMENT_PAT",
	"SUPABASE_FIXTURE_ADMIN_KEY",
	"SUPABASE_EXPECTED_TARGET_DIGEST",
	"ORGANIZATION_ACCESS_HOSTED_PROOF_CONFIRMATION",
];

function invoke(args: readonly string[], env: Record<string, string | undefined> = {}) {
	const childEnvironment: NodeJS.ProcessEnv = {
		...env,
		NODE_ENV: "test",
		PATH: env.PATH ?? process.env.PATH,
	};
	return spawnSync(process.execPath, ["--experimental-strip-types", RUNNER, ...args], {
		cwd: WEB_ROOT,
		encoding: "utf8",
		env: childEnvironment,
		timeout: 10_000,
	});
}

describe("disposable hosted trust-rotation runner", () => {
	it("fails closed before mutation without the complete authorization guard", () => {
		const result = invoke([]);

		expect(result.status).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toBe("organization hosted proof refused: guard\n");
	});

	it.each([
		["insecure API", { SUPABASE_URL: "http://abcdefghijklmnop.supabase.co" }],
		["nonstandard API port", { SUPABASE_URL: "https://abcdefghijklmnop.supabase.co:444" }],
		["invalid database", { SUPABASE_DATABASE_URL: "http://db.example.invalid/postgres" }],
		["target digest mismatch", {}],
	])("rejects a populated %s guard before I/O", (_name, override) => {
		const fixture = mkdtempSync(path.join(os.tmpdir(), "organization-guard-test-"));
		const bin = path.join(fixture, "bin");
		const marker = path.join(fixture, "subprocess-called");
		const caFile = path.join(fixture, "ca.crt");
		mkdirSync(bin);
		writeFileSync(caFile, "test-only-ca");
		for (const command of ["supabase", "psql"]) {
			const executable = path.join(bin, command);
			writeFileSync(executable, `#!/bin/sh\n: > '${marker}'\nexit 99\n`);
			chmodSync(executable, 0o700);
		}
		const scratchBefore = readdirSync(os.tmpdir()).filter((name) =>
			name.startsWith("organization-access-hosted-proof-"),
		);
		try {
			const result = invoke([], {
				PATH: bin,
				SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
				SUPABASE_ANON_KEY: "test-anon-key",
				SUPABASE_DATABASE_URL:
					"postgresql://ignored:ignored@db.abcdefghijklmnop.supabase.co:5432/postgres",
				SUPABASE_DB_CA_CERT_FILE: caFile,
				SUPABASE_MANAGEMENT_PAT: "test-management-pat",
				SUPABASE_FIXTURE_ADMIN_KEY: "test-fixture-admin-key",
				SUPABASE_EXPECTED_TARGET_DIGEST: "0".repeat(64),
				ORGANIZATION_ACCESS_HOSTED_PROOF_CONFIRMATION:
					"DISPOSABLE_HOSTED_ORGANIZATION_ACCESS_PROOF",
				...override,
			});
			expect(result.status).toBe(1);
			expect(result.stdout).toBe("");
			expect(result.stderr).toBe("organization hosted proof refused: guard\n");
			expect(readdirSync(os.tmpdir()).filter((name) =>
				name.startsWith("organization-access-hosted-proof-"),
			)).toEqual(scratchBefore);
			expect(existsSync(marker)).toBe(false);
		} finally {
			rmSync(fixture, { force: true, recursive: true });
		}
	});

	it("plans a sanitized no-I/O proof without creating scratch state", () => {
		const prefix = "organization-access-hosted-proof-";
		const before = readdirSync(os.tmpdir()).filter((name) => name.startsWith(prefix));
		const result = invoke(["--plan"]);
		const after = readdirSync(os.tmpdir()).filter((name) => name.startsWith(prefix));

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(after).toEqual(before);
		const plan = JSON.parse(result.stdout) as Record<string, unknown>;
		expect(plan).toEqual({
			protocol: "organization-access-hosted-proof/v1",
			mode: "plan",
			mutation: false,
			requiredEnvironment: REQUIRED_ENVIRONMENT,
			phases: [
				"guard",
				"collision-check",
				"provision",
				"auth-context",
				"bounded-probes",
				"rotation",
				"log-scan",
				"cleanup",
			],
			privilegedCommand: [
				"supabase",
				"db",
				"query",
				"--linked",
				"--project-ref",
				"<project-ref>",
				"--file",
				"<0600-scratch-sql>",
			],
			evidenceKeys: ["protocol", "protocolVersion", "status", "checks", "counts"],
			networkProcesses: 0,
			scratchFiles: 0,
		});
	});
});
