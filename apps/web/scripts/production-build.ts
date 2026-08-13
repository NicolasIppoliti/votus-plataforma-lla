import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface ProductionBuildOperations {
	readNextEnv(): Promise<Uint8Array | null>;
	writeNextEnv(value: Uint8Array): Promise<void>;
	removeNextEnv(): Promise<void>;
	runBuild(): Promise<number>;
}

export async function runProductionBuild(
	operations: ProductionBuildOperations,
): Promise<number> {
	const originalNextEnv = await operations.readNextEnv();
	try {
		return await operations.runBuild();
	} finally {
		if (originalNextEnv === null) await operations.removeNextEnv();
		else await operations.writeNextEnv(originalNextEnv);
	}
}

function nextBuild(): Promise<number> {
	const require = createRequire(import.meta.url);
	const nextCli = require.resolve("next/dist/bin/next");
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [nextCli, "build"], {
			cwd: path.resolve("."),
			stdio: "inherit",
		});
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (signal) reject(new Error(`next build terminated by ${signal}`));
			else resolve(code ?? 1);
		});
	});
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
	const nextEnvPath = path.resolve("next-env.d.ts");
	runProductionBuild({
		readNextEnv: async () => {
			try {
				return await readFile(nextEnvPath);
			} catch (error: unknown) {
				if (
					error instanceof Error &&
					"code" in error &&
					error.code === "ENOENT"
				) {
					return null;
				}
				throw error;
			}
		},
		writeNextEnv: (value) => writeFile(nextEnvPath, value),
		removeNextEnv: () => rm(nextEnvPath, { force: true }),
		runBuild: nextBuild,
	}).then(
		(code) => {
			process.exitCode = code;
		},
		(error: unknown) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
		},
	);
}
