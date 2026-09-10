import assert from "node:assert/strict";
import {
	spawnSync,
	type SpawnSyncOptionsWithStringEncoding,
} from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

interface TestApi {
	describe: (name: string, callback: () => void) => void;
	it: (name: string, callback: () => void) => void;
}

const testApi = (process.env.VITEST
	? await import("vitest")
	: await import("node:test")) as unknown as TestApi;
const { describe, it } = testApi;

const WEB_ROOT = resolve(import.meta.dirname, "..");
const PROJECT_ROOT = resolve(WEB_ROOT, "../..");
const APPROVED_IMPECCABLE_SKILL_HASH =
	"31029a52831c6967afcbd66e647d3c94767d7ed20f58dc9fefb98e61785d2164";

interface PackageManifest {
	dependencies: Record<string, string>;
	devDependencies: Record<string, string>;
}

interface ComponentsConfig {
	style: string;
	rsc: boolean;
	tsx: boolean;
	iconLibrary: string;
	tailwind: {
		config: string;
		css: string;
		baseColor: string;
		cssVariables: boolean;
		prefix: string;
	};
	aliases: Record<string, string>;
	registries: Record<string, string>;
}

interface McpConfig {
	mcpServers: Record<
		string,
		{
			command: string;
			args: string[];
		}
	>;
}

interface ImpeccableProvenance {
	schemaVersion: number;
	tool: {
		name: string;
		version: string;
	};
	npm: {
		package: string;
		version: string;
		tarball: string;
		integrity: string;
		gitHead: string;
	};
	source: {
		repository: string;
		ref: string;
		commit: string;
		sourcePath: string;
		installedPath: string;
		filesWritten: string[];
	};
	license: string;
	policy: {
		hooks: string;
		liveMode: string;
	};
}

function readProjectFile(path: string): string {
	return readFileSync(resolve(PROJECT_ROOT, path), "utf8");
}

function readWebFile(path: string): string {
	return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

function readJson<T>(path: string): T {
	return JSON.parse(readProjectFile(path)) as T;
}

describe("UI tooling supply-chain contract", () => {
	it("pins the approved Tailwind and shadcn foundation", () => {
		const manifest = JSON.parse(
			readWebFile("package.json"),
		) as PackageManifest;
		assert.equal(manifest.devDependencies["@tailwindcss/postcss"], "4.3.3");
		assert.equal(manifest.devDependencies.tailwindcss, "4.3.3");
		assert.equal(manifest.dependencies.clsx, "2.1.1");
		assert.equal(manifest.dependencies["tailwind-merge"], "3.5.0");

		const postcss = readWebFile("postcss.config.mjs");
		assert.ok(postcss.includes('"@tailwindcss/postcss": {}'));

		const css = readWebFile("src/app/globals.css");
		assert.ok(css.includes('@import "tailwindcss/theme.css" layer(theme);'));
		assert.ok(
			css.includes('@import "tailwindcss/utilities.css" layer(utilities);'),
		);
		assert.ok(!css.includes('tailwindcss/preflight.css'));
		assert.ok(css.includes("@theme inline {"));

		const components = JSON.parse(
			readWebFile("components.json"),
		) as ComponentsConfig;
		assert.deepEqual(components, {
			$schema: "https://ui.shadcn.com/schema.json",
			style: "radix-nova",
			rsc: true,
			tsx: true,
			iconLibrary: "lucide",
			tailwind: {
				config: "",
				css: "src/app/globals.css",
				baseColor: "neutral",
				cssVariables: true,
				prefix: "",
			},
			aliases: {
				components: "@/components",
				utils: "@/lib/utils",
				ui: "@/components/ui",
				lib: "@/lib",
				hooks: "@/hooks",
			},
			registries: {},
		});
		assert.doesNotMatch(
			JSON.stringify(components),
			/beui|transitions\.dev|https?:\/\/(?!ui\.shadcn\.com)/i,
		);
	});

	it("pins the project-local shadcn MCP without direct or remote tools", () => {
		const mcp = readJson<McpConfig>(".mcp.json");
		assert.deepEqual(mcp, {
			mcpServers: {
				shadcn: {
					command: "npx",
					args: ["-y", "shadcn@4.19.1", "mcp"],
				},
			},
		});
	});

	it("retains pinned Impeccable provenance without requiring local skills or enabling hooks", () => {
		const provenance = readJson<ImpeccableProvenance>(
			".impeccable/provenance.json",
		);
		assert.deepEqual(provenance, {
			schemaVersion: 1,
			tool: { name: "impeccable", version: "3.6.0" },
			npm: {
				package: "impeccable",
				version: "3.6.0",
				tarball:
					"https://registry.npmjs.org/impeccable/-/impeccable-3.6.0.tgz",
				integrity:
					"sha512-nysc6/2OHTWqLrcSxTxZk4r4QMufhU8NTIuG2ic6p5zzyZe45AWBX3/18OA5S88pCWq+4z8pKsjUxhAM990RKg==",
				gitHead: "2c33196c51ac52e47691384e61d89f1218d8d21d",
			},
			source: {
				repository: "https://github.com/pbakaus/impeccable",
				ref: "refs/tags/skill-v3.6.0",
				commit: "858b9bbea637c1b3beaf89b2ff7a8c22163ee7ef",
				sourcePath: ".pi/skills/impeccable",
				installedPath: ".pi/skills/impeccable",
				filesWritten: provenance.source.filesWritten,
			},
			license: "Apache-2.0",
			policy: { hooks: "disabled", liveMode: "disabled" },
		});

		// Pin the recorded installation inventory, not machine-local file contents.
		const recordedFiles = provenance.source.filesWritten;
		assert.equal(recordedFiles.length, 91);
		assert.equal(
			createHash("sha256").update(JSON.stringify(recordedFiles)).digest("hex"),
			"9b3fbf9aa5b831a5512b8f36a4005e889fc721c817158bd59d90c5bbd1d3bd4a",
		);
		assert.ok(recordedFiles.includes(".pi/skills/impeccable/SKILL.md"));

		const skillsLock = readJson<{
			skills: Record<string, { computedHash: string; skillPath: string }>;
		}>("skills-lock.json");
		assert.equal(
			skillsLock.skills.impeccable?.skillPath,
			".pi/skills/impeccable/SKILL.md",
		);
		assert.equal(
			skillsLock.skills.impeccable?.computedHash,
			APPROVED_IMPECCABLE_SKILL_HASH,
		);

		for (const forbiddenPath of [
			".claude/settings.local.json",
			".cursor/hooks.json",
			".codex/hooks.json",
			".github/hooks/impeccable.json",
			".grok/hooks/impeccable.json",
			".impeccable/config.json",
			".impeccable/config.local.json",
		]) {
			assert.equal(existsSync(resolve(PROJECT_ROOT, forbiddenPath)), false);
		}
	});

	it("keeps installed Pi skills local while tracking shared exceptions and provenance", () => {
		for (const key of [
			"GIT_DIR",
			"GIT_WORK_TREE",
			"GIT_COMMON_DIR",
			"GIT_INDEX_FILE",
			"GIT_OBJECT_DIRECTORY",
			"GIT_ALTERNATE_OBJECT_DIRECTORIES",
		]) {
			assert.equal(Object.hasOwn(process.env, key), false, "Git override present");
		}
		const provenance = readJson<ImpeccableProvenance>(
			".impeccable/provenance.json",
		);
		const localPaths = [
			...provenance.source.filesWritten,
			".pi/skills/another-installed-skill/SKILL.md",
			".pi/runtime-state.json",
			".pi/gentle-ai/local-state.json",
		];
		const sharedPaths = [
			".impeccable/provenance.json",
			".pi/gentle-ai/persona.json",
			".pi/skills/supabase",
			".pi/skills/supabase-postgres-best-practices",
			"skills-lock.json",
		];
		const options: SpawnSyncOptionsWithStringEncoding = {
			cwd: PROJECT_ROOT,
			env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			shell: false,
		};
		// --no-index tests ignore policy even if a local skill is force-added.
		// These paths need not exist: a clean checkout must satisfy the contract.
		const ignored = spawnSync(
			"git",
			["check-ignore", "--no-index", "--", ...localPaths, ...sharedPaths],
			options,
		);
		assert.equal(ignored.status, 0, "Git ignore policy check failed");
		assert.equal(ignored.stdout, `${localPaths.join("\n")}\n`);

		const tracked = spawnSync(
			"git",
			["ls-files", "--", ".pi", ".impeccable/provenance.json", "skills-lock.json"],
			options,
		);
		assert.equal(tracked.status, 0, "Git tracking policy check failed");
		assert.equal(tracked.stdout, `${sharedPaths.join("\n")}\n`);
	});

	it("retains the production legacy CSS contracts during progressive migration", () => {
		const css = readWebFile("src/app/globals.css");
		for (const selector of [
			".skip-link",
			".app-shell",
			".site-header",
			".navigation-list",
			".page-shell",
			".panel",
			".button--primary",
			".login-form",
			".table-scroll",
			".data-table",
			".simulation-form",
			".evidence-container",
		]) {
			assert.ok(css.includes(selector));
		}
	});
});
