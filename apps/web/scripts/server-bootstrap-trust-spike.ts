import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { verifyBootstrapClaims } from "../src/lib/supabase/verified-bootstrap-claims-spike.ts";

interface LocalStatus { API_URL: string; DB_URL: string; ANON_KEY: string }
interface ProcessOutcome { denied: boolean; stdout: string; succeeded: boolean }
const ROOT = new URL("../../..", import.meta.url).pathname;
const run = (file: string, args: string[], input?: string, env = process.env) =>
  execFileSync(file, args, { cwd: ROOT, encoding: "utf8", input, env, stdio: ["pipe", "pipe", "pipe"] });
const fail = (message: string): never => { throw new Error(message); };
const runConcurrent = (file: string, args: string[], input: string, env: NodeJS.ProcessEnv, onStdout?: (output: string) => void) => new Promise<ProcessOutcome>((resolve) => {
  const child = spawn(file, args, { cwd: ROOT, env, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", denied = false, timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 30_000);
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; onStdout?.(stdout); });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { denied ||= chunk.includes("bootstrap denied"); });
  child.once("error", () => { clearTimeout(timeout); resolve({ denied: false, stdout: "", succeeded: false }); });
  child.once("close", (code) => { clearTimeout(timeout); resolve({ denied, stdout, succeeded: !timedOut && code === 0 }); });
  child.stdin.on("error", () => undefined);
  child.stdin.end(input);
});
const mustDeny = (attempt: () => unknown, message: string) => {
  try { attempt(); } catch { return; }
  fail(message);
};

function database(urlText: string, user?: string, password?: string) {
  const url = new URL(urlText);
  return (sql: string) => run("psql", ["-w", "-h", url.hostname, "-p", url.port, "-U", user ?? decodeURIComponent(url.username), url.pathname.slice(1), "-v", "ON_ERROR_STOP=1", "-At"], sql, {
    ...process.env, PGPASSWORD: password ?? decodeURIComponent(url.password),
  });
}

function sql(): string {
  return `
create schema workspace_private; create schema workspace_api;
create table workspace_private.session_context_slot (auth_session_id uuid primary key, user_id uuid not null, context_revision bigint not null default 0);
create table workspace_private.organization_context (id uuid primary key, auth_session_id uuid not null, user_id uuid not null, context_revision bigint not null, token_hash bytea not null check (octet_length(token_hash)=32), fixed_expires_at timestamptz not null, revoked_at timestamptz);
create table workspace_private.workspace_audit_event (action text not null, context_id uuid not null);
create role workspace_bootstrap_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role workspace_bootstrap_caller nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role workspace_context_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role workspace_spike_login login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password :'login_password';
grant workspace_bootstrap_caller to workspace_spike_login WITH INHERIT TRUE, SET FALSE, ADMIN FALSE;
grant connect on database postgres to workspace_bootstrap_caller; grant usage on schema workspace_private to workspace_bootstrap_caller;
grant workspace_bootstrap_owner,workspace_context_owner to postgres; grant usage,create on schema workspace_private to workspace_bootstrap_owner; grant select,insert,update on workspace_private.session_context_slot,workspace_private.organization_context to workspace_bootstrap_owner; grant insert on workspace_private.workspace_audit_event to workspace_bootstrap_owner;
create function workspace_private.bootstrap_selection_context(p_user text,p_session text,p_exp text,p_hash bytea) returns table("contextId" uuid,"contextRevision" bigint,"fixedExpiresAt" timestamptz,"effectiveExpiresAt" timestamptz) language plpgsql security definer set search_path=pg_catalog,workspace_private,pg_temp as $$
declare u uuid; s uuid; e timestamptz; r bigint; c workspace_private.organization_context; begin
 if p_user !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or p_session !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or p_exp !~ '^[0-9]{1,10}$' or octet_length(p_hash) <> 32 then raise exception 'bootstrap denied'; end if;
 u:=p_user::uuid; s:=p_session::uuid; e:=to_timestamp(p_exp::bigint); if e<=statement_timestamp() then raise exception 'bootstrap denied'; end if;
 insert into workspace_private.session_context_slot(auth_session_id,user_id) values(s,u) on conflict do nothing;
 perform 1 from workspace_private.session_context_slot where auth_session_id=s for update;
 select x.* into c from workspace_private.organization_context x join workspace_private.session_context_slot z on z.auth_session_id=x.auth_session_id where x.auth_session_id=s order by x.context_revision desc limit 1 for update;
 if found and c.revoked_at is null and c.fixed_expires_at>statement_timestamp() then raise exception 'bootstrap denied'; end if;
 if found and c.revoked_at is null then update workspace_private.organization_context set revoked_at=statement_timestamp() where id=c.id; end if;
 update workspace_private.session_context_slot set context_revision=context_revision+1 where auth_session_id=s returning context_revision into r;
 return query insert into workspace_private.organization_context select pg_catalog.gen_random_uuid(),s,u,r,p_hash,least(statement_timestamp()+interval '8 hours',e),null returning id,r,fixed_expires_at,least(fixed_expires_at,e);
 insert into workspace_private.workspace_audit_event values ('selection_bootstrap',(select id from workspace_private.organization_context where auth_session_id=s and context_revision=r)); end $$;
alter function workspace_private.bootstrap_selection_context(text,text,text,bytea) owner to workspace_bootstrap_owner; revoke create on schema workspace_private from workspace_bootstrap_owner; set role workspace_bootstrap_owner; revoke all on function workspace_private.bootstrap_selection_context(text,text,text,bytea) from public; grant execute on function workspace_private.bootstrap_selection_context(text,text,text,bytea) to workspace_bootstrap_caller; reset role;
grant usage on schema workspace_api to authenticated; grant usage,create on schema workspace_api to workspace_context_owner; grant usage on schema workspace_private,extensions to workspace_context_owner; grant select on workspace_private.session_context_slot,workspace_private.organization_context to workspace_context_owner;
    create function workspace_api.context_observation(p_bearer text,p_context uuid,p_revision bigint) returns jsonb language plpgsql security definer set search_path=pg_catalog,workspace_private,pg_temp as $$
    declare v_claims_text text; v_claims jsonb; v_sub jsonb; v_session jsonb; v_exp jsonb; v_sub_text text; v_session_text text; v_exp_number numeric; v_exp_epoch bigint; v_user_id uuid; v_session_id uuid;
    begin
      v_claims_text := pg_catalog.current_setting('request.jwt.claims', true);
      if v_claims_text is null or btrim(v_claims_text) = '' then raise exception using errcode = 'VOT01'; end if;
      begin v_claims := v_claims_text::jsonb; exception when others then raise exception using errcode = 'VOT02'; end;
      if jsonb_typeof(v_claims) <> 'object' then raise exception using errcode = 'VOT02'; end if;
      v_sub := v_claims -> 'sub'; v_session := v_claims -> 'session_id'; v_exp := v_claims -> 'exp';
      if jsonb_typeof(v_sub) <> 'string' or jsonb_typeof(v_session) <> 'string' or jsonb_typeof(v_exp) <> 'number' then raise exception using errcode = 'VOT02'; end if;
      v_sub_text := v_sub #>> '{}'; v_session_text := v_session #>> '{}';
      if v_sub_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or v_session_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception using errcode = 'VOT02'; end if;
      begin v_user_id := v_sub_text::uuid; v_session_id := v_session_text::uuid; v_exp_number := (v_exp #>> '{}')::numeric; v_exp_epoch := v_exp_number::bigint; exception when others then raise exception using errcode = 'VOT02'; end;
      if v_user_id::text <> v_sub_text or v_session_id::text <> v_session_text or v_exp_number <> trunc(v_exp_number) or v_exp_number < 1 or v_exp_number > 253402300799 or to_timestamp(v_exp_epoch) <= statement_timestamp() then raise exception using errcode = 'VOT02'; end if;
      if not exists (select 1 from workspace_private.organization_context c where c.id=p_context and c.context_revision=p_revision and c.auth_session_id=v_session_id and c.user_id=v_user_id and c.revoked_at is null and c.fixed_expires_at>statement_timestamp() and c.token_hash=extensions.digest(convert_to(p_bearer,'utf8'),'sha256')) then raise exception using errcode = 'VOT03'; end if;
      return jsonb_build_object('ok',true,'claimsDigest',encode(extensions.digest(convert_to(v_sub_text || ':' || v_session_text || ':' || v_exp_epoch::text,'utf8'),'sha256'),'hex'));
    end $$;
alter function workspace_api.context_observation(text,uuid,bigint) owner to workspace_context_owner; revoke create on schema workspace_api from workspace_context_owner; set role workspace_context_owner; revoke all on function workspace_api.context_observation(text,uuid,bigint) from public; grant execute on function workspace_api.context_observation(text,uuid,bigint) to authenticated; reset role;
alter role authenticator in database postgres set pgrst.db_schemas to 'public, graphql_public, workspace_api'; notify pgrst,'reload config'; notify pgrst,'reload schema';`;
}

async function main() {
  const scratch = await mkdtemp(join(tmpdir(), "votus-bootstrap-spike-"));
  let started = false, admin: ReturnType<typeof database> | undefined, email: string | undefined, previousExposure = "__unset__";
  try {
    run("supabase", ["start", "--ignore-health-check"]); started = true;
    const status = JSON.parse(run("supabase", ["status", "--output", "json"])) as LocalStatus;
    admin = database(status.DB_URL); const password = randomBytes(24).toString("base64url");
    previousExposure = admin("select coalesce((select substring(setting from '^pgrst\\.db_schemas=(.*)$') from pg_db_role_setting s join pg_roles r on r.oid=s.setrole cross join lateral unnest(s.setconfig) setting where r.rolname='authenticator' and s.setdatabase=(select oid from pg_database where datname=current_database()) and setting like 'pgrst.db_schemas=%'),'__unset__')").trim();
    admin(sql().replace(":'login_password'", `'${password.replaceAll("'", "''")}'`));
    const client = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    email = `spike-${randomBytes(8).toString("hex")}@example.invalid`; const secret = randomBytes(20).toString("base64url");
    const signedUp = await client.auth.signUp({ email, password: secret });
    if (signedUp.error) fail("local sign-up unavailable");
    const signedIn = await client.auth.signInWithPassword({ email, password: secret });
    const session = signedIn.data.session;
    if (signedIn.error || session === null) return fail("local sign-in unavailable");
    const token = session.access_token, verified = await verifyBootstrapClaims(client.auth, token);
    await verifyBootstrapClaims(client.auth, `${token}x`).then(() => fail("tampered JWT verified"), () => undefined);
    const bearer = randomBytes(32).toString("base64url"), hash = createHash("sha256").update(bearer).digest("hex");
    const direct = database(status.DB_URL, "workspace_spike_login", password);
    const raceSession = randomUUID();
    admin(`insert into workspace_private.session_context_slot(auth_session_id,user_id) values('${raceSession}','${verified.userId}')`);
    const databaseUrl = new URL(status.DB_URL);
    const psqlArgs = (user: string) => ["-X", "-w", "-q", "-h", databaseUrl.hostname, "-p", databaseUrl.port, "-U", user, databaseUrl.pathname.slice(1), "-v", "ON_ERROR_STOP=1", "-At"];
    let slotLocked!: () => void;
    const slotReady = new Promise<void>((resolve) => { slotLocked = resolve; });
    const gate = runConcurrent("psql", psqlArgs(decodeURIComponent(databaseUrl.username)), `begin; update workspace_private.session_context_slot set user_id=user_id where auth_session_id='${raceSession}'; select 'slot-locked'; select pg_sleep(1); commit;`, { ...process.env, PGPASSWORD: decodeURIComponent(databaseUrl.password) }, (output) => { if (output.includes("slot-locked")) slotLocked(); });
    await Promise.race([slotReady, gate.then(() => fail("concurrency gate did not lock the session slot"))]);
    const raceCall = (raceHash: string) => `begin; select row_to_json(x) from workspace_private.bootstrap_selection_context('${verified.userId}','${raceSession}','${verified.expiresAt}',decode('${raceHash}','hex')) x; commit;`;
    const raceOutcomes = await Promise.all([
      runConcurrent("psql", psqlArgs("workspace_spike_login"), raceCall(createHash("sha256").update(randomBytes(32)).digest("hex")), { ...process.env, PGPASSWORD: password }),
      runConcurrent("psql", psqlArgs("workspace_spike_login"), raceCall(createHash("sha256").update(randomBytes(32)).digest("hex")), { ...process.env, PGPASSWORD: password }),
    ]);
    if (!(await gate).succeeded) fail("concurrency gate failed");
    if (raceOutcomes.filter((outcome) => outcome.succeeded && outcome.stdout.includes('"contextId"')).length !== 1 || raceOutcomes.filter((outcome) => outcome.denied && !outcome.succeeded).length !== 1) fail("concurrent bootstrap did not produce one success and one denial");
    if (admin(`select count(*) from workspace_private.organization_context where auth_session_id='${raceSession}' and revoked_at is null and fixed_expires_at>statement_timestamp()`).trim() !== "1") fail("concurrent bootstrap created multiple active contexts");
    const result = JSON.parse(direct(`select row_to_json(x) from workspace_private.bootstrap_selection_context('${verified.userId}','${verified.sessionId}','${verified.expiresAt}',decode('${hash}','hex')) x;`).trim()) as Record<string, unknown>;
    if (Object.keys(result).sort().join(",") !== "contextId,contextRevision,effectiveExpiresAt,fixedExpiresAt") fail("bootstrap result widened");
    const call = (body: unknown, extraHeaders: Record<string, string> = {}, query = "") => fetch(`${status.API_URL}/rest/v1/rpc/context_observation${query}`, { method: "POST", headers: { apikey: status.ANON_KEY, authorization: `Bearer ${token}`, "content-type": "application/json", "Content-Profile": "workspace_api", ...extraHeaders }, body: JSON.stringify(body) });
    const input = { p_bearer: bearer, p_context: result.contextId, p_revision: result.contextRevision };
    const expectedDigest = createHash("sha256").update(`${verified.userId}:${verified.sessionId}:${verified.expiresAt}`).digest("hex");
    const matching = await call(input); const matchingBody = await matching.json() as Record<string, unknown>;
    if (!matching.ok || matchingBody.ok !== true || matchingBody.claimsDigest !== expectedDigest) fail("matching JWT/bearer observation denied");
    for (const response of [await call({ ...input, p_bearer: "wrong" }), await call({ ...input, p_revision: Number(result.contextRevision) + 1 }), await call({ p_context: result.contextId, p_revision: result.contextRevision })]) if (response.ok && (await response.text()) !== "null") fail("context factor denial failed");
    const headerOverride = await call(input, { "request.jwt.claims": JSON.stringify({ sub: "00000000-0000-0000-0000-000000000000", session_id: "00000000-0000-0000-0000-000000000000", exp: 1 }) });
    const headerBody = await headerOverride.json() as Record<string, unknown>; if (!headerOverride.ok || headerBody.claimsDigest !== expectedDigest) fail("header claims override altered GUC");
    for (const response of [await call({ ...input, p_claims: { sub: "override" } }), await call(input, {}, "?request.jwt.claims=override"), await fetch(`${status.API_URL}/rest/v1/rpc/context_observation`, { method: "POST", headers: { apikey: status.ANON_KEY, authorization: `Bearer ${token}`, "Content-Profile": "workspace_api", "content-type": "application/x-www-form-urlencoded" }, body: "request.jwt.claims=override" })]) if (response.ok) fail("non-header claims override accepted");
    if ((await fetch(`${status.API_URL}/rest/v1/rpc/bootstrap_selection_context`, { method: "POST", headers: { apikey: status.ANON_KEY, authorization: `Bearer ${token}` } })).ok) fail("Data API bootstrap exposed");
    mustDeny(() => direct("select count(*) from workspace_private.organization_context"), "private read accepted");
    mustDeny(() => direct("set role workspace_bootstrap_owner"), "SET ROLE accepted");
    mustDeny(() => admin?.(`begin; set local role authenticated; select workspace_api.context_observation('${bearer}','${result.contextId}',${result.contextRevision}); commit;`), "direct PostgreSQL no-GUC accepted");
    for (const claims of ["", "{", "null", "[]", "1", `{"sub":1,"session_id":true,"exp":"1"}`, `{"sub":"${verified.userId.toUpperCase()}","session_id":"${verified.sessionId}","exp":${verified.expiresAt}}`, `{"sub":"${verified.userId}","session_id":"${verified.sessionId}","exp":1.5}`, `{"sub":"${verified.userId}","session_id":"${verified.sessionId}","exp":253402300800}`, `{"sub":"${verified.userId}","session_id":"${verified.sessionId}","exp":1}`]) mustDeny(() => admin?.(`begin; set local role authenticated; set local request.jwt.claims='${claims.replaceAll("'", "''")}'; select workspace_api.context_observation('${bearer}','${result.contextId}',${result.contextRevision}); commit;`), "invalid claims reached a relation");
    if (admin("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('workspace_api','workspace_private') and p.prosrc ~ '\\mauth\\.'").trim() !== "0") fail("Auth namespace source found");
    if (admin("select count(*) from pg_depend d join pg_proc p on p.oid=d.objid join pg_namespace fn on fn.oid=p.pronamespace join pg_namespace dep on dep.oid=d.refobjid where fn.nspname in ('workspace_api','workspace_private') and dep.nspname='auth'").trim() !== "0") fail("Auth namespace dependency found");
    if (admin("select count(*) from (values ('workspace_bootstrap_owner'),('workspace_bootstrap_caller'),('workspace_spike_login'),('workspace_context_owner')) r(name) where has_schema_privilege(name,'auth','USAGE')").trim() !== "0" || admin("select count(*) from (values ('workspace_bootstrap_caller'),('workspace_spike_login')) r(name) where has_function_privilege(name,'workspace_api.context_observation(text,uuid,bigint)','EXECUTE')").trim() !== "0") fail("Auth usage or direct canonical execute found");
    console.log("local server-bootstrap trust spike passed");
  } finally {
    try {
      if (admin) { const exposureRestore = previousExposure === "__unset__" ? "reset pgrst.db_schemas" : `set pgrst.db_schemas to '${previousExposure.replaceAll("'", "''")}'`; admin(`alter role authenticator in database postgres ${exposureRestore}; notify pgrst,'reload config'; notify pgrst,'reload schema'; delete from auth.users where email='${email ?? ""}'; drop schema if exists workspace_api cascade; drop schema if exists workspace_private cascade; revoke workspace_bootstrap_owner,workspace_context_owner from postgres; drop role if exists workspace_spike_login; revoke usage on schema extensions from workspace_context_owner; revoke connect on database postgres from workspace_bootstrap_caller; drop role if exists workspace_context_owner; drop role if exists workspace_bootstrap_caller; drop role if exists workspace_bootstrap_owner;`); }
    } finally { await rm(scratch, { recursive: true, force: true }); if (started) run("supabase", ["stop", "--no-backup"]); }
  }
}

void main();
