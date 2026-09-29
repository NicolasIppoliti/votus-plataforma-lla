import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:child_process")>()), spawn,
}));
import { runProductionBuild } from "../../scripts/production-build";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

describe("production build wrapper", () => {
	it.each([
		[undefined, ["build"]],
		["1", ["build", "--experimental-analyze"]],
	])("launches the production entry with marker %s and exact build args", async (marker, expected) => {
		const entry = resolve("scripts/production-build.ts");
		const argv = vi.spyOn(process, "argv", "get").mockReturnValue([process.execPath, entry]);
		const original = process.env.VOTUS_E2E_ANALYZE_PRODUCTION_BUILD;
		if (marker === undefined) delete process.env.VOTUS_E2E_ANALYZE_PRODUCTION_BUILD;
		else process.env.VOTUS_E2E_ANALYZE_PRODUCTION_BUILD = marker;
		spawn.mockImplementation(() => {
			const child = new EventEmitter();
			queueMicrotask(() => child.emit("exit", 0, null));
			return child;
		});
		try {
			if (marker === undefined) {
				// @ts-expect-error Vitest resolves query-qualified source modules.
				await import("../../scripts/production-build.ts?entry=default");
			} else {
				// @ts-expect-error Vitest resolves query-qualified source modules.
				await import("../../scripts/production-build.ts?entry=analyze");
			}
			await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
			expect(spawn.mock.calls[0]?.[1]?.slice(1)).toEqual(expected);
		} finally {
			argv.mockRestore(); spawn.mockReset();
			if (original === undefined) delete process.env.VOTUS_E2E_ANALYZE_PRODUCTION_BUILD;
			else process.env.VOTUS_E2E_ANALYZE_PRODUCTION_BUILD = original;
		}
	});

	it.each([0, 1])(
		"restores tracked next-env bytes when the build exits %i",
		async (exitCode) => {
			let current: Uint8Array | null = bytes(
				'/// <reference path="./.next/dev/types/routes.d.ts" />\n',
			);
			const original = current;
			const result = await runProductionBuild({
				readNextEnv: async () => current,
				writeNextEnv: async (value) => {
					current = value;
				},
				removeNextEnv: async () => {
					current = null;
				},
				runBuild: async () => {
					current = bytes(
						'/// <reference path="./.next/types/routes.d.ts" />\n',
					);
					return exitCode;
				},
			});

			expect([result, current]).toEqual([exitCode, original]);
		},
	);

	it("rejects an invalid analysis marker without spawning a build", async () => {
		const original = process.env.VOTUS_E2E_ANALYZE_PRODUCTION_BUILD;
		const originalExitCode = process.exitCode;
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		process.env.VOTUS_E2E_ANALYZE_PRODUCTION_BUILD = "true";
		const entry = resolve("scripts/production-build.ts");
		const argv = vi.spyOn(process, "argv", "get").mockReturnValue([process.execPath, entry]);
		try {
			// @ts-expect-error Vitest resolves query-qualified source modules.
			await import("../../scripts/production-build.ts?entry=invalid");
			await vi.waitFor(() => expect(process.exitCode).toBe(1));
			expect(spawn).not.toHaveBeenCalled();
		} finally {
			process.exitCode = originalExitCode;
			error.mockRestore(); argv.mockRestore();
			if (original === undefined) delete process.env.VOTUS_E2E_ANALYZE_PRODUCTION_BUILD;
			else process.env.VOTUS_E2E_ANALYZE_PRODUCTION_BUILD = original;
		}
	});

	it("restores the file when launching the build throws", async () => {
		let current: Uint8Array | null = bytes("original");
		await expect(
			runProductionBuild({
				readNextEnv: async () => current,
				writeNextEnv: async (value) => {
					current = value;
				},
				removeNextEnv: async () => {
					current = null;
				},
				runBuild: async () => {
					current = bytes("mutated");
					throw new Error("launch failed");
				},
			}),
		).rejects.toThrow("launch failed");
		expect(current).toEqual(bytes("original"));
	});

	it("removes next-env when it did not exist before the build", async () => {
		let current: Uint8Array | null = null;
		await runProductionBuild({
			readNextEnv: async () => current,
			writeNextEnv: async (value) => {
				current = value;
			},
			removeNextEnv: async () => {
				current = null;
			},
			runBuild: async () => {
				current = bytes("generated");
				return 0;
			},
		});

		expect(current).toBeNull();
	});
});
