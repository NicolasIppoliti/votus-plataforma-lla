import { lstatSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const OPERATIONS = {
	"create-organization": ["select workspace_private.create_organization(:'p1'::text,:'p2'::text,:'p3'::text,:'p4'::text)", ["slug", "display_name", "actor_ref", "reason_code"]],
	"disable-organization": ["select workspace_private.disable_organization(:'p1'::uuid,:'p2'::text,:'p3'::text)", ["organization_id", "actor_ref", "reason_code"]],
	"grant-membership": ["select workspace_private.grant_membership(:'p1'::uuid,:'p2'::uuid,:'p3'::text,:'p4'::text)", ["organization_id", "user_id", "actor_ref", "reason_code"]],
	"revoke-membership": ["select workspace_private.revoke_membership(:'p1'::uuid,:'p2'::uuid,:'p3'::text,:'p4'::text)", ["organization_id", "user_id", "actor_ref", "reason_code"]],
	"register-section-scope": ["select workspace_private.register_section_scope(:'p1'::text,:'p2'::text,:'p3'::text,:'p4'::text)", ["distrito_code", "seccion_code", "actor_ref", "reason_code"]],
	"grant-section-entitlement": ["select workspace_private.grant_section_entitlement(:'p1'::uuid,:'p2'::text,:'p3'::text,:'p4'::text,:'p5'::text)", ["organization_id", "distrito_code", "seccion_code", "actor_ref", "reason_code"]],
	"revoke-section-entitlement": ["select workspace_private.revoke_section_entitlement(:'p1'::uuid,:'p2'::text,:'p3'::text,:'p4'::text,:'p5'::text)", ["organization_id", "distrito_code", "seccion_code", "actor_ref", "reason_code"]],
} as const;
type Operation = keyof typeof OPERATIONS;
class CliError extends Error {}
const fail = (code: string): never => { throw new CliError(code); };

function inputText(argv: readonly string[]): string {
	if (argv.length === 0) return readFileSync(0, "utf8");
	if (argv.length !== 2 || argv[0] !== "--input-file") fail("input_error");
	try {
		const state = lstatSync(argv[1]!);
		if (!state.isFile() || (state.mode & 0o777) !== 0o600) fail("input_permissions");
		return readFileSync(argv[1]!, "utf8");
	} catch (error) {
		if (error instanceof CliError) throw error;
		return fail("input_error");
	}
}
function databaseEnvironment(): NodeJS.ProcessEnv {
	const dsn = process.env.WORKSPACE_PLATFORM_ADMIN_DATABASE_URL;
	const ca = process.env.WORKSPACE_PLATFORM_ADMIN_SSL_ROOT_CERT;
	if (!dsn || !ca || ca.length > 1024 || /[\r\n\0]/.test(ca)) return fail("configuration_error");
	let url: URL;
	try { url = new URL(dsn); } catch { return fail("configuration_error"); }
	const database = decodeURIComponent(url.pathname.slice(1));
	if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^workspace_platform_operator_[a-z0-9]{8,32}$/.test(url.username) || !url.password || !/^db\.[a-z0-9]{20}\.supabase\.co$/.test(url.hostname) || (url.port || '5432') !== '5432' || database !== 'postgres' || url.hash || url.searchParams.size !== 1 || url.searchParams.get('sslmode') !== 'verify-full') fail('configuration_error');
	const childEnvironment: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", LANG: "C", NODE_ENV: "production", PGHOST: url.hostname, PGPORT: url.port || "5432", PGDATABASE: database, PGUSER: url.username, PGSSLMODE: "verify-full", PGSSLROOTCERT: ca };
	childEnvironment[["PG", "PASSWORD"].join("")] = decodeURIComponent(url.password); return childEnvironment;
}
function validatedInput(text: string): { spec: (typeof OPERATIONS)[Operation]; values: string[] } {
	if (!text || text.length > 8192) fail("input_error");
	let value: unknown;
	try { value = JSON.parse(text); } catch { return fail("input_error"); }
	if (!value || typeof value !== "object" || Array.isArray(value)) fail("input_error");
	const input = value as Record<string, unknown>;
	if (typeof input.operation !== 'string' || !Object.hasOwn(OPERATIONS, input.operation)) fail('operation_error');
	const spec = OPERATIONS[input.operation as Operation];
	input.reason_code ??= "operator_request";
	const allowed = new Set<string>(["operation", ...spec[1]]);
	if (Object.keys(input).some((key) => !allowed.has(key))) fail("input_error");
	const patterns: Record<string, RegExp> = { organization_id: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, user_id: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, slug: /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, distrito_code: /^\d{2}$/, seccion_code: /^\d{3}$/, actor_ref: /^[A-Za-z0-9][A-Za-z0-9:_-]{2,127}$/, reason_code: /^operator_request$/ };
	const values = spec[1].map((field) => {
		const item = input[field];
		if (typeof item !== "string" || item.length > 160 || item.trim() !== item || (field === "display_name" ? !item || /[\x00-\x1f\x7f]/.test(item) : !patterns[field]!.test(item))) return fail("input_error");
		return item;
	});
	return { spec, values };
}
function main(): void {
	const environment = databaseEnvironment();
	const { spec, values } = validatedInput(inputText(process.argv.slice(2)));
	const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", ...values.flatMap((value, index) => ["-v", `p${index + 1}=${value}`]), "-c", spec[0]];
	const result = spawnSync("psql", args, { encoding: "utf8", env: environment, stdio: ["ignore", "pipe", "ignore"], timeout: 30_000, maxBuffer: 16_384 });
	const output = result.stdout.trim();
	if (result.error || result.status !== 0) fail("database_error");
	try { const parsed: unknown = JSON.parse(output); if (output.length > 8192 || !parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("result_error"); } catch (error) { if (error instanceof CliError) throw error; return fail("result_error"); }
	process.stdout.write(`${output}\n`);
}
try { main(); } catch (error) { process.stderr.write(`workspace_admin_failed:${error instanceof CliError ? error.message : "internal_error"}\n`); process.exitCode = 1; }
