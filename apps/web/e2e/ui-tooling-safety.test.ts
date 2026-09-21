import assert from "node:assert/strict";
import {
	spawnSync,
	type SpawnSyncOptionsWithStringEncoding,
} from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";

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
interface PackageManifest {
	packageManager: string;
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

function readProjectFile(path: string): string {
	return readFileSync(resolve(PROJECT_ROOT, path), "utf8");
}

function readWebFile(path: string): string {
	return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

function readJson<T>(path: string): T {
	return JSON.parse(readProjectFile(path)) as T;
}

function assertNoTrackedImpeccableProviderPaths(trackedOutput: string): void {
	assert.equal(
		trackedOutput,
		"",
		"Impeccable provider paths must not be tracked",
	);
}

describe("UI tooling supply-chain contract", () => {
	it("pins the approved Tailwind and shadcn foundation", () => {
		const manifest = JSON.parse(
			readWebFile("package.json"),
		) as PackageManifest;
		assert.equal(manifest.devDependencies["@tailwindcss/postcss"], "4.3.3");
		assert.equal(manifest.devDependencies.tailwindcss, "4.3.3");
		assert.equal(manifest.dependencies.clsx, "2.1.1");
		assert.equal(manifest.dependencies["tailwind-merge"], "3.6.0");
		assert.equal(manifest.packageManager, "pnpm@12.3.4");

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
					args: ["-y", "shadcn@4.21.0", "mcp"],
				},
			},
		});
	});

	it("removes Impeccable skill lock while retaining Supabase skill locks", () => {
		const skillsLock = readJson<{
			skills: Record<string, { computedHash: string; skillPath: string }>;
		}>("skills-lock.json");
		assert.equal(Object.hasOwn(skillsLock.skills, "impeccable"), false);
		assert.deepEqual(Object.keys(skillsLock.skills).sort(), [
			"supabase",
			"supabase-postgres-best-practices",
		]);
	});

	it("removes obsolete Impeccable provenance", () => {
		assert.equal(
			existsSync(resolve(PROJECT_ROOT, ".impeccable/provenance.json")),
			false,
		);
	});

	it("ignores local tooling artifacts without hiding shared configuration", () => {
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
		const localPaths = [
			".agents/skills/impeccable/reference/layout.md",
			".claude/skills/impeccable/reference/layout.md",
			".claude/agents/impeccable-reviewer.md",
			".claude/settings.local.json",
			".codex/hooks.json",
			".github/skills/impeccable/reference/layout.md",
			".github/agents/impeccable-reviewer.agent.md",
			".github/hooks/impeccable.json",
			".opencode/skills/impeccable/reference/layout.md",
			".opencode/commands/impeccable.md",
			".pi/skills/impeccable/reference/layout.md",
			".pi/skills/another-installed-skill/SKILL.md",
			".pi/runtime-state.json",
			".pi/gentle-ai/local-state.json",
			".impeccable/config.local.json",
			".impeccable/live/session.json",
			".impeccable/logs/installer.log",
			".DS_Store",
			"apps/web/.DS_Store",
			"coverage/lcov.info",
			"apps/web/coverage/lcov.info",
			".turbo/turbo-build.log",
			".eslintcache",
			"apps/web/.eslintcache",
			"logs/web.log",
			"apps/web/logs/web.log",
			"apps/web/src/app/page.tsx.swp",
			"apps/web/src/app/page.tsx.swo",
		];
		const sharedPaths = [
			".mcp.json",
			".pi/gentle-ai/persona.json",
			".pi/skills/supabase",
			".pi/skills/supabase-postgres-best-practices",
			"skills-lock.json",
		];
		const unignoredPaths = [...sharedPaths, ".impeccable/config.json"];
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
			["check-ignore", "--no-index", "--", ...localPaths, ...unignoredPaths],
			options,
		);
		assert.equal(ignored.status, 0, "Git ignore policy check failed");
		assert.equal(ignored.stdout, `${localPaths.join("\n")}\n`);

		const tracked = spawnSync(
			"git",
			[
				"ls-files",
				"--",
				":(glob).agents/skills/impeccable/**",
				":(glob).claude/skills/impeccable/**",
				":(glob).claude/agents/impeccable-*.md",
				".claude/settings.local.json",
				".codex/hooks.json",
				":(glob).github/skills/impeccable/**",
				":(glob).github/agents/impeccable-*.agent.md",
				".github/hooks/impeccable.json",
				":(glob).opencode/skills/impeccable/**",
				".opencode/commands/impeccable.md",
				":(glob).pi/skills/impeccable/**",
			],
			options,
		);
		assert.equal(tracked.status, 0, "Git tracking policy check failed");
		assertNoTrackedImpeccableProviderPaths(tracked.stdout);

		const sharedTracked = spawnSync(
			"git",
			["ls-files", "--", ...sharedPaths],
			options,
		);
		assert.equal(sharedTracked.status, 0, "Shared tracking policy check failed");
		assert.equal(sharedTracked.stdout, `${sharedPaths.join("\n")}\n`);

	});

	it("rejects fabricated tracked Impeccable provider output", () => {
		assert.throws(() =>
			assertNoTrackedImpeccableProviderPaths(
				".pi/skills/impeccable/reference/layout.md\n",
			),
		);
	});

	it("removes local Impeccable provider hooks", () => {
		for (const forbiddenPath of [
			".claude/settings.local.json",
			".codex/hooks.json",
			".github/hooks/impeccable.json",
		]) {
			assert.equal(
				existsSync(resolve(PROJECT_ROOT, forbiddenPath)),
				false,
				`Impeccable provider hook remains at ${forbiddenPath}`,
			);
		}
	});

	it("rejects legacy button className tokens in production app and components", () => {
		const violations: string[] = [];
		const legacyTokens = new Set([
			"button",
			"button--primary",
			"button--secondary",
		]);

		function inspectDirectory(directory: string): void {
			for (const entry of readdirSync(directory, { withFileTypes: true })) {
				const path = resolve(directory, entry.name);
				if (entry.isDirectory()) {
					if (!["__tests__", "__specs__"].includes(entry.name)) {
						inspectDirectory(path);
					}
					continue;
				}
				if (
					!entry.isFile() ||
					!/\.tsx?$/.test(entry.name) ||
					/\.(test|spec)\.tsx?$/.test(entry.name)
				) {
					continue;
				}
				const source = ts.createSourceFile(
					path,
					readFileSync(path, "utf8"),
					ts.ScriptTarget.Latest,
					true,
				);
				function inspectClassValue(node: ts.Node): void {
					if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
						for (const token of node.text.split(/\s+/)) {
							if (legacyTokens.has(token)) {
								const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
								violations.push(`${relative(WEB_ROOT, path)}:${line + 1}: ${token}`);
							}
						}
					}
					ts.forEachChild(node, inspectClassValue);
				}
				function visit(node: ts.Node): void {
					if (ts.isJsxAttribute(node) && node.name.getText(source) === "className" && node.initializer) {
						inspectClassValue(node.initializer);
					}
					ts.forEachChild(node, visit);
				}
				visit(source);
			}
		}

		inspectDirectory(resolve(WEB_ROOT, "src/app"));
		inspectDirectory(resolve(WEB_ROOT, "src/components"));
		assert.deepEqual(violations, [], "Legacy button className tokens remain");
	});

	it("removes obsolete zero-caller CSS selectors including responsive definitions", () => {
		const css = readWebFile("src/app/globals.css");
		const obsoleteSelectors = [
			".site-header",
			".site-header__inner",
			".site-context",
			".status-label",
			".public-shell",
			".page-header__supporting",
			".text-link",
			".button",
			".button--primary",
			".button--secondary",
			".data-number",
			".long-content",
			".evidence-container",
		];
		// Scan the entire stylesheet, including nested media queries, with exact class boundaries.
		const remaining = obsoleteSelectors.filter((selector) =>
			new RegExp(`\\${selector}(?![\\w-])`).test(css),
		);
		assert.deepEqual(remaining, [], "Obsolete CSS selectors remain in globals.css");
	});

	it("retains critical CSS surfaces and Tailwind 4 imports after migration", () => {
		const css = readWebFile("src/app/globals.css");
		for (const selector of [
			".app-shell",
			".table-scroll",
			".data-table",
			".simulation-form",
			".evidence-state",
		]) {
			assert.match(css, new RegExp(`\\${selector}(?![\\w-])`), selector);
		}
		assert.ok(css.includes('@import "tailwindcss/theme.css" layer(theme);'));
		assert.ok(css.includes('@import "tailwindcss/utilities.css" layer(utilities);'));
	});
});
