import { open } from "node:fs/promises";
import { z } from "zod";
import { EXPECTED_E2E_SPECS } from "./gate-contract.ts";

export const PLAYWRIGHT_DIAGNOSTIC_LIMIT = 256 * 1024;
export const diagnosticPath = (receiptPath: string) => `${receiptPath}.diagnostics.json`;
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const attemptStatus = z.enum(["failed", "timedOut", "skipped", "interrupted"]);
export const attemptSchema = z.strictObject({
	spec: z.enum(EXPECTED_E2E_SPECS),
	line: count.positive(),
	column: count.positive(),
	ordinal: count.positive(),
	status: attemptStatus,
	retry: count,
});
export const companionSchema = z.strictObject({
	schemaVersion: z.literal(1),
	attempts: z.array(attemptSchema).max(1024),
	counts: z.record(attemptStatus, count),
	missingResults: count,
	unexpectedDiscoveries: count,
	unmappableAttempts: count,
	report: z.enum(["accepted", "rejected"]),
});
export type PlaywrightAttempt = z.infer<typeof attemptSchema>;
export type CompanionReport = z.infer<typeof companionSchema>["report"];

const diagnosticSchema = z.strictObject({
	schemaVersion: z.literal(1),
	exitCode: z.number().int().min(0).max(255).nullable(),
	spawn: z.enum(["completed", "failed"]),
	availability: z.enum(["available", "missing", "unreadable", "oversized", "invalid-json", "invalid-schema", "unavailable"]),
	companion: companionSchema.optional(),
	issues: z.array(z.strictObject({
		code: z.enum(["invalid_type", "too_big", "too_small", "invalid_format", "not_multiple_of", "unrecognized_keys", "invalid_union", "invalid_key", "invalid_element", "invalid_value", "custom"]),
		count,
	})).max(11).optional(),
});
type Diagnostic = z.infer<typeof diagnosticSchema>;

export class PlaywrightFailure extends Error {
	readonly diagnostic: Diagnostic;
	constructor(diagnostic: Diagnostic) {
		super("Playwright release suite failed; output redacted");
		this.diagnostic = diagnostic;
	}
	line(): string {
		return `E2E_PLAYWRIGHT_DIAGNOSTIC ${JSON.stringify(diagnosticSchema.parse(this.diagnostic))}\n`;
	}
}

export async function playwrightFailure(
	exit: number | null,
	spawnFailed: boolean,
	receiptPath: string,
): Promise<PlaywrightFailure> {
	const base = {
		schemaVersion: 1 as const,
		exitCode: Number.isInteger(exit) && exit !== null && exit >= 0 && exit <= 255 ? exit : null,
		spawn: spawnFailed ? "failed" as const : "completed" as const,
	};
	const failure = (availability: Diagnostic["availability"]) => new PlaywrightFailure({ ...base, availability });
	let text: string;
	try {
		const file = await open(diagnosticPath(receiptPath), "r");
		try {
			const buffer = Buffer.alloc(PLAYWRIGHT_DIAGNOSTIC_LIMIT + 1);
			let size = 0;
			while (size < buffer.length) {
				const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
				if (bytesRead === 0) break;
				size += bytesRead;
			}
			if (size > PLAYWRIGHT_DIAGNOSTIC_LIMIT) return failure("oversized");
			text = buffer.subarray(0, size).toString("utf8");
		} finally {
			await file.close();
		}
	} catch (error) {
		return failure(error instanceof Error && "code" in error && error.code === "ENOENT" ? "missing" : "unreadable");
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return failure("invalid-json");
	}
	try {
		const parsed = companionSchema.safeParse(value);
		if (parsed.success)
			return new PlaywrightFailure({ ...base, availability: "available", companion: parsed.data });
		const counts = new Map<z.core.$ZodIssue["code"], number>();
		for (const issue of parsed.error.issues)
			counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
		return new PlaywrightFailure({
			...base, availability: "invalid-schema",
			issues: [...counts].map(([code, count]) => ({ code, count })),
		});
	} catch {
		return failure("unavailable");
	}
}
