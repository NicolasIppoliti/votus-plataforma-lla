import { describe, expect, it } from "vitest";
import { runProductionBuild } from "../../scripts/production-build";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

describe("production build wrapper", () => {
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
