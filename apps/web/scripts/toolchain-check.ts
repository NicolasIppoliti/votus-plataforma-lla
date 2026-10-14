import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const miseTools = ["node", "pnpm", "python", "uv"] as const;
type Tool = (typeof miseTools)[number] | "supabase";

// This repository deliberately uses only exact, quoted releases in [tools].
export function parsePins(source: string): Record<(typeof miseTools)[number], string> {
  const section = source.split(/^\[tools\]\s*$/m)[1]?.split(/^\[/m)[0] ?? "";
  return Object.fromEntries(miseTools.map((tool) => {
    const version = section.match(new RegExp(`^${tool} = "(\\d+\\.\\d+\\.\\d+)"\\s*$`, "m"))?.[1];
    if (!version) throw new Error(`Pin exacto de ${tool} ausente en mise.toml`);
    return [tool, version];
  })) as Record<(typeof miseTools)[number], string>;
}

export function parseVersion(output: string): string | null {
  return output.trim().match(/^(?:v|Python |uv )?(\d+\.\d+\.\d+)(?:\s|$)/)?.[1] ?? null;
}

export function selectTools(scope: string): Tool[] {
  switch (scope) {
    case "web": return ["node", "pnpm", "supabase"];
    case "etl": return ["node", "pnpm", "uv", "python"];
    case "all": return ["node", "pnpm", "uv", "python", "supabase"];
    default: throw new Error("Scope inválido: usá --scope all, web o etl");
  }
}

export function compareVersion(tool: Tool, expected: string, actual: string | null): string | null {
  if (actual === expected) return null;
  const problem = actual === null ? `${tool} no disponible (se esperaba ${expected})` : `${tool} ${actual} ≠ ${expected} fijado`;
  const fix = tool === "supabase" ? "Corré `pnpm install` en apps/web." : "Corré `mise install` en la raíz del repo (o activá mise en tu shell).";
  return `${problem}. ${fix}`;
}

export function pythonProbe(expectedUv: string, actualUv: string | null): { command: string; args: string[] } | { skip: string } {
  if (actualUv !== expectedUv) {
    return { skip: "Python no verificado: primero corregí la versión de uv; se omite su probe." };
  }
  return { command: "uv", args: ["run", "--project", "etl", "--no-sync", "--no-python-downloads", "python", "--version"] };
}

function main(args: string[]): number {
  const scope = args.length === 0 ? "all" : args.length === 2 && args[0] === "--scope" ? (args[1] ?? "invalid") : "invalid";
  const tools = selectTools(scope);
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const webDirectory = fileURLToPath(new URL("../", import.meta.url));
  const web = JSON.parse(readFileSync(`${webDirectory}package.json`, "utf8"));
  const pins = { ...parsePins(readFileSync(`${root}mise.toml`, "utf8")), supabase: web.devDependencies.supabase as string };
  let failed = false;
  let actualUv: string | null = null;
  for (const tool of tools) {
    const probe: ReturnType<typeof pythonProbe> = tool === "python" ? pythonProbe(pins.uv, actualUv) : {
      command: tool === "supabase" ? "pnpm" : tool,
      args: tool === "supabase" ? ["--dir", webDirectory, "exec", "supabase", "--version"] : ["--version"],
    };
    if ("skip" in probe) {
      console.error(probe.skip);
      failed = true;
      continue;
    }
    const command: string = probe.command;
    const commandArgs: string[] = probe.args;
    const result = spawnSync(command, commandArgs, { cwd: command === "pnpm" ? webDirectory : root, encoding: "utf8", timeout: 30_000 });
    const actual: string | null = result.error || result.status !== 0 ? null : parseVersion(result.stdout);
    if (tool === "uv") actualUv = actual;
    const message = compareVersion(tool, pins[tool], actual);
    if (message) { console.error(message); failed = true; }
  }
  if (!failed) console.log(`Toolchain OK (${scope}).`);
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
