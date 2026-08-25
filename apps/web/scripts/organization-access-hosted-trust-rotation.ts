import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROTOCOL = "organization-access-hosted-proof/v1";
const CONFIRMATION = "DISPOSABLE_HOSTED_ORGANIZATION_ACCESS_PROOF";
const REQUIRED_ENVIRONMENT = [
	"SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_DATABASE_URL",
	"SUPABASE_DB_CA_CERT_FILE", "SUPABASE_MANAGEMENT_PAT", "SUPABASE_FIXTURE_ADMIN_KEY",
	"SUPABASE_EXPECTED_TARGET_DIGEST", "ORGANIZATION_ACCESS_HOSTED_PROOF_CONFIRMATION",
] as const;
const PHASES = [
	"guard", "collision-check", "provision", "auth-context", "bounded-probes",
	"rotation", "log-scan", "cleanup",
] as const;
const EVIDENCE_KEYS = ["protocol", "protocolVersion", "status", "checks", "counts"] as const;
const PSQL_CAUSE = {
	OK: "ok", CONNECTION_LIMIT: "connection_limit", LOCK_TIMEOUT: "lock_timeout",
	IDLE_TIMEOUT: "idle_timeout", STATEMENT_TIMEOUT: "statement_timeout",
	PERMISSION_DENIED: "permission_denied", CONNECTIVITY: "connectivity", TLS: "tls", OTHER: "other",
} as const;
type PsqlCause = (typeof PSQL_CAUSE)[keyof typeof PSQL_CAUSE];
const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../..");

interface GuardedEnvironment {
	url: string; anonKey: string; database: URL; caFile: string; pat: string; fixtureAdminKey: string; projectRef: string;
}
interface Names {
	privateSchema: string; apiSchema: string; owner: string; caller: string;
	contextOwner: string; loginA: string; loginB: string;
}
interface PsqlResult { ok: boolean; cause: PsqlCause; stdout: string }

function plan(): void {
	process.stdout.write(`${JSON.stringify({
		protocol: PROTOCOL, mode: "plan", mutation: false,
		requiredEnvironment: REQUIRED_ENVIRONMENT, phases: PHASES,
		privilegedCommand: ["supabase", "db", "query", "--linked", "--project-ref", "<project-ref>", "--file", "<0600-scratch-sql>"],
		evidenceKeys: EVIDENCE_KEYS, networkProcesses: 0, scratchFiles: 0,
	})}\n`);
}
function secret(name: (typeof REQUIRED_ENVIRONMENT)[number]): string {
	const value = process.env[name];
	if (!value) throw new Error("guard");
	return value;
}
function targetIdentity(projectRef: string, endpoint: URL, database: URL): string {
	return [projectRef, endpoint.protocol, endpoint.hostname, endpoint.port || "443",
		database.hostname, database.port || "5432", database.pathname.slice(1)].join("|");
}
async function guard(argv: readonly string[]): Promise<GuardedEnvironment> {
	if (argv.length !== 0) throw new Error("guard");
	const url = secret("SUPABASE_URL"); const anonKey = secret("SUPABASE_ANON_KEY");
	const database = new URL(secret("SUPABASE_DATABASE_URL"));
	const caFile = secret("SUPABASE_DB_CA_CERT_FILE"); const pat = secret("SUPABASE_MANAGEMENT_PAT"); const fixtureAdminKey = secret("SUPABASE_FIXTURE_ADMIN_KEY");
	const expected = secret("SUPABASE_EXPECTED_TARGET_DIGEST");
	if (secret("ORGANIZATION_ACCESS_HOSTED_PROOF_CONFIRMATION") !== CONFIRMATION) throw new Error("guard");
	const endpoint = new URL(url); const match = url.match(/^https:\/\/([a-z0-9]{16,20})\.supabase\.co\/?$/);
	if (!match || endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.port
		|| endpoint.pathname !== "/" || endpoint.search || endpoint.hash || database.protocol !== "postgresql:"
		|| !database.hostname || !database.pathname.slice(1)) throw new Error("guard");
	const digest = createHash("sha256").update(targetIdentity(match[1]!, endpoint, database)).digest("hex");
	if (!/^[a-f0-9]{64}$/.test(expected) || expected !== digest) throw new Error("guard");
	if (!(await stat(caFile)).isFile()) throw new Error("guard");
	return { url, anonKey, database, caFile, pat, fixtureAdminKey, projectRef: match[1]! };
}
function names(): Names {
	const nonce = randomBytes(8).toString("hex");
	return { privateSchema: `oap_${nonce}`, apiSchema: `oaa_${nonce}`, owner: `oao_${nonce}`,
		caller: `oac_${nonce}`, contextOwner: `oax_${nonce}`, loginA: `oala_${nonce}`, loginB: `oalb_${nonce}` };
}
function literal(value: string): string { return `'${value.replaceAll("'", "''")}'`; }
async function admin(environment: GuardedEnvironment, sql: string, phase: string): Promise<string> {
	const scratch = await mkdtemp(path.join(os.tmpdir(), "organization-access-hosted-proof-"));
	const file = path.join(scratch, "proof.sql");
	try {
		await writeFile(file, sql, { mode: 0o600 });
		const result = spawnSync("supabase", ["db", "query", "--linked", "--project-ref", environment.projectRef, "--file", file], {
			cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000,
			env: { NODE_ENV: "test", PATH: process.env.PATH, HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME },
		});
		if (result.error) { const errorCode = (result.error as NodeJS.ErrnoException).code ?? ""; const code = ["ETIMEDOUT", "ENOBUFS", "ENOENT"].includes(errorCode) ? errorCode : "UNKNOWN"; throw new Error(`admin_${phase}_process_${code}`); }
		if (result.status !== 0) {
			const diagnostic = `${result.stdout}\n${result.stderr}`; const kind = /syntax error/i.test(diagnostic) ? "syntax" : /permission denied/i.test(diagnostic) ? "permission" : /must be member/i.test(diagnostic) ? "membership" : /configuration parameter|invalid value/i.test(diagnostic) ? "setting" : /more than one row/i.test(diagnostic) ? "cardinality" : /dependent objects/i.test(diagnostic) ? "dependency" : "unknown"; const state = diagnostic.match(/\b([0-9A-Z]{5})\b/)?.[1];
			throw new Error(`admin_${phase}_${kind}${state ? `_${state}` : ""}`);
		}
		return result.stdout;
	} finally { try { await unlink(file); } finally { await rmdir(scratch); } }
}
function psqlArgs(environment: GuardedEnvironment): string[] {
	return ["-X", "-v", "ON_ERROR_STOP=1", "-h", environment.database.hostname,
		"-p", environment.database.port || "5432", "-d", environment.database.pathname.slice(1)];
}
function psqlEnv(environment: GuardedEnvironment, role: string, password: string): NodeJS.ProcessEnv {
	return { NODE_ENV: "test", PATH: process.env.PATH, PGUSER: role, PGPASSWORD: password,
		PGHOST: environment.database.hostname, PGPORT: environment.database.port || "5432",
		PGDATABASE: environment.database.pathname.slice(1), PGSSLMODE: "verify-full",
		PGSSLROOTCERT: environment.caFile, PGAPPNAME: "organization_access_hosted_proof" };
}
function appendBounded(current: string, chunk: unknown): string { return (current + String(chunk)).slice(0, 4096); }
function classify(stderr: string, ok: boolean): PsqlCause {
	if (ok) return PSQL_CAUSE.OK;
	if (/too many connections for role|connection limit exceeded|remaining connection slots are reserved/i.test(stderr)) return PSQL_CAUSE.CONNECTION_LIMIT;
	if (/canceling statement due to lock timeout/i.test(stderr)) return PSQL_CAUSE.LOCK_TIMEOUT;
	if (/terminating connection due to idle-in-transaction timeout/i.test(stderr)) return PSQL_CAUSE.IDLE_TIMEOUT;
	if (/canceling statement due to statement timeout/i.test(stderr)) return PSQL_CAUSE.STATEMENT_TIMEOUT;
	if (/permission denied for (?:table|schema|function)/i.test(stderr)) return PSQL_CAUSE.PERMISSION_DENIED;
	if (/certificate|ssl|tls/i.test(stderr)) return PSQL_CAUSE.TLS;
	if (/could not connect|connection .*failed|server closed the connection|connection refused|network is unreachable|no route to host|could not translate host/i.test(stderr)) return PSQL_CAUSE.CONNECTIVITY;
	return PSQL_CAUSE.OTHER;
}
function runPsql(environment: GuardedEnvironment, role: string, password: string, sql: string, timeout = 8_000, onStdout?: (output: string) => void): Promise<PsqlResult> {
	return new Promise((resolve) => {
		const child = spawn("psql", [...psqlArgs(environment), "-c", sql], {
			env: psqlEnv(environment, role, password), stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = ""; let stderr = ""; let settled = false;
		child.stdout.on("data", (chunk) => { stdout = appendBounded(stdout, chunk); onStdout?.(stdout); });
		child.stderr.on("data", (chunk) => { stderr = appendBounded(stderr, chunk); });
		const finish = (ok: boolean) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ ok, cause: classify(stderr, ok), stdout }); } };
		const timer = setTimeout(() => { stderr = appendBounded(stderr, "client deadline exceeded"); child.kill("SIGKILL"); }, timeout);
		child.once("error", (error) => { stderr = appendBounded(stderr, error.message); finish(false); });
		child.once("exit", (code) => { finish(code === 0); });
	});
}
function holdConnection(environment: GuardedEnvironment, role: string, password: string, statement = "select '__HOLDER__';", marker = "__HOLDER__") {
	const child = spawn("psql", psqlArgs(environment), { env: psqlEnv(environment, role, password), stdio: ["pipe", "pipe", "pipe"] }); let stdout = ""; let stderr = ""; let wake: (value: boolean) => void = () => undefined; let readySettled = false;
	const ready = new Promise<boolean>((resolve) => { wake = resolve; }); const mark = (value: boolean) => { if (!readySettled) { readySettled = true; wake(value); } };
	const done = new Promise<PsqlResult>((resolve) => { const timer = setTimeout(() => child.kill("SIGKILL"), 18_000); child.stdout.on("data", (chunk) => { stdout = appendBounded(stdout, chunk); if (stdout.includes(marker)) mark(true); }); child.stderr.on("data", (chunk) => { stderr = appendBounded(stderr, chunk); }); child.once("error", (error) => { clearTimeout(timer); stderr = appendBounded(stderr, error.message); mark(false); resolve({ ok: false, cause: classify(stderr, false), stdout }); }); child.once("exit", (code) => { clearTimeout(timer); const ok = code === 0; mark(false); resolve({ ok, cause: classify(stderr, ok), stdout }); }); });
	child.stdin.on("error", () => undefined); child.stdin.write(`${statement}\n`);
	return { ready, close: async (tail = "\\q\n") => { if (!child.stdin.destroyed) child.stdin.end(tail); return await done; } };
}
async function idleProbe(environment: GuardedEnvironment, role: string, password: string): Promise<PsqlResult> {
	return await new Promise((resolve) => {
		const child = spawn("psql", psqlArgs(environment), { env: psqlEnv(environment, role, password), stdio: ["pipe", "pipe", "pipe"] });
		let stdout = ""; let stderr = ""; let settled = false;
		child.stdout.on("data", (chunk) => { stdout = appendBounded(stdout, chunk); });
		child.stderr.on("data", (chunk) => { stderr = appendBounded(stderr, chunk); }); child.stdin.on("error", () => undefined);
		const finish = (ok: boolean) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ ok, cause: classify(stderr, ok), stdout }); } };
		const timer = setTimeout(() => { stderr = appendBounded(stderr, "client deadline exceeded"); child.kill("SIGKILL"); }, 6_000);
		child.stdin.write("begin;\n"); setTimeout(() => { if (!child.stdin.destroyed) child.stdin.end("select 1;\n"); }, 1_500);
		child.once("error", (error) => { stderr = appendBounded(stderr, error.message); finish(false); });
		child.once("exit", (code) => { finish(code === 0); });
	});
}
async function lockProbe(environment: GuardedEnvironment, n: Names, password: string): Promise<void> {
	const key = `hashtext(${literal(n.privateSchema)})`; const holder = holdConnection(environment, n.loginA, password, `select pg_advisory_lock(${key}); select '__LOCK_ACQUIRED__';`, "__LOCK_ACQUIRED__");
	if (!(await holder.ready)) { const failedHolder = await holder.close(); throw new Error(`probe_lock_holder_${failedHolder.cause}`); } const conflict = await runPsql(environment, n.loginA, password, `select pg_try_advisory_lock(${key})`); if (!conflict.ok || !/\bf\b/.test(conflict.stdout)) { await holder.close(); throw new Error("probe_lock_acquire"); }
	const denied = await runPsql(environment, n.loginA, password, `select pg_advisory_lock(${key})`); const completed = await holder.close();
	if (denied.cause !== PSQL_CAUSE.LOCK_TIMEOUT) throw new Error(`probe_lock_denial_${denied.cause}`); if (!completed.ok || !completed.stdout.includes("__LOCK_ACQUIRED__")) throw new Error("probe_lock_holder");
}
function setupSql(n: Names, password: string): string {
	return `begin;
do $$begin if exists(select 1 from pg_namespace where nspname in (${literal(n.privateSchema)},${literal(n.apiSchema)})) or exists(select 1 from pg_roles where rolname in (${[n.owner,n.caller,n.contextOwner,n.loginA,n.loginB].map(literal).join(",")})) then raise exception 'nonce collision'; end if; end$$;
create role ${n.owner} nologin; create role ${n.caller} nologin; create role ${n.contextOwner} nologin; grant ${n.owner},${n.contextOwner} to current_user with inherit false,set true,admin false;
create role ${n.loginA} login password ${literal(password)} connection limit 2 inherit; grant ${n.caller} to ${n.loginA} with inherit true,set false,admin false; alter role ${n.loginA} set statement_timeout='2s'; alter role ${n.loginA} set lock_timeout='1s'; alter role ${n.loginA} set idle_in_transaction_session_timeout='1s';
do $$begin execute format('grant create on database %I to %I',current_database(),${literal(n.owner)}); end$$; set local role ${n.owner}; create schema ${n.privateSchema} authorization ${n.owner}; create schema ${n.apiSchema} authorization ${n.owner};
create table ${n.privateSchema}.slot(id integer primary key,value text not null); create table ${n.privateSchema}.context_sample(id bigint generated always as identity,subject uuid not null); create table ${n.privateSchema}.audit(id bigint generated always as identity,observed_at timestamptz not null default clock_timestamp()); create table ${n.privateSchema}.config(prior text,prior_digest text not null,temp_supported boolean not null default false,public_temp boolean not null);
grant usage on schema ${n.privateSchema} to ${n.caller},${n.contextOwner}; grant insert on ${n.privateSchema}.context_sample,${n.privateSchema}.audit to ${n.contextOwner}; grant usage,select on all sequences in schema ${n.privateSchema} to ${n.contextOwner}; grant select,insert on ${n.privateSchema}.config to session_user; grant usage,create on schema ${n.apiSchema} to ${n.contextOwner};
create function ${n.privateSchema}.bootstrap(action text default 'seed') returns text language plpgsql security definer set search_path=pg_catalog,${n.privateSchema} as $fn$begin if action='seed' then insert into ${n.privateSchema}.slot values(1,'seed'); return 'seeded'; elsif action='hold_lock' then lock table ${n.privateSchema}.slot in access exclusive mode; return 'held'; elsif action='read' then return (select value from ${n.privateSchema}.slot where id=1); end if; raise exception 'unsupported action' using errcode='22023'; end$fn$; revoke all on function ${n.privateSchema}.bootstrap(text) from public; grant execute on function ${n.privateSchema}.bootstrap(text) to ${n.caller};
reset role; do $$begin execute format('revoke create on database %I from %I',current_database(),${literal(n.owner)}); end$$; set local role ${n.contextOwner}; create function ${n.apiSchema}.observe_context() returns jsonb language plpgsql security definer set search_path=pg_catalog,${n.privateSchema} as $$declare claims jsonb:=current_setting('request.jwt.claims',true)::jsonb; begin insert into ${n.privateSchema}.context_sample(subject) values((claims->>'sub')::uuid); insert into ${n.privateSchema}.audit default values; return jsonb_build_object('subject',claims->>'sub','role',claims->>'role'); end$$; revoke all on function ${n.apiSchema}.observe_context() from public; grant execute on function ${n.apiSchema}.observe_context() to authenticated;
reset role; set local role ${n.owner}; revoke create on schema ${n.apiSchema} from ${n.contextOwner}; grant usage on schema ${n.apiSchema} to authenticated; reset role;
do $$declare prior text; supported boolean:=true; begin select substring(x from length('pgrst.db_schemas=')+1) into prior from pg_db_role_setting s cross join lateral unnest(s.setconfig) x join pg_roles r on r.oid=s.setrole where r.rolname='authenticator' and x like 'pgrst.db_schemas=%'; begin execute 'alter role ${n.loginA} set temp_file_limit=''1MB'''; exception when insufficient_privilege or invalid_parameter_value then supported:=false; end; insert into ${n.privateSchema}.config values(prior,md5(coalesce(prior,'<null>')),supported,has_database_privilege(${literal(n.loginA)},current_database(),'TEMP')); execute format('alter role authenticator set pgrst.db_schemas to %L',concat_ws(',',nullif(prior,''),${literal(n.apiSchema)})); perform pg_notify('pgrst','reload config'); end$$;
select '__CFG__'||prior_digest||':'||temp_supported::text||':'||public_temp::text from ${n.privateSchema}.config; commit;`;
}
function assertSql(n: Names): string {
	return `do $$begin if not exists(select 1 from pg_roles where rolname=${literal(n.loginA)} and rolcanlogin and rolinherit and rolconnlimit=2) then raise exception 'role attrs'; end if; if not exists(select 1 from pg_auth_members m join pg_roles a on a.oid=m.roleid join pg_roles b on b.oid=m.member where a.rolname=${literal(n.caller)} and b.rolname=${literal(n.loginA)} and not m.admin_option and coalesce((to_jsonb(m)->>'inherit_option')::boolean,true) and coalesce((to_jsonb(m)->>'set_option')::boolean,false)=false) then raise exception 'membership'; end if; if has_table_privilege(${literal(n.loginA)},${literal(`${n.privateSchema}.slot`)},'SELECT') or has_table_privilege(${literal(n.loginA)},${literal(`${n.privateSchema}.slot`)},'UPDATE') or not has_function_privilege(${literal(n.loginA)},${literal(`${n.privateSchema}.bootstrap(text)`)},'EXECUTE') then raise exception 'bootstrap boundary'; end if; if (select count(*) from pg_db_role_setting s join pg_roles r on r.oid=s.setrole cross join lateral unnest(s.setconfig) x where r.rolname=${literal(n.loginA)} and split_part(x,'=',1) in ('statement_timeout','lock_timeout','idle_in_transaction_session_timeout'))<>3 then raise exception 'timeouts'; end if; end$$;`;
}
function rotationSql(n: Names, password: string): string {
	return `create role ${n.loginB} login password ${literal(password)} connection limit 2 inherit; grant ${n.caller} to ${n.loginB} with inherit true, set false, admin false; alter role ${n.loginB} set statement_timeout='2s'; alter role ${n.loginB} set lock_timeout='1s'; alter role ${n.loginB} set idle_in_transaction_session_timeout='1s';`;
}
function retireSql(n: Names): string { return `select pg_terminate_backend(pid) from pg_stat_activity where usename=${literal(n.loginA)} and pid<>pg_backend_pid(); revoke ${n.caller} from ${n.loginA}; drop role ${n.loginA};`; }
function cleanupSql(n: Names, userId: string | undefined): string {
	const deleteUser = userId && /^[0-9a-f-]{36}$/.test(userId) ? `delete from auth.users where id=${literal(userId)}::uuid;` : "";
	return `begin; ${deleteUser} select pg_terminate_backend(pid) from pg_stat_activity where usename in (${literal(n.loginA)},${literal(n.loginB)}) and pid<>pg_backend_pid(); do $$declare prior text; begin select c.prior into prior from ${n.privateSchema}.config c; if prior is null then alter role authenticator reset pgrst.db_schemas; else execute format('alter role authenticator set pgrst.db_schemas to %L',prior); end if; perform pg_notify('pgrst','reload config'); end$$; set local role ${n.owner}; drop schema ${n.apiSchema} cascade; drop schema ${n.privateSchema} cascade; reset role; do $$begin if exists(select 1 from pg_roles where rolname=${literal(n.loginA)}) then execute format('revoke %I from %I',${literal(n.caller)},${literal(n.loginA)}); end if; if exists(select 1 from pg_roles where rolname=${literal(n.loginB)}) then execute format('revoke %I from %I',${literal(n.caller)},${literal(n.loginB)}); end if; end$$; revoke ${n.owner},${n.contextOwner} from current_user; drop role if exists ${n.loginA}; drop role if exists ${n.loginB}; drop role if exists ${n.contextOwner}; drop role if exists ${n.caller}; drop role if exists ${n.owner}; commit; select '__CLEAN__'||md5(coalesce((select substring(x from length('pgrst.db_schemas=')+1) from pg_db_role_setting s cross join lateral unnest(s.setconfig) x join pg_roles r on r.oid=s.setrole where r.rolname='authenticator' and x like 'pgrst.db_schemas=%'),'<null>'))||':'||((select count(*) from pg_namespace where nspname in (${literal(n.privateSchema)},${literal(n.apiSchema)}))+(select count(*) from pg_roles where rolname in (${[n.owner,n.caller,n.contextOwner,n.loginA,n.loginB].map(literal).join(",")})))::text;`;
}
function marker(output: string, prefix: string): readonly [string, string, string] {
	const match = output.match(new RegExp(`${prefix}([a-f0-9]{32}):(true|false|[0-9]+)(?::(true|false))?`));
	if (!match) throw new Error("evidence");
	return [match[1]!, match[2]!, match[3] ?? ""];
}
function messages(value: unknown, found: string[] = []): string[] {
	if (Array.isArray(value)) for (const entry of value) messages(entry, found);
	else if (value && typeof value === "object") for (const [key, entry] of Object.entries(value)) {
		if (key === "event_message" && typeof entry === "string") found.push(entry); else messages(entry, found);
	}
	return found;
}
async function hosted(environment: GuardedEnvironment): Promise<void> {
	const n = names(); const passwordA = randomBytes(24).toString("base64url"); const passwordB = randomBytes(24).toString("base64url");
	const started = new Date(Date.now() - 60_000).toISOString(); let userId: string | undefined; let token = ""; let configBefore = ""; let tempSupported = "false"; let publicTemp = "false"; let cleanupFailure: unknown; let provisioned = false;
	try {
		const setupOutput = await admin(environment, setupSql(n, passwordA), "setup"); provisioned = true; [configBefore, tempSupported, publicTemp] = marker(setupOutput, "__CFG__"); await admin(environment, assertSql(n), "assert");
		const bootstrap = await runPsql(environment, n.loginA, passwordA, `select ${n.privateSchema}.bootstrap()`);
		const directTable = await runPsql(environment, n.loginA, passwordA, `select * from ${n.privateSchema}.slot`);
		if (!bootstrap.ok || !bootstrap.stdout.includes("seeded") || directTable.cause !== PSQL_CAUSE.PERMISSION_DENIED) throw new Error("bootstrap boundary");
		const { createClient } = await import("@supabase/supabase-js");
		const client = createClient(environment.url, environment.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
		const email = `hosted-proof-${randomBytes(10).toString("hex")}@example.test`; const authPassword = randomBytes(24).toString("base64url");
		const fixtureAdmin = createClient(environment.url, environment.fixtureAdminKey, { auth: { persistSession: false, autoRefreshToken: false } }); const created = await fixtureAdmin.auth.admin.createUser({ email, password: authPassword, email_confirm: true }); if (created.error || !created.data.user) throw new Error("auth"); userId = created.data.user.id;
		const signedIn = await client.auth.signInWithPassword({ email, password: authPassword }); token = signedIn.data.session?.access_token ?? ""; if (signedIn.error || !token) throw new Error("auth");
		const user = await client.auth.getUser(token); const claims = await client.auth.getClaims(token); if (user.error || claims.error || user.data.user.id !== userId || claims.data?.claims.sub !== userId) throw new Error("claims"); await new Promise((resolve) => setTimeout(resolve, 1_000));
		const observed = await client.schema(n.apiSchema).rpc("observe_context"); if (observed.error || (observed.data as { subject?: string } | null)?.subject !== userId) throw new Error("context");
		const headers = { apikey: environment.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
		const forged = await fetch(`${environment.url}/rest/v1/rpc/observe_context`, { method: "POST", headers: { ...headers, "request.jwt.claims": JSON.stringify({ sub: "00000000-0000-0000-0000-000000000000" }) }, body: "{}" });
		const forgedData = forged.ok ? await forged.json() as { subject?: string } : null;
		const bodyOverride = await fetch(`${environment.url}/rest/v1/rpc/observe_context`, { method: "POST", headers, body: JSON.stringify({ "request.jwt.claims": "{}" }) }); const tokenParts = token.split("."); if (tokenParts.length !== 3 || !tokenParts[2]) throw new Error("claims"); const index = Math.floor(tokenParts[2].length / 2); tokenParts[2] = `${tokenParts[2].slice(0, index)}${tokenParts[2][index] === "A" ? "B" : "A"}${tokenParts[2].slice(index + 1)}`; const tamperedToken = tokenParts.join(".");
		const tampered = await fetch(`${environment.url}/rest/v1/rpc/observe_context`, { method: "POST", headers: { ...headers, Authorization: `Bearer ${tamperedToken}` }, body: "{}" });
		if (!forged.ok || forgedData?.subject !== userId) throw new Error("override_header"); if (bodyOverride.ok) throw new Error("override_body"); if (tampered.ok) throw new Error("override_token");
		const holders = [holdConnection(environment, n.loginA, passwordA), holdConnection(environment, n.loginA, passwordA)]; const holdersReady = (await Promise.all(holders.map((holder) => holder.ready))).every(Boolean);
		const third = await runPsql(environment, n.loginA, passwordA, "select 1", 3_000); const held = await Promise.all(holders.map((holder) => holder.close())); const thirdDenied = third.cause === PSQL_CAUSE.CONNECTION_LIMIT; const holdersCompleted = held.every((result) => result.ok && result.stdout.includes("__HOLDER__"));
		await lockProbe(environment, n, passwordA); const idle = await idleProbe(environment, n.loginA, passwordA); const statement = await runPsql(environment, n.loginA, passwordA, "select pg_sleep(3)");
		if (!holdersReady) throw new Error("probe_pool_readback"); if (!thirdDenied) throw new Error(`probe_pool_third_${third.cause}`); if (!holdersCompleted) throw new Error("probe_pool_holders"); if (idle.cause !== PSQL_CAUSE.IDLE_TIMEOUT) throw new Error("probe_idle"); if (statement.cause !== PSQL_CAUSE.STATEMENT_TIMEOUT) throw new Error("probe_statement");
		await admin(environment, rotationSql(n, passwordB), "rotation"); const replacementProvisioned = (await runPsql(environment, n.loginB, passwordB, "select 1")).ok; if (!replacementProvisioned) throw new Error("rotation");
		await admin(environment, retireSql(n), "retire"); const oldDenied = !(await runPsql(environment, n.loginA, passwordA, "select 1")).ok; const newAccepted = (await runPsql(environment, n.loginB, passwordB, "select 1")).ok; if (!oldDenied || !newAccepted) throw new Error("rotation");
		const endpoint = new URL(`https://api.supabase.com/v1/projects/${environment.projectRef}/analytics/endpoints/logs`); endpoint.searchParams.set("sql", "select event_message from logs where source = 'postgres_logs' order by timestamp desc limit 100"); endpoint.searchParams.set("iso_timestamp_start", started); endpoint.searchParams.set("iso_timestamp_end", new Date().toISOString());
		const logResponse = await fetch(endpoint, { headers: { Authorization: `Bearer ${environment.pat}` } }); if (!logResponse.ok) throw new Error("logs");
		const logMessages = messages(await logResponse.json()); const sensitive = [passwordA, passwordB, email, authPassword, token, tamperedToken, userId, environment.projectRef, environment.database.hostname, environment.anonKey, environment.pat, environment.fixtureAdminKey];
		if (logMessages.length === 0 || logMessages.some((line) => sensitive.some((value) => line.includes(value)))) throw new Error("logs");
		const cleanupOutput = await admin(environment, cleanupSql(n, userId), "cleanup"); provisioned = false; const cleanup = marker(cleanupOutput, "__CLEAN__"); userId = undefined; if (cleanup[0] !== configBefore || cleanup[1] !== "0") throw new Error("cleanup");
		process.stdout.write(`${JSON.stringify({ protocol: PROTOCOL, protocolVersion: 1, status: "pass", checks: { collisionFree: true, bootstrapBoundary: true, authContext: true, claimOverrideResisted: true, rolePolicy: true, publicTempInherited: publicTemp === "true", tempFileLimitSupported: tempSupported === "true", poolExhaustion: true, lockTimeout: true, idleTermination: true, statementTimeout: true, oldDenied: true, newAccepted: true, logsScannable: true, cleanup: true }, counts: { logEvents: logMessages.length, residue: 0 } })}\n`);
	} catch (error) {
		if (provisioned) try { await admin(environment, cleanupSql(n, userId), "cleanup"); } catch (cleanupError) { cleanupFailure = cleanupError; }
		throw cleanupFailure ? new AggregateError([error, cleanupFailure], "cleanup") : error;
	}
}

function failureCode(error: unknown): string {
	if (error instanceof AggregateError) return "cleanup";
	const code = error instanceof Error ? error.message : "unknown";
	if (/^probe_(?:pool_third|lock_denial|lock_holder)_(?:ok|connection_limit|lock_timeout|idle_timeout|statement_timeout|permission_denied|connectivity|tls|other)$/.test(code)) return code;
	if (/^admin_(?:setup|assert|rotation|retire|cleanup)_(?:(?:syntax|permission|membership|setting|cardinality|dependency|unknown)(?:_[0-9A-Z]{5})?|process_(?:ETIMEDOUT|ENOBUFS|ENOENT|UNKNOWN))$/.test(code)) return code;
	return ({ guard: "guard", evidence: "evidence", "bootstrap boundary": "bootstrap", auth: "auth", claims: "claims", context: "context", override_header: "override_header", override_body: "override_body", override_token: "override_token", probe_pool_readback: "probe_pool_readback", probe_pool_holders: "probe_pool_holders", probe_lock_acquire: "probe_lock_acquire", probe_lock_holder: "probe_lock_holder", probe_idle: "probe_idle", probe_statement: "probe_statement", rotation: "rotation", logs: "logs", cleanup: "cleanup" } as Record<string, string>)[code] ?? "unknown";
}

const argv = process.argv.slice(2);
if (argv.length === 1 && argv[0] === "--plan") plan();
else void guard(argv).then(hosted).catch((error: unknown) => {
	process.stderr.write(`organization hosted proof refused: ${failureCode(error)}\n`); process.exitCode = 1;
});
