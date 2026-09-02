export const RELEASE_GATE_TIMING_PHASE = {
	PREFLIGHT_PORTS: "preflight_ports",
	SUPABASE_STARTUP: "supabase_startup",
	MIGRATIONS: "migrations",
	PGTAP: "pgtap",
	ROLLBACK_REAPPLY: "rollback_reapply",
	PRODUCTION_BUILD: "production_build",
	NEXT_SERVER_LIFECYCLE: "next_server_lifecycle",
	PLAYWRIGHT: "playwright",
	CLEANUP: "cleanup",
} as const;

const RELEASE_GATE_TIMING_PHASES = Object.values(RELEASE_GATE_TIMING_PHASE);
const RELEASE_GATE_TIMING_STATUS = {
	NOT_STARTED: "not_started",
	COMPLETED: "completed",
	FAILED: "failed",
} as const;
const RELEASE_GATE_TIMING_LABEL = {
	preflight_ports: "preflight/ports",
	supabase_startup: "Supabase startup",
	migrations: "migrations",
	pgtap: "pgTAP",
	rollback_reapply: "rollback/reapply",
	production_build: "production build",
	next_server_lifecycle: "Next server lifecycle",
	playwright: "Playwright",
	cleanup: "cleanup",
} as const;

export const RELEASE_GATE_TIMING_PREFIX = "E2E_RELEASE_GATE_TIMING ";

type ReleaseGateTimingPhase =
	(typeof RELEASE_GATE_TIMING_PHASE)[keyof typeof RELEASE_GATE_TIMING_PHASE];
type ReleaseGateTimingStatus =
	(typeof RELEASE_GATE_TIMING_STATUS)[keyof typeof RELEASE_GATE_TIMING_STATUS];

interface ReleaseGateTimingOptions {
	now: () => number;
	writeOutput: (chunk: string) => void;
}

interface ReleaseGateTimingRecord {
	name: ReleaseGateTimingPhase;
	durationMs: number;
	status: ReleaseGateTimingStatus;
}

function durationMs(startedAt: number, completedAt: number): number {
	return Math.max(0, Math.trunc(completedAt - startedAt));
}

export function createReleaseGateTiming(options: ReleaseGateTimingOptions) {
	const records = new Map<ReleaseGateTimingPhase, ReleaseGateTimingRecord>(
		RELEASE_GATE_TIMING_PHASES.map((name) => [
			name,
			{
				name,
				durationMs: 0,
				status: RELEASE_GATE_TIMING_STATUS.NOT_STARTED,
			},
		]),
	);

	return {
		measure: async <T>(
			phase: ReleaseGateTimingPhase,
			action: () => Promise<T>,
		): Promise<T> => {
			const record = records.get(phase);
			if (!record) throw new Error("unknown release-gate timing phase");
			const startedAt = options.now();
			try {
				const value = await action();
				record.durationMs += durationMs(startedAt, options.now());
				record.status = RELEASE_GATE_TIMING_STATUS.COMPLETED;
				return value;
			} catch (error) {
				record.durationMs += durationMs(startedAt, options.now());
				record.status = RELEASE_GATE_TIMING_STATUS.FAILED;
				throw error;
			}
		},
		emit: (): void => {
			const phases = RELEASE_GATE_TIMING_PHASES.map((name) => records.get(name)!);
			options.writeOutput(
				`E2E release gate timings: ${phases
					.map(
						({ name, durationMs: duration, status }) =>
							`${RELEASE_GATE_TIMING_LABEL[name]}=${duration}ms ${status}`,
					)
					.join(", ")}\n`,
			);
			options.writeOutput(
				`${RELEASE_GATE_TIMING_PREFIX}${JSON.stringify({ schemaVersion: 1, phases })}\n`,
			);
		},
	};
}
