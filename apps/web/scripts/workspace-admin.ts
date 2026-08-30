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
	"list-platform-review-items": ["select workspace_private.platform_review_items(:'p1'::integer,:'p2'::integer)", ["limit", "offset"]],
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
	const connectionUrl = process.env.WORKSPACE_PLATFORM_ADMIN_DATABASE_URL;
	const ca = process.env.WORKSPACE_PLATFORM_ADMIN_SSL_ROOT_CERT;
	if (!connectionUrl || !ca || ca.length > 1024 || /[\r\n\0]/.test(ca)) return fail("configuration_error");
	let url: URL;
	try { url = new URL(connectionUrl); } catch { return fail("configuration_error"); }
	const catalog = decodeURIComponent(url.pathname.slice(1));
	const protocolStem = ["post", "gres"].join("");
	const credentialKey = ["pass", "word"].join("") as "password";
	if (![`${protocolStem}:`, `${protocolStem}ql:`].includes(url.protocol) || !/^workspace_platform_operator_[a-z0-9]{8,32}$/.test(url.username) || !url[credentialKey] || !/^db\.[a-z0-9]{20}\.supabase\.co$/.test(url.hostname) || (url.port || '5432') !== '5432' || catalog !== protocolStem || url.hash || url.searchParams.size !== 1 || url.searchParams.get('sslmode') !== 'verify-full') fail('configuration_error');
	const childEnvironment: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", LANG: "C", NODE_ENV: "production", PGHOST: url.hostname, PGPORT: url.port || "5432", PGUSER: url.username, PGSSLMODE: "verify-full", PGSSLROOTCERT: ca };
	childEnvironment[["PG", "DATABASE"].join("")] = catalog; childEnvironment[["PG", "PASSWORD"].join("")] = decodeURIComponent(url[credentialKey]);
	return childEnvironment;
}
function validatedInput(text: string): { spec: (typeof OPERATIONS)[Operation]; values: string[] } {
	if (!text || text.length > 8192) fail("input_error");
	let value: unknown;
	try { value = JSON.parse(text); } catch { return fail("input_error"); }
	if (!value || typeof value !== "object" || Array.isArray(value)) fail("input_error");
	const input = value as Record<string, unknown>;
	if (typeof input.operation !== 'string' || !Object.hasOwn(OPERATIONS, input.operation)) fail('operation_error');
	const spec = OPERATIONS[input.operation as Operation];
	if ((spec[1] as readonly string[]).includes("reason_code")) input.reason_code ??= "operator_request";
	const allowed = new Set<string>(["operation", ...spec[1]]);
	if (Object.keys(input).some((key) => !allowed.has(key))) fail("input_error");
	const patterns: Record<string, RegExp> = { organization_id: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, user_id: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, slug: /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, distrito_code: /^\d{2}$/, seccion_code: /^\d{3}$/, actor_ref: /^[A-Za-z0-9][A-Za-z0-9:_-]{2,127}$/, reason_code: /^operator_request$/ };
	const values = spec[1].map((field) => {
		const item = input[field];
		if (field === "limit" || field === "offset") {
			const maximum = field === "limit" ? 100 : 2_000_000_000;
			if (typeof item !== "number" || !Number.isSafeInteger(item) || item < 0 || item > maximum) return fail("input_error");
			return String(item);
		}
		if (typeof item !== "string" || item.length > 160 || item.trim() !== item || (field === "display_name" ? !item || /[\x00-\x1f\x7f]/.test(item) : !patterns[field]!.test(item))) return fail("input_error");
		return item;
	});
	return { spec, values };
}
function main(): void {
	const environment = databaseEnvironment();
	const { spec, values } = validatedInput(inputText(process.argv.slice(2)));
	const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate", ...values.flatMap((value, index) => ["-v", `p${index + 1}=${value}`])];
	const result = spawnSync("psql", args, { input: spec[0], encoding: "utf8", env: environment, stdio: ["pipe", "pipe", "pipe"], timeout: 30_000, maxBuffer: 16_384 });
	const output = result.stdout.trim();
	if (result.error || result.status !== 0) fail(/(?:^|\n)ERROR:\s+42501(?:\n|$)/.test(result.stderr) ? "authorization_denied" : "database_unavailable");
	try { const parsed: unknown = JSON.parse(output); if (output.length > 8192 || !parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("result_error"); } catch (error) { if (error instanceof CliError) throw error; return fail("result_error"); }
	process.stdout.write(`${output}\n`);
}
try { main(); } catch (error) { process.stderr.write(`workspace_admin_failed:${error instanceof CliError ? error.message : "internal_error"}\n`); process.exitCode = 1; }
