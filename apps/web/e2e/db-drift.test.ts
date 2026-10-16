import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";

// Drives the real `db:drift` entry point (#593) with a fake Supabase CLI, so no
// test ever reaches a hosted database.
const web = fileURLToPath(new URL("../", import.meta.url));
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const URL_SECRET = "postgresql://postgres:s3cret-pass@db.example.invalid:5432/postgres";
let fake: string;

beforeEach(() => { fake = mkdtempSync(join(tmpdir(), "votus-db-drift-")); });
afterEach(() => { rmSync(fake, { recursive: true, force: true }); });

function cli(stdout: string, { stderr = "", status = 0 } = {}) {
  const path = join(fake, "supabase");
  writeFileSync(join(fake, "stdout"), stdout);
  writeFileSync(join(fake, "stderr"), stderr);
  writeFileSync(path, `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require("node:fs");
writeFileSync(${JSON.stringify(join(fake, "args.json"))}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(readFileSync(${JSON.stringify(join(fake, "stdout"))}, "utf8"));
process.stderr.write(readFileSync(${JSON.stringify(join(fake, "stderr"))}, "utf8"));
process.exit(${status});
`);
  chmodSync(path, 0o755);
  return path;
}

function run(env: Record<string, string>) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/db-drift.ts"], {
    cwd: web, encoding: "utf8",
    env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const list = (migrations: { local: string; remote: string }[]) =>
  JSON.stringify({ migrations: migrations.map(item => ({ ...item, time: item.local || item.remote })), message: "Migrations listed" });

it("refuses to run without the hosted connection variable", () => {
  const result = run({ VOTUS_SUPABASE_CLI: cli(list([])) });
  expect(result).toEqual({ status: 2, stdout: "", stderr: "VOTUS_HOSTED_DB_URL no está definida: exportá la URL directa de Postgres de la base hosted.\n" });
});

it("lists the hosted history with the pinned CLI against this repository's supabase directory", () => {
  const binary = cli(list([{ local: "20261015000000", remote: "20261015000000" }]));
  run({ VOTUS_HOSTED_DB_URL: URL_SECRET, VOTUS_SUPABASE_CLI: binary });
  expect(JSON.parse(readFileSync(join(fake, "args.json"), "utf8"))).toEqual([
    "migration", "list", "--db-url", URL_SECRET, "--workdir", repository.replace(/\/$/, ""), "--output-format", "json",
  ]);
});

it("passes when every migration is applied on both sides", () => {
  const result = run({ VOTUS_HOSTED_DB_URL: URL_SECRET, VOTUS_SUPABASE_CLI: cli(list([
    { local: "20261015000000", remote: "20261015000000" },
    { local: "20261016000000", remote: "20261016000000" },
  ])) });
  expect(result).toEqual({ status: 0, stderr: "", stdout: [
    "Alineadas: 2",
    "Pendientes (solo en el repositorio): 0",
    "Desconocidas (solo en la base hosted): 0",
    "Base hosted alineada con supabase/migrations.",
    "",
  ].join("\n") });
});

it("fails and names every pending migration", () => {
  const result = run({ VOTUS_HOSTED_DB_URL: URL_SECRET, VOTUS_SUPABASE_CLI: cli(list([
    { local: "20261014000000", remote: "20261014000000" },
    { local: "20261015000000", remote: "" },
    { local: "20261015300000", remote: "" },
  ])) });
  expect(result).toEqual({ status: 1, stderr: "", stdout: [
    "Alineadas: 1",
    "Pendientes (solo en el repositorio): 2",
    "  - 20261015000000",
    "  - 20261015300000",
    "Desconocidas (solo en la base hosted): 0",
    "Hay migraciones sin alinear: no despliegues código que dependa de ellas hasta resolverlas.",
    "",
  ].join("\n") });
});

it("fails on migrations that exist only in the hosted database", () => {
  const result = run({ VOTUS_HOSTED_DB_URL: URL_SECRET, VOTUS_SUPABASE_CLI: cli(list([
    { local: "20261015000000", remote: "20261015000000" },
    { local: "", remote: "20261099000000" },
  ])) });
  expect(result).toEqual({ status: 1, stderr: "", stdout: [
    "Alineadas: 1",
    "Pendientes (solo en el repositorio): 0",
    "Desconocidas (solo en la base hosted): 1",
    "  - 20261099000000",
    "Hay migraciones sin alinear: no despliegues código que dependa de ellas hasta resolverlas.",
    "",
  ].join("\n") });
});

it("never prints the connection string when the CLI fails", () => {
  const result = run({ VOTUS_HOSTED_DB_URL: URL_SECRET, VOTUS_SUPABASE_CLI: cli("", {
    status: 1, stderr: `failed to connect to ${URL_SECRET}: password authentication failed\n`,
  }) });
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("No se pudo listar el historial hosted (supabase salió con 1): failed to connect to <url redactada>: password authentication failed\n");
  expect(result.stderr).not.toContain("s3cret-pass");
});

it("rejects output that is not a migration listing", () => {
  const result = run({ VOTUS_HOSTED_DB_URL: URL_SECRET, VOTUS_SUPABASE_CLI: cli("not json") });
  expect(result).toEqual({ status: 2, stdout: "", stderr: "La salida de supabase migration list no es el JSON esperado.\n" });
});
