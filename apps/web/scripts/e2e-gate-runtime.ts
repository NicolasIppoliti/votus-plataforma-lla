import {
	planOwnedCleanup,
	type CleanupAction,
	type GateOwnership,
} from "../e2e/gate-contract.ts";

export const SUPABASE_START_TIMEOUT_MS = 10 * 60_000;

const OWNED_SQL_HOST_GRACE_MS = 15_000;
const OWNED_SQL_PROJECT_ID_PATTERN = /^votus-e2e-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export interface OwnedSqlInvocation {
	command: "docker";
	args: readonly string[];
	hostTimeoutMs: number;
}

export function planOwnedSqlInvocation(
	projectId: string,
	phaseTimeoutMs: number,
): OwnedSqlInvocation {
	if (
		projectId.length > 39 ||
		!OWNED_SQL_PROJECT_ID_PATTERN.test(projectId)
	)
		throw new Error("owned SQL project ID is invalid");
	if (
		!Number.isSafeInteger(phaseTimeoutMs) ||
		phaseTimeoutMs <= 0 ||
		phaseTimeoutMs > SUPABASE_START_TIMEOUT_MS ||
		phaseTimeoutMs % 1_000 !== 0
	)
		throw new Error(
			"owned SQL phase timeout must be positive whole seconds within 10 minutes",
		);
	return {
		command: "docker",
		args: [
			"exec",
			"-i",
			`supabase_db_${projectId}`,
			"timeout",
			"-s",
			"INT",
			"-k",
			"10",
			String(phaseTimeoutMs / 1_000),
			"psql",
			"-X",
			"-v",
			"ON_ERROR_STOP=1",
			"-U",
			"postgres",
			"-d",
			"postgres",
		],
		hostTimeoutMs: phaseTimeoutMs + OWNED_SQL_HOST_GRACE_MS,
	};
}

export const RELEASE_GATE_MODE = {
	FULL: "full",
	RELEASE_PROOF_ONLY: "release-proof-only",
	SCALE_PROOF_ONLY: "scale-proof-only",
	ROLLBACK_PROOFS_ONLY: "rollback-proofs-only",
} as const;

export type ReleaseGateMode =
	(typeof RELEASE_GATE_MODE)[keyof typeof RELEASE_GATE_MODE];

export interface PortReservation {
	port: number;
	release(): Promise<void>;
}

interface OwnershipState {
	ownership?: GateOwnership;
}

interface OwnershipEffects {
	createWorkdir(): void;
	writeMarker(): void;
	rollbackWorkdir(): void;
}

export interface StackStatus {
	API_URL: string;
	DB_URL: string;
	ANON_KEY: string;
	SERVICE_ROLE_KEY: string;
}

export interface ReleaseGateSyntheticMigration {
	version: string;
	fileName: string;
	sourcePath: string;
}

export interface ReleaseGatePgTapProof {
	path: string;
	label: string;
	timeoutMs: number;
}

export interface ReleaseGateSetupProof {
	path: string;
	label: string;
	timeoutMs: number;
	beforePgTapPath: string;
}

export interface ReleaseGatePostPgTapCleanupProof {
	path: string;
	label: string;
	timeoutMs: number;
	afterPgTapPath: string;
}

export interface ReleaseGateSqlProof {
	path: string;
	label: string;
}

export interface ReleaseGatePlan {
	mode: ReleaseGateMode;
	migrationVersions: readonly string[];
	syntheticMigration: ReleaseGateSyntheticMigration;
	setupProofs: readonly ReleaseGateSetupProof[];
	pgTapProofs: readonly ReleaseGatePgTapProof[];
	postPgTapCleanupProofs: readonly ReleaseGatePostPgTapCleanupProof[];
	rollbackReapplyProofs: readonly ReleaseGateSqlProof[];
	requireBrowserCapability: boolean;
	runBrowser: boolean;
}

export interface ReleaseGateCliDependencies {
	execute(plan: ReleaseGatePlan): Promise<void>;
	writeOutput(chunk: string): void;
}

export interface ReleaseGateProductionPhaseEffects {
	runProductionMigrations(): Promise<void>;
	validateStackStatus(): Promise<StackStatus>;
	runSetupProof(proof: ReleaseGateSetupProof): Promise<void>;
	runPgTapProof(proof: ReleaseGatePgTapProof): Promise<void>;
	runPostPgTapCleanupProof(
		proof: ReleaseGatePostPgTapCleanupProof,
	): Promise<void>;
	runRollbackReapplyProof(proof: ReleaseGateSqlProof): Promise<void>;
	installSyntheticMigration(
		migration: ReleaseGateSyntheticMigration,
	): Promise<void>;
}

export interface ReleaseGateCleanupState<TServer> {
	ownership?: GateOwnership;
	stackMutationAttempted: boolean;
	servers?: readonly TServer[];
	reservations?: readonly PortReservation[];
}

export interface ReleaseGateCleanupDependencies<TServer> {
	tempRoot(): string;
	readOwnershipMarker(workdir: string): Promise<string>;
	stopServer(server: TServer): Promise<void>;
	verifyServerStopped(server: TServer): Promise<void>;
	stopStack(workdir: string, projectId: string): Promise<void>;
	listOwnedContainers(projectId: string): readonly string[];
	removeContainers(names: readonly string[]): Promise<void>;
	listOwnedVolumes(projectId: string): readonly string[];
	removeVolumes(names: readonly string[]): Promise<void>;
	removeWorkdir(workdir: string): Promise<void>;
	workdirExists(workdir: string): boolean;
}

const PBA_113_MIGRATION_VERSION = "20260824193650";
const WORKSPACE_FOUNDATION_MIGRATION_VERSION = "20260825144358";
const WORKSPACE_AUTHORITY_FACTS_MIGRATION_VERSION = "20260825165116";
const WORKSPACE_ADMIN_MIGRATION_VERSION = "20260825180048";
const WORKSPACE_CONTEXT_MIGRATION_VERSION = "20260826033130";
const WORKSPACE_SELECTION_MIGRATION_VERSION = "20260826050000";
const MIGRATION_VERSIONS = [
	...Array.from({ length: 37 }, (_, index) =>
		String(index + 1).padStart(4, "0"),
	),
	PBA_113_MIGRATION_VERSION,
	WORKSPACE_FOUNDATION_MIGRATION_VERSION,
	WORKSPACE_AUTHORITY_FACTS_MIGRATION_VERSION,
	WORKSPACE_ADMIN_MIGRATION_VERSION,
	WORKSPACE_CONTEXT_MIGRATION_VERSION,
	WORKSPACE_SELECTION_MIGRATION_VERSION,
];

const SYNTHETIC_MIGRATION: ReleaseGateSyntheticMigration = {
	version: "0039",
	fileName: "0039_e2e_service_role_grants.sql",
	sourcePath: "e2e/service-role-grants.sql",
};

const PRODUCTION_MIGRATION_FILE_PATTERN =
	/^(\d{4}|\d{14})_[^/]+\.sql$/;

export function migrationVersionFromFileName(fileName: string): string {
	const match = fileName.match(PRODUCTION_MIGRATION_FILE_PATTERN);
	if (!match) throw new Error(`invalid production migration filename: ${fileName}`);
	return match[1]!;
}

function expectedMigrationBoundary(expectedVersions: readonly string[]): string {
	const first = expectedVersions[0];
	const last = expectedVersions.at(-1);
	const previous = expectedVersions.at(-2);
	return last?.length === 14 && previous
		? `${first} through ${previous} plus ${last}`
		: `${first} through ${last}`;
}

export function assertExactMigrationInventory(
	actualVersions: readonly string[],
	expectedVersions: readonly string[],
): void {
	if (JSON.stringify(actualVersions) === JSON.stringify(expectedVersions))
		return;
	throw new Error(
		`migration inventory must be exactly versions ${expectedMigrationBoundary(expectedVersions)}`,
	);
}

export function assertSyntheticMigrationDoesNotCollide(
	productionFileNames: readonly string[],
	syntheticMigration: ReleaseGateSyntheticMigration,
): void {
	const collision = productionFileNames.find(
		(name) => migrationVersionFromFileName(name) === syntheticMigration.version,
	);
	if (collision)
		throw new Error(
			`synthetic migration ${syntheticMigration.version} collides with production migration ${collision}`,
		);
	if (!syntheticMigration.fileName.startsWith(`${syntheticMigration.version}_`))
		throw new Error(
			`synthetic migration filename must start with version ${syntheticMigration.version}`,
		);
}

const SETUP_PROOFS: readonly ReleaseGateSetupProof[] = [
	{
		path: "tests/results_exploration_scale_setup.sql",
		label: "disposable scale fixture setup",
		timeoutMs: 600_000,
		beforePgTapPath: "tests/results_exploration_scale.sql",
	},
];

const PG_TAP_PROOFS: readonly ReleaseGatePgTapProof[] = [
	{
		path: "tests/results_exploration.sql",
		label: "disposable results-exploration pgTAP",
		timeoutMs: 120_000,
	},
	{
		path: "tests/results_exploration_scale.sql",
		label: "disposable scale payload/parity pgTAP",
		timeoutMs: 360_000,
	},
	{
		path: "tests/results_exploration_scale_plans.sql",
		label: "disposable scale EXPLAIN/plan pgTAP",
		timeoutMs: 360_000,
	},
	{
		path: "tests/results_coverage_scope_binding.sql",
		label: "disposable coverage-scope-binding pgTAP",
		timeoutMs: 120_000,
	},
	{
		path: "tests/workspace_foundation.sql",
		label: "disposable workspace-foundation pgTAP",
		timeoutMs: 120_000,
	},
	{
		path: "tests/workspace_administration.sql",
		label: "disposable workspace-administration pgTAP",
		timeoutMs: 120_000,
	},
	{
		path: "tests/workspace_context_invalidation.sql",
		label: "disposable workspace-context invalidation pgTAP",
		timeoutMs: 120_000,
	},
];

const POST_PG_TAP_CLEANUP_PROOFS: readonly ReleaseGatePostPgTapCleanupProof[] = [
	{
		path: "tests/results_exploration_scale_cleanup.sql",
		label: "disposable scale fixture SQL cleanup",
		timeoutMs: 360_000,
		afterPgTapPath: "tests/results_exploration_scale_plans.sql",
	},
];

const ROLLBACK_REAPPLY_PROOFS: readonly ReleaseGateSqlProof[] = [
	{
		path: "tests/results_exploration_release.sql",
		label: "disposable rollback/reapply proof",
	},
	{
		path: "tests/results_coverage_scope_binding_release.sql",
		label: "disposable coverage-scope-binding rollback/reapply proof",
	},
];

function releaseGateMode(argv: readonly string[]): ReleaseGateMode {
	const releaseProofOnly = argv.includes("--release-proof-only");
	const scaleProofOnly = argv.includes("--scale-proof-only");
	const rollbackProofsOnly = argv.includes("--rollback-proofs-only");
	if (
		[releaseProofOnly, scaleProofOnly, rollbackProofsOnly].filter(Boolean)
			.length > 1
	)
		throw new Error("reduced proof modes cannot be combined");
	if (rollbackProofsOnly) return RELEASE_GATE_MODE.ROLLBACK_PROOFS_ONLY;
	if (scaleProofOnly) return RELEASE_GATE_MODE.SCALE_PROOF_ONLY;
	if (releaseProofOnly) return RELEASE_GATE_MODE.RELEASE_PROOF_ONLY;
	return RELEASE_GATE_MODE.FULL;
}

export function createReleaseGatePlan(mode: ReleaseGateMode): ReleaseGatePlan {
	const rollbackProofsOnly = mode === RELEASE_GATE_MODE.ROLLBACK_PROOFS_ONLY;
	const scaleProofOnly = mode === RELEASE_GATE_MODE.SCALE_PROOF_ONLY;
	return {
		mode,
		migrationVersions: [...MIGRATION_VERSIONS],
		syntheticMigration: { ...SYNTHETIC_MIGRATION },
		setupProofs: rollbackProofsOnly
			? []
			: SETUP_PROOFS.filter(
					(proof) =>
						!scaleProofOnly ||
						proof.beforePgTapPath === "tests/results_exploration_scale.sql",
				).map((proof) => ({ ...proof })),
		pgTapProofs: rollbackProofsOnly
			? []
			: PG_TAP_PROOFS.filter(
					(proof) =>
						!scaleProofOnly ||
						proof.path === "tests/results_exploration_scale.sql" ||
						proof.path === "tests/results_exploration_scale_plans.sql",
				).map((proof) => ({ ...proof })),
		postPgTapCleanupProofs: rollbackProofsOnly
			? []
			: POST_PG_TAP_CLEANUP_PROOFS.map((proof) => ({ ...proof })),
		rollbackReapplyProofs: scaleProofOnly
			? []
			: ROLLBACK_REAPPLY_PROOFS.map((proof) => ({ ...proof })),
		requireBrowserCapability:
			mode === RELEASE_GATE_MODE.FULL ||
			mode === RELEASE_GATE_MODE.RELEASE_PROOF_ONLY,
		runBrowser: mode === RELEASE_GATE_MODE.FULL,
	};
}

export async function runProductionReleasePhases(
	plan: ReleaseGatePlan,
	effects: ReleaseGateProductionPhaseEffects,
): Promise<StackStatus> {
	await effects.runProductionMigrations();
	const stack = await effects.validateStackStatus();
	for (const proof of plan.pgTapProofs) {
		for (const setup of plan.setupProofs)
			if (setup.beforePgTapPath === proof.path)
				await effects.runSetupProof(setup);
		await effects.runPgTapProof(proof);
		for (const cleanup of plan.postPgTapCleanupProofs)
			if (cleanup.afterPgTapPath === proof.path)
				await effects.runPostPgTapCleanupProof(cleanup);
	}
	for (const proof of plan.rollbackReapplyProofs)
		await effects.runRollbackReapplyProof(proof);
	if (plan.mode !== RELEASE_GATE_MODE.SCALE_PROOF_ONLY)
		await effects.installSyntheticMigration(plan.syntheticMigration);
	return stack;
}

export function formatPgTapFailure(
	label: string,
	status: number | null,
	stdout: string,
): string {
	const evidence = stdout.trim();
	return `${label} failed (exit ${status ?? "unavailable"}); pgTAP output:\n${evidence || "no pgTAP stdout"}`;
}

export async function runReleaseGateCli(
	argv: readonly string[],
	dependencies: ReleaseGateCliDependencies,
): Promise<void> {
	const plan = createReleaseGatePlan(releaseGateMode(argv));
	if (argv.includes("--inspect-plan")) {
		dependencies.writeOutput(`${JSON.stringify(plan, null, 2)}\n`);
		return;
	}
	await dependencies.execute(plan);
}

function collect(errors: unknown[], error: unknown): void {
	if (error instanceof AggregateError) errors.push(...error.errors);
	else errors.push(error);
}

export async function runOwnedCleanup(
	actions: readonly CleanupAction[],
	execute: (action: CleanupAction) => Promise<void>,
	verifyResiduals: () => Promise<void>,
): Promise<void> {
	const errors: unknown[] = [];
	for (const action of actions)
		try {
			await execute(action);
		} catch (error) {
			collect(errors, error);
		}
	try {
		await verifyResiduals();
	} catch (error) {
		collect(errors, error);
	}
	if (errors.length > 0)
		throw new AggregateError(errors, "owned cleanup failed");
}

export async function runOwnedServerCleanup<T>(
	servers: readonly T[],
	stop: (server: T) => Promise<void>,
	verify: (server: T) => Promise<void>,
): Promise<void> {
	const errors: unknown[] = [];
	for (const server of servers)
		try {
			await stop(server);
		} catch (error) {
			collect(errors, error);
		}
	for (const server of servers)
		try {
			await verify(server);
		} catch (error) {
			collect(errors, error);
		}
	if (errors.length > 0)
		throw new AggregateError(errors, "owned server cleanup failed");
}

function removeOwnedContainers<TServer>(
	projectId: string,
	dependencies: ReleaseGateCleanupDependencies<TServer>,
): Promise<void> {
	const containers = dependencies.listOwnedContainers(projectId);
	if (containers.some((name) => !name.endsWith(`_${projectId}`)))
		throw new Error(
			"refusing to remove a container without the exact owned project suffix",
		);
	return containers.length > 0
		? dependencies.removeContainers(containers)
		: Promise.resolve();
}

function removeOwnedVolumes<TServer>(
	projectId: string,
	dependencies: ReleaseGateCleanupDependencies<TServer>,
): Promise<void> {
	const volumes = dependencies.listOwnedVolumes(projectId);
	if (volumes.some((name) => !name.endsWith(`_${projectId}`)))
		throw new Error(
			"refusing to remove a volume without the exact owned project suffix",
		);
	return volumes.length > 0
		? dependencies.removeVolumes(volumes)
		: Promise.resolve();
}

async function verifyCleanupResiduals<TServer>(
	ownership: GateOwnership,
	dependencies: ReleaseGateCleanupDependencies<TServer>,
): Promise<void> {
	const errors: unknown[] = [];
	for (const listResources of [
		dependencies.listOwnedContainers,
		dependencies.listOwnedVolumes,
	])
		try {
			if (listResources(ownership.projectId).length > 0)
				errors.push(
					new Error("disposable Supabase cleanup left owned Docker state"),
				);
		} catch {
			errors.push(
				new Error("disposable Supabase cleanup left owned Docker state"),
			);
		}
	try {
		if (dependencies.workdirExists(ownership.workdir))
			errors.push(new Error("disposable workdir still exists"));
	} catch (error) {
		collect(errors, error);
	}
	if (errors.length > 0)
		throw new AggregateError(errors, "residual cleanup verification failed");
}

export async function cleanupReleaseGate<TServer>(
	state: ReleaseGateCleanupState<TServer>,
	dependencies: ReleaseGateCleanupDependencies<TServer>,
): Promise<void> {
	const errors: unknown[] = [];
	if (state.servers)
		try {
			await runOwnedServerCleanup(
				state.servers,
				dependencies.stopServer,
				dependencies.verifyServerStopped,
			);
		} catch (error) {
			collect(errors, error);
		}
	for (const reservation of state.reservations ?? [])
		try {
			await reservation.release();
		} catch (error) {
			collect(errors, error);
		}
	if (!state.ownership) {
		if (errors.length > 0) throw new AggregateError(errors, "cleanup failed");
		return;
	}
	const ownership = state.ownership;
	let actions: CleanupAction[] = [];
	try {
		const marker = JSON.parse(
			await dependencies.readOwnershipMarker(ownership.workdir),
		) as GateOwnership;
		actions = planOwnedCleanup(
			dependencies.tempRoot(),
			ownership.workdir,
			ownership,
			marker,
		);
	} catch (error) {
		collect(errors, error);
	}
	try {
		await runOwnedCleanup(
			actions,
			async (action) => {
				if (action.kind === "stop-stack" && state.stackMutationAttempted)
					await dependencies.stopStack(ownership.workdir, action.projectId);
				else if (
					action.kind === "remove-owned-containers" &&
					state.stackMutationAttempted
				)
					await removeOwnedContainers(action.projectId, dependencies);
				else if (
					action.kind === "remove-owned-volumes" &&
					state.stackMutationAttempted
				)
					await removeOwnedVolumes(action.projectId, dependencies);
				else if (action.kind === "remove-workdir")
					await dependencies.removeWorkdir(action.workdir);
			},
			() => verifyCleanupResiduals(ownership, dependencies),
		);
	} catch (error) {
		collect(errors, error);
	}
	if (errors.length > 0) throw new AggregateError(errors, "cleanup failed");
}

export function establishOwnership(
	state: OwnershipState,
	ownership: GateOwnership,
	effects: OwnershipEffects,
): void {
	state.ownership = ownership;
	try {
		effects.createWorkdir();
		effects.writeMarker();
	} catch (error) {
		try {
			effects.rollbackWorkdir();
		} catch (rollbackError) {
			throw new AggregateError(
				[error, rollbackError],
				"ownership establishment failed",
			);
		} finally {
			delete state.ownership;
		}
		throw error;
	}
}

async function releasePortReservations(
	reservations: readonly PortReservation[],
): Promise<void> {
	const errors: unknown[] = [];
	for (const reservation of [...reservations].reverse())
		try {
			await reservation.release();
		} catch (error) {
			collect(errors, error);
		}
	if (errors.length > 0)
		throw new AggregateError(errors, "port reservation release failed");
}

export async function reserveUniquePorts(
	count: number,
	reserve: () => Promise<PortReservation>,
): Promise<PortReservation[]> {
	const reservations: PortReservation[] = [];
	try {
		while (reservations.length < count) {
			const candidate = await reserve();
			if (reservations.some(({ port }) => port === candidate.port))
				await candidate.release();
			else reservations.push(candidate);
		}
		return reservations;
	} catch (error) {
		try {
			await releasePortReservations(reservations);
		} catch (cleanupError) {
			const errors = [error];
			collect(errors, cleanupError);
			throw new AggregateError(errors, "port reservation cleanup failed");
		}
		throw error;
	}
}

function parseStatusUrl(value: string, label: string): URL {
	try {
		return new URL(value);
	} catch {
		throw new Error(`Supabase ${label} is not a valid URL`);
	}
}

function isExactApiEndpoint(url: URL, expectedPort: number): boolean {
	return (
		url.protocol === "http:" &&
		url.hostname === "127.0.0.1" &&
		url.port === String(expectedPort) &&
		url.username === "" &&
		url.password === "" &&
		url.pathname === "/" &&
		url.search === "" &&
		url.hash === ""
	);
}

export function assertStackStatus(
	output: string,
	expectedApiPort: number,
	expectedDbPort: number,
): StackStatus {
	let parsed: unknown;
	try {
		parsed = JSON.parse(output);
	} catch {
		throw new Error("Supabase status is not valid JSON");
	}
	if (!parsed || typeof parsed !== "object")
		throw new Error("Supabase status is not an object");
	const status = parsed as Record<string, unknown>;
	for (const key of [
		"API_URL",
		"ANON_KEY",
		"SERVICE_ROLE_KEY",
		"DB_URL",
	] as const)
		if (typeof status[key] !== "string" || !status[key])
			throw new Error(`Supabase status omitted ${key}`);
	const apiUrl = parseStatusUrl(status["API_URL"] as string, "API_URL");
	if (!isExactApiEndpoint(apiUrl, expectedApiPort))
		throw new Error(
			"Supabase API URL does not match the reserved loopback endpoint",
		);
	const expectedDbUrl = `postgresql://postgres:postgres@127.0.0.1:${expectedDbPort}/postgres`;
	if (status["DB_URL"] !== expectedDbUrl)
		throw new Error("Supabase DB_URL is not the exact reserved Postgres endpoint");
	return status as unknown as StackStatus;
}

const TS7_VERSION_PATTERN =
	/^Version 7\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|(?:[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))(?:\.(?:(?:0|[1-9]\d*)|(?:[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function assertTs7Version(output: string): void {
	if (!TS7_VERSION_PATTERN.test(output.trim()))
		throw new Error("TypeScript 7.x is required");
}
