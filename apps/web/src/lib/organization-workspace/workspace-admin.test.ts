import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const SCRIPT = path.resolve(process.cwd(), "scripts/workspace-admin.ts");
const SECRET = "operator-password"; const DATABASE_URL = `postgresql://workspace_platform_operator_fixture1:${SECRET}@db.abcdefghijklmnopqrst.supabase.co:5432/postgres?sslmode=verify-full`;
const BASE_INPUT = { actor_ref: "operator:fixture-1" };

function run(input: unknown, environment: Record<string, string | undefined> = {}, args: string[] = []) {
	return spawnSync(process.execPath, ["--experimental-strip-types", SCRIPT, ...args], {
		input: input === undefined ? undefined : JSON.stringify(input), encoding: "utf8",
		env: { PATH: process.env.PATH, NODE_ENV: "test", ...environment },
	});
}

describe("workspace operator CLI", () => {
	it("fails closed before psql when configuration or input is invalid", () => {
		const directory = mkdtempSync(path.join(tmpdir(), "workspace-admin-red-"));
		const marker = path.join(directory, "called");
		const fake = path.join(directory, "psql"); const badInput = path.join(directory, "bad.json"); writeFileSync(badInput, "{}"); chmodSync(badInput, 0o644);
		writeFileSync(fake, `#!/usr/bin/env node\nrequire("fs").writeFileSync(${JSON.stringify(marker)},"")`); chmodSync(fake, 0o700);
		for (const [input, env, args = []] of [
			[BASE_INPUT, {}, []],
			[undefined, { WORKSPACE_PLATFORM_ADMIN_DATABASE_URL: DATABASE_URL }, []],
			[{ ...BASE_INPUT, operation: "unknown" }, { WORKSPACE_PLATFORM_ADMIN_DATABASE_URL: DATABASE_URL }, []],
			[{ ...BASE_INPUT, operation: "toString" }, { WORKSPACE_PLATFORM_ADMIN_DATABASE_URL: DATABASE_URL }, []],
			[{ ...BASE_INPUT, operation: "create-organization", slug: "x", display_name: "X", extra: "x" }, { WORKSPACE_PLATFORM_ADMIN_DATABASE_URL: DATABASE_URL }, []],
			[undefined, { WORKSPACE_PLATFORM_ADMIN_DATABASE_URL: DATABASE_URL }, ["--input-file", badInput]],
			[BASE_INPUT, { WORKSPACE_PLATFORM_ADMIN_DATABASE_URL: DATABASE_URL.replace("db.abcdefghijklmnopqrst.supabase.co", "db.example.test") }, []],
		] as const) {
			const result = run(input, { PATH: `${directory}:${process.env.PATH}`, ...env, WORKSPACE_PLATFORM_ADMIN_SSL_ROOT_CERT: "/operator/ca.pem" }, [...args]);
			expect(result.status).toBe(1);
			expect(result.stderr).toMatch(/^workspace_admin_failed:[a-z_]+\n$/);
			expect(result.stderr).not.toContain(SECRET);
		}
		expect(() => readFileSync(marker)).toThrow();
	});

	it("lists bounded platform review items and classifies only SQLSTATE 42501 as denial", () => {
		const directory = mkdtempSync(path.join(tmpdir(), "workspace-admin-review-"));
		const marker = path.join(directory, "call.json");
		const fake = path.join(directory, "psql");
		writeFileSync(fake, `#!/usr/bin/env node\nconst fs=require("fs"),stdin=fs.readFileSync(0,"utf8"),argv=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({argv,stdin}));const p=argv.find(v=>v.startsWith('p1='));if(p==='p1=41'){process.stderr.write('ERROR:  42501\\nDETAIL: private');process.exit(1)}if(p==='p1=42'){process.stderr.write('ERROR:  08006\\nDETAIL: private');process.exit(1)}process.stdout.write('{"status":"ok","items":[],"category_counts":[],"reason_counts":[],"total":1,"truncated":false,"exclusions":[]}')`);
		chmodSync(fake, 0o700);
		const environment = { PATH: `${directory}:${process.env.PATH}`, WORKSPACE_PLATFORM_ADMIN_DATABASE_URL: DATABASE_URL, WORKSPACE_PLATFORM_ADMIN_SSL_ROOT_CERT: "/operator/ca.pem" };
		for (const input of [
			{ operation: "list-platform-review-items", limit: -1, offset: 0 },
			{ operation: "list-platform-review-items", limit: 101, offset: 0 },
			{ operation: "list-platform-review-items", limit: 1, offset: -1 },
			{ operation: "list-platform-review-items", limit: 1, offset: 2_000_000_001 },
			{ operation: "list-platform-review-items", limit: "1", offset: 0 },
		]) expect(run(input, environment).stderr).toBe("workspace_admin_failed:input_error\n");
		const successInput = { operation: "list-platform-review-items", limit: 0, offset: 2_000_000_000 } as const;
		const success = run(successInput, environment);
		expect(success).toMatchObject({ status: 0, stderr: "" });
		expect(success.stdout).toContain('"status":"ok"');
		const call = JSON.parse(readFileSync(marker, "utf8")) as { argv: string[]; stdin: string };
		const sql = "select workspace_private.platform_review_items(:'p1'::integer,:'p2'::integer)";
		expect(call).toMatchObject({ stdin: sql });
		expect(call.stdin).not.toBe(JSON.stringify(successInput));
		expect(call.argv).not.toContain("-c");
		expect(call.argv).not.toContain(sql);
		expect(call.argv.join(" ")).not.toContain("workspace_private.");
		expect(call.argv.filter((value) => /^p\d+=/.test(value))).toEqual(["p1=0", "p2=2000000000"]);
		for (const token of ["p1=0", "p2=2000000000"]) expect(call.argv[call.argv.indexOf(token) - 1]).toBe("-v");
		for (const [limit, classification] of [[41, "authorization_denied"], [42, "database_unavailable"]] as const) {
			const result = run({ operation: "list-platform-review-items", limit, offset: 0 }, environment);
			expect(result).toMatchObject({ status: 1, stdout: "", stderr: `workspace_admin_failed:${classification}\n` });
			expect(result.stderr).not.toContain("private");
		}
	});

	it("dispatches every mutating operation to its private function with bounded parameters", () => {
		const directory = mkdtempSync(path.join(tmpdir(), "workspace-admin-"));
		const marker = path.join(directory, "call.json");
		const fake = path.join(directory, "psql");
		writeFileSync(fake, `#!/usr/bin/env node\nconst fs=require("fs"),stdin=fs.readFileSync(0,"utf8");fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({argv:process.argv.slice(2),stdin,password:process.env.PGPASSWORD,sslmode:process.env.PGSSLMODE,ca:process.env.PGSSLROOTCERT,keys:Object.keys(process.env).sort()}));process.stdout.write('{"changed":true}');`);
		chmodSync(fake, 0o700);
		const environment = { PATH: `${directory}:${process.env.PATH}`, WORKSPACE_PLATFORM_ADMIN_DATABASE_URL: DATABASE_URL, WORKSPACE_PLATFORM_ADMIN_SSL_ROOT_CERT: "/operator/ca.pem" };
		const inputFile = path.join(directory, "input.json");
		writeFileSync(inputFile, JSON.stringify({ operation: "create-organization", ...BASE_INPUT, slug: "file-org", display_name: "File Org" }), { mode: 0o600 });
		expect(run(undefined, environment, ["--input-file", inputFile]).status).toBe(0);
		const cases = [
			["create-organization", { slug: "fixture-org", display_name: "Fixture Org" }, "select workspace_private.create_organization(:'p1'::text,:'p2'::text,:'p3'::text,:'p4'::text)"],
			["disable-organization", { organization_id: "00000000-0000-4000-8000-000000000001" }, "select workspace_private.disable_organization(:'p1'::uuid,:'p2'::text,:'p3'::text)"],
			["grant-membership", { organization_id: "00000000-0000-4000-8000-000000000001", user_id: "00000000-0000-4000-8000-000000000002" }, "select workspace_private.grant_membership(:'p1'::uuid,:'p2'::uuid,:'p3'::text,:'p4'::text)"],
			["revoke-membership", { organization_id: "00000000-0000-4000-8000-000000000001", user_id: "00000000-0000-4000-8000-000000000002" }, "select workspace_private.revoke_membership(:'p1'::uuid,:'p2'::uuid,:'p3'::text,:'p4'::text)"],
			["register-section-scope", { distrito_code: "02", seccion_code: "027" }, "select workspace_private.register_section_scope(:'p1'::text,:'p2'::text,:'p3'::text,:'p4'::text)"],
			["grant-section-entitlement", { organization_id: "00000000-0000-4000-8000-000000000001", distrito_code: "02", seccion_code: "027" }, "select workspace_private.grant_section_entitlement(:'p1'::uuid,:'p2'::text,:'p3'::text,:'p4'::text,:'p5'::text)"],
			["revoke-section-entitlement", { organization_id: "00000000-0000-4000-8000-000000000001", distrito_code: "02", seccion_code: "027" }, "select workspace_private.revoke_section_entitlement(:'p1'::uuid,:'p2'::text,:'p3'::text,:'p4'::text,:'p5'::text)"],
		] as const;
		for (const [operation, fields, sql] of cases) {
			const success = '{"changed":true}';
			const result = run({ operation, ...BASE_INPUT, ...fields }, environment);
			expect(result).toMatchObject({ status: 0, stdout: `${success}\n`, stderr: "" });
			const call = JSON.parse(readFileSync(marker, "utf8")) as { argv: string[]; stdin: string; password: string; sslmode: string; ca: string; keys: string[] };
			const expectedValues = [...Object.values(fields), BASE_INPUT.actor_ref, "operator_request"];
			const parameterTokens = call.argv.filter((value) => /^p\d+=/.test(value));
			expect(call.stdin).toBe(sql);
			expect(call.stdin).not.toBe(JSON.stringify({ operation, ...BASE_INPUT, ...fields }));
			expect(call.argv).not.toContain("-c");
			expect(call.argv).not.toContain(sql);
			expect(call.argv.join(" ")).not.toContain("workspace_private.");
			expect(parameterTokens.map((value) => value.slice(value.indexOf("=") + 1))).toEqual(expectedValues);
			for (const token of parameterTokens) expect(call.argv[call.argv.indexOf(token) - 1]).toBe("-v");
			expect(call).toMatchObject({ password: SECRET, sslmode: "verify-full", ca: "/operator/ca.pem" }); expect(call.keys.filter((key) => !key.startsWith("__CF_"))).toEqual(["HOME", "LANG", "NODE_ENV", "PATH", "PGDATABASE", "PGHOST", "PGPASSWORD", "PGPORT", "PGSSLMODE", "PGSSLROOTCERT", "PGUSER"]);
			for (const secret of [SECRET, DATABASE_URL]) expect(`${call.argv.join(" ")} ${call.stdin} ${result.stdout} ${result.stderr}`).not.toContain(secret);
		}
	});
});
