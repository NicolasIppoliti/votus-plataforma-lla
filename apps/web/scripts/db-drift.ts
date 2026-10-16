// Compare supabase/migrations with the hosted migration history (#593).
// Run before a release: `VOTUS_HOSTED_DB_URL=... pnpm --dir apps/web db:drift`.
// Exit 0 aligned, 1 drift, 2 could not check. Never prints the connection string.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPOSITORY = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");
const PINNED_CLI = fileURLToPath(new URL("../node_modules/.bin/supabase", import.meta.url));

type Listing = { migrations: { local: string; remote: string }[] };

function redact(text: string, secret: string): string {
  const password = (() => { try { return decodeURIComponent(new URL(secret).password); } catch { return ""; } })();
  let result = text.split(secret).join("<url redactada>");
  if (password) result = result.split(password).join("<redactado>");
  return result.replace(/postgres(?:ql)?:\/\/\S+/g, "<url redactada>");
}

function parse(stdout: string): Listing | null {
  try {
    const value = JSON.parse(stdout) as unknown;
    if (!value || typeof value !== "object" || !Array.isArray((value as Listing).migrations)) return null;
    const migrations = (value as Listing).migrations;
    return migrations.every(item => item && typeof item.local === "string" && typeof item.remote === "string") ? { migrations } : null;
  } catch {
    return null;
  }
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const url = process.env.VOTUS_HOSTED_DB_URL;
if (!url) fail("VOTUS_HOSTED_DB_URL no está definida: exportá la URL directa de Postgres de la base hosted.");

// VOTUS_SUPABASE_CLI exists for the contract tests' fake CLI; operators use the pinned binary.
const cli = process.env.VOTUS_SUPABASE_CLI ?? PINNED_CLI;
const listed = spawnSync(cli, ["migration", "list", "--db-url", url, "--workdir", REPOSITORY, "--output-format", "json"], { encoding: "utf8" });
if (listed.error) fail(`No se pudo ejecutar supabase: ${redact(listed.error.message, url)}`);
if (listed.status !== 0) fail(`No se pudo listar el historial hosted (supabase salió con ${listed.status}): ${redact(listed.stderr.trim(), url)}`);
const listing = parse(listed.stdout);
if (!listing) fail("La salida de supabase migration list no es el JSON esperado.");

const aligned = listing.migrations.filter(item => item.local && item.remote);
const pending = listing.migrations.filter(item => item.local && !item.remote).map(item => item.local);
const unknown = listing.migrations.filter(item => !item.local && item.remote).map(item => item.remote);
const lines = [
  `Alineadas: ${aligned.length}`,
  `Pendientes (solo en el repositorio): ${pending.length}`, ...pending.map(version => `  - ${version}`),
  `Desconocidas (solo en la base hosted): ${unknown.length}`, ...unknown.map(version => `  - ${version}`),
];
const drift = pending.length > 0 || unknown.length > 0;
lines.push(drift ? "Hay migraciones sin alinear: no despliegues código que dependa de ellas hasta resolverlas." : "Base hosted alineada con supabase/migrations.");
process.stdout.write(`${lines.join("\n")}\n`);
process.exit(drift ? 1 : 0);
