import path from "node:path";

import {
	EXPECTED_E2E_SPECS,
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
	SQL: "sql",
	BROWSER: "browser",
	FOCUSED: "focused",
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
	selectedSpecs: readonly string[];
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
	startApplicationServices(): Promise<void>;
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
	listOwnedNetworks(projectId: string): readonly string[];
	removeNetworks(names: readonly string[]): Promise<void>;
	removeWorkdir(workdir: string): Promise<void>;
	workdirExists(workdir: string): boolean;
}

const PBA_113_MIGRATION_VERSION = "20260824193650";
const WORKSPACE_FOUNDATION_MIGRATION_VERSION = "20260825144358";
const WORKSPACE_AUTHORITY_FACTS_MIGRATION_VERSION = "20260825165116";
const WORKSPACE_ADMIN_MIGRATION_VERSION = "20260825180048";
const WORKSPACE_CONTEXT_MIGRATION_VERSION = "20260826033130";
const WORKSPACE_SELECTION_MIGRATION_VERSION = "20260826050000";
const STRUCTURED_REVIEW_SCOPE_MIGRATION_VERSION = "20260826120000";
const AUTHORIZED_OFFICIAL_FACETS_MIGRATION_VERSION = "20260826160000";
const AUTHORIZED_OFFICIAL_OPERATIONS_MIGRATION_VERSION = "20260826200000";
const AUTHORIZED_OFFICIAL_PROJECTIONS_MIGRATION_VERSION = "20260827000000";
const AUTHORIZED_FISCAL_REVIEW_MIGRATION_VERSION = "20260827040000";
const AUTHORIZED_FISCAL_COVERAGE_MIGRATION_VERSION = "20260827112658";
const AUTHORIZED_FISCAL_RESULT_MIGRATION_VERSION = "20260827130000";
const PLATFORM_REVIEW_OPERATOR_MIGRATION_VERSION = "20260827160000";
const AUTHORIZED_FISCALIZACION_FACETS_MIGRATION_VERSION = "20260827170000";
const AUTHORIZED_OFFICIAL_DRILLDOWN_FACETS_MIGRATION_VERSION = "20260827200000";
const AUTHORIZED_SCHOOL_PARTY_LOOKUP_MIGRATION_VERSION = "20260827220000";
const LEGACY_RESULTS_CUTOVER_MIGRATION_VERSION = "20260829032228";
const BOUND_AUTHORIZED_RESULT_EVIDENCE_MIGRATION_VERSION = "20260829232200";
const REVIEW_ITEM_CONTEXT_FOUNDATION_MIGRATION_VERSION = "20260830180653";
const REVIEW_CONTEXT_CLASSIFICATION_MIGRATION_VERSION = "20260830203643";
const RECORD_REVIEW_ITEM_V2_MIGRATION_VERSION = "20260831032044";
const RECORD_REVIEW_ITEM_CONTEXTS_MIGRATION_VERSION = "20260831055357";
const YEAR_LEVEL_REVIEW_CONTEXTS_MIGRATION_VERSION = "20260831150450";
const PLATFORM_REVIEW_BREAKDOWN_MIGRATION_VERSION = "20260831160422";
const OFFICIAL_CATEGORY_NAME_MIGRATION_VERSION = "20260904035355";
const CANONICAL_AUTHORIZED_OFFICIAL_FACET_METADATA_MIGRATION_VERSION =
	"20260910212254";
const MUNICIPAL_2023_PARTY_MAP_MIGRATION_VERSION = "20260923000000";
const MIGRATION_VERSIONS = [
	...Array.from({ length: 38 }, (_, index) =>
		String(index + 1).padStart(4, "0"),
	),
	PBA_113_MIGRATION_VERSION,
	WORKSPACE_FOUNDATION_MIGRATION_VERSION,
	WORKSPACE_AUTHORITY_FACTS_MIGRATION_VERSION,
	WORKSPACE_ADMIN_MIGRATION_VERSION,
	WORKSPACE_CONTEXT_MIGRATION_VERSION,
	WORKSPACE_SELECTION_MIGRATION_VERSION,
	STRUCTURED_REVIEW_SCOPE_MIGRATION_VERSION,
	AUTHORIZED_OFFICIAL_FACETS_MIGRATION_VERSION,
	AUTHORIZED_OFFICIAL_OPERATIONS_MIGRATION_VERSION,
	AUTHORIZED_OFFICIAL_PROJECTIONS_MIGRATION_VERSION,
	AUTHORIZED_FISCAL_REVIEW_MIGRATION_VERSION,
	AUTHORIZED_FISCAL_COVERAGE_MIGRATION_VERSION,
	AUTHORIZED_FISCAL_RESULT_MIGRATION_VERSION,
	PLATFORM_REVIEW_OPERATOR_MIGRATION_VERSION,
	AUTHORIZED_FISCALIZACION_FACETS_MIGRATION_VERSION,
	AUTHORIZED_OFFICIAL_DRILLDOWN_FACETS_MIGRATION_VERSION,
	AUTHORIZED_SCHOOL_PARTY_LOOKUP_MIGRATION_VERSION,
	LEGACY_RESULTS_CUTOVER_MIGRATION_VERSION,
	BOUND_AUTHORIZED_RESULT_EVIDENCE_MIGRATION_VERSION,
	REVIEW_ITEM_CONTEXT_FOUNDATION_MIGRATION_VERSION,
	REVIEW_CONTEXT_CLASSIFICATION_MIGRATION_VERSION,
	RECORD_REVIEW_ITEM_V2_MIGRATION_VERSION,
	RECORD_REVIEW_ITEM_CONTEXTS_MIGRATION_VERSION,
	YEAR_LEVEL_REVIEW_CONTEXTS_MIGRATION_VERSION,
	PLATFORM_REVIEW_BREAKDOWN_MIGRATION_VERSION,
	OFFICIAL_CATEGORY_NAME_MIGRATION_VERSION,
	CANONICAL_AUTHORIZED_OFFICIAL_FACET_METADATA_MIGRATION_VERSION,
	MUNICIPAL_2023_PARTY_MAP_MIGRATION_VERSION,
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
	{
		path: "tests/workspace_review_scope.sql",
		label: "disposable workspace-review-scope pgTAP",
		timeoutMs: 120_000,
	},
	{
		path: "tests/workspace_authorized_facets.sql",
		label: "disposable workspace-authorized-facets pgTAP",
		timeoutMs: 120_000,
	},
	{
		path: "tests/workspace_authorized_operations.sql",
		label: "disposable workspace-authorized-operations pgTAP",
		timeoutMs: 120_000,
	},
	{
		path: "tests/workspace_authorized_projections.sql",
		label: "disposable workspace-authorized-projections pgTAP",
		timeoutMs: 120_000,
	},
	{
		path: "tests/workspace_authorized_fiscal_review.sql",
		label: "disposable workspace-authorized-review pgTAP",
		timeoutMs: 120_000,
	},
	{
		path: "tests/workspace_authorized_fiscal_coverage.sql",
		label: "disposable workspace-authorized-coverage pgTAP",
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
	if (argv.some((arg) => arg === "--lane" || arg.startsWith("--lane="))) {
		const laneArgs = argv.filter((arg) => arg !== "--inspect-plan");
		if (
			laneArgs.length !== 2 || laneArgs[0] !== "--lane" ||
			(laneArgs[1] !== RELEASE_GATE_MODE.SQL && laneArgs[1] !== RELEASE_GATE_MODE.BROWSER)
		)
			throw new Error("lane requires exactly one sql|browser value and cannot combine with focused or reduced modes");
		return laneArgs[1];
	}
	const focused = argv.includes("--focused");
	const releaseProofOnly = argv.includes("--release-proof-only");
	const scaleProofOnly = argv.includes("--scale-proof-only");
	const rollbackProofsOnly = argv.includes("--rollback-proofs-only");
	if (
		[releaseProofOnly, scaleProofOnly, rollbackProofsOnly].filter(Boolean)
			.length > 1
	)
		throw new Error("reduced proof modes cannot be combined");
	if (focused && (releaseProofOnly || scaleProofOnly || rollbackProofsOnly))
		throw new Error("focused mode cannot be combined with reduced proof modes");
	if (focused) return RELEASE_GATE_MODE.FOCUSED;
	if (rollbackProofsOnly) return RELEASE_GATE_MODE.ROLLBACK_PROOFS_ONLY;
	if (scaleProofOnly) return RELEASE_GATE_MODE.SCALE_PROOF_ONLY;
	if (releaseProofOnly) return RELEASE_GATE_MODE.RELEASE_PROOF_ONLY;
	return RELEASE_GATE_MODE.FULL;
}

const FOCUSED_E2E_SPEC_PATTERN = /^e2e\/[a-z][a-z0-9-]*\.spec\.ts$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

export function parseFocusedE2eSelection(
	selection: readonly string[],
): readonly string[] {
	if (selection.length === 0)
		throw new Error("focused E2E selection requires one or more canonical spec paths");
	const seen = new Set<string>();
	for (const spec of selection) {
		if (!spec || CONTROL_CHARACTER_PATTERN.test(spec))
			throw new Error("focused E2E selection contains an invalid path");
		if (spec.startsWith("-") || path.isAbsolute(spec) || spec.split("/").includes(".."))
			throw new Error("focused E2E selection contains an unsafe path");
		if (!FOCUSED_E2E_SPEC_PATTERN.test(spec))
			throw new Error("focused E2E selection requires e2e/<name>.spec.ts paths");
		if (!EXPECTED_E2E_SPECS.includes(spec as (typeof EXPECTED_E2E_SPECS)[number]))
			throw new Error(`focused E2E selection contains a noncanonical spec: ${spec}`);
		if (seen.has(spec))
			throw new Error(
				`focused E2E selection: duplicate focused E2E spec: ${spec}`,
			);
		seen.add(spec);
	}
	return [...selection];
}

function parseFocusedE2eCliSelection(argv: readonly string[]): readonly string[] {
	if (argv[0] !== "--focused")
		throw new Error("focused E2E arguments must begin with --focused");
	const selection = argv.slice(1);
	return parseFocusedE2eSelection(
		selection[0] === "--" ? selection.slice(1) : selection,
	);
}

export function playwrightCommandArgs(
	selectedSpecs: readonly string[],
): readonly string[] {
	return ["exec", "playwright", "test", ...selectedSpecs];
}

export function createReleaseGatePlan(
	mode: ReleaseGateMode,
	selectedSpecs: readonly string[] = EXPECTED_E2E_SPECS,
): ReleaseGatePlan {
	const resolvedSelectedSpecs =
		mode === RELEASE_GATE_MODE.FOCUSED
			? parseFocusedE2eSelection(selectedSpecs)
			: mode === RELEASE_GATE_MODE.SQL ? [] : [...EXPECTED_E2E_SPECS];
	const omitPgTap = mode === RELEASE_GATE_MODE.ROLLBACK_PROOFS_ONLY || mode === RELEASE_GATE_MODE.BROWSER;
	const scaleProofOnly = mode === RELEASE_GATE_MODE.SCALE_PROOF_ONLY;
	return {
		mode,
		selectedSpecs: resolvedSelectedSpecs,
		migrationVersions: [...MIGRATION_VERSIONS],
		syntheticMigration: { ...SYNTHETIC_MIGRATION },
		setupProofs: omitPgTap
			? []
			: SETUP_PROOFS.filter(
					(proof) =>
						!scaleProofOnly ||
						proof.beforePgTapPath === "tests/results_exploration_scale.sql",
				).map((proof) => ({ ...proof })),
		pgTapProofs: omitPgTap
			? []
			: PG_TAP_PROOFS.filter(
					(proof) =>
						!scaleProofOnly ||
						proof.path === "tests/results_exploration_scale.sql" ||
						proof.path === "tests/results_exploration_scale_plans.sql",
				).map((proof) => ({ ...proof })),
		postPgTapCleanupProofs: omitPgTap
			? []
			: POST_PG_TAP_CLEANUP_PROOFS.map((proof) => ({ ...proof })),
		rollbackReapplyProofs: scaleProofOnly
			? []
			: ROLLBACK_REAPPLY_PROOFS.map((proof) => ({ ...proof })),
		requireBrowserCapability:
			mode === RELEASE_GATE_MODE.BROWSER ||
			mode === RELEASE_GATE_MODE.FULL ||
			mode === RELEASE_GATE_MODE.FOCUSED ||
			mode === RELEASE_GATE_MODE.RELEASE_PROOF_ONLY,
		runBrowser:
			mode === RELEASE_GATE_MODE.BROWSER ||
			mode === RELEASE_GATE_MODE.FULL || mode === RELEASE_GATE_MODE.FOCUSED,
	};
}

export async function runProductionReleasePhases(
	plan: ReleaseGatePlan,
	effects: ReleaseGateProductionPhaseEffects,
): Promise<StackStatus> {
	await effects.runProductionMigrations();
	await effects.startApplicationServices();
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
	if (plan.mode !== RELEASE_GATE_MODE.SCALE_PROOF_ONLY && plan.mode !== RELEASE_GATE_MODE.SQL)
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
	const mode = releaseGateMode(argv);
	const selectedSpecs =
		mode === RELEASE_GATE_MODE.FOCUSED
			? parseFocusedE2eCliSelection(argv)
			: EXPECTED_E2E_SPECS;
	const plan = createReleaseGatePlan(mode, selectedSpecs);
	if (argv.includes("--inspect-plan")) {
		dependencies.writeOutput(`${JSON.stringify(plan, null, 2)}\n`);
		return;
	}
	if (mode === RELEASE_GATE_MODE.FOCUSED) {
		const excluded = EXPECTED_E2E_SPECS.filter(
			(spec) => !plan.selectedSpecs.includes(spec),
		);
		dependencies.writeOutput(
			`E2E selection: mode=focused selected=${plan.selectedSpecs.length} [${plan.selectedSpecs.join(", ")}] excluded=${excluded.length} [${excluded.join(", ")}]\n`,
		);
	}
	await dependencies.execute(plan);
}

export const CLEANUP_CATEGORY = {
	SERVER_STOP: "SERVER_STOP",
	SERVER_VERIFICATION: "SERVER_VERIFICATION",
	RESERVATION_RELEASE: "RESERVATION_RELEASE",
	OWNERSHIP_MARKER: "OWNERSHIP_MARKER",
	STACK_STOP: "STACK_STOP",
	OWNED_CONTAINER_CLEANUP: "OWNED_CONTAINER_CLEANUP",
	OWNED_VOLUME_CLEANUP: "OWNED_VOLUME_CLEANUP",
	OWNED_NETWORK_CLEANUP: "OWNED_NETWORK_CLEANUP",
	WORKDIR_REMOVE: "WORKDIR_REMOVE",
	CONTAINER_RESIDUAL_CHECK: "CONTAINER_RESIDUAL_CHECK",
	VOLUME_RESIDUAL_CHECK: "VOLUME_RESIDUAL_CHECK",
	NETWORK_RESIDUAL_CHECK: "NETWORK_RESIDUAL_CHECK",
	WORKDIR_RESIDUAL_CHECK: "WORKDIR_RESIDUAL_CHECK",
} as const;

export type CleanupCategory =
	(typeof CLEANUP_CATEGORY)[keyof typeof CLEANUP_CATEGORY];

export interface CleanupDiagnosticFailure {
	readonly category: CleanupCategory;
	readonly failureCount: number;
}

export interface CleanupDiagnostics {
	readonly schemaVersion: 1;
	readonly failures: readonly CleanupDiagnosticFailure[];
}

interface CleanupFailure {
	category: CleanupCategory;
	error: unknown;
}

const CLEANUP_CATEGORIES = Object.values(CLEANUP_CATEGORY);
const CLEANUP_DIAGNOSTICS_PREFIX = "E2E_RELEASE_GATE_CLEANUP_DIAGNOSTICS ";

function flattenErrors(error: unknown, flattened: unknown[] = []): unknown[] {
	if (error instanceof AggregateError)
		for (const nested of error.errors) flattenErrors(nested, flattened);
	else flattened.push(error);
	return flattened;
}

export class ReleaseGateCleanupError extends AggregateError {
	readonly diagnostics: CleanupDiagnostics;

	constructor(failures: readonly CleanupFailure[], message = "cleanup failed") {
		super(
			failures.flatMap(({ error }) => flattenErrors(error)),
			message,
		);
		this.name = "ReleaseGateCleanupError";
		this.diagnostics = {
			schemaVersion: 1,
			failures: CLEANUP_CATEGORIES.flatMap((category) => {
				const failureCount = failures.reduce(
					(count, failure) =>
						failure.category === category
							? count + flattenErrors(failure.error).length
							: count,
					0,
				);
				return failureCount === 0 ? [] : [{ category, failureCount }];
			}),
		};
	}
}

function findCleanupError(error: unknown): ReleaseGateCleanupError | undefined {
	if (error instanceof ReleaseGateCleanupError) return error;
	if (error instanceof AggregateError)
		for (const nested of error.errors) {
			const cleanupError = findCleanupError(nested);
			if (cleanupError) return cleanupError;
		}
	if (error instanceof Error && "cause" in error)
		return findCleanupError(
			(error as Error & { cause?: unknown }).cause,
		);
	return undefined;
}

export function cleanupDiagnosticsLine(error: unknown): string | undefined {
	const cleanupError = findCleanupError(error);
	return cleanupError
		? `${CLEANUP_DIAGNOSTICS_PREFIX}${JSON.stringify(cleanupError.diagnostics)}`
		: undefined;
}

function collect(errors: unknown[], error: unknown): void {
	if (error instanceof AggregateError) errors.push(...error.errors);
	else errors.push(error);
}

function recordCleanupFailure(
	failures: CleanupFailure[],
	category: CleanupCategory,
	error: unknown,
): void {
	failures.push({ category, error });
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

function removeOwnedNetworks<TServer>(
	projectId: string,
	dependencies: ReleaseGateCleanupDependencies<TServer>,
): Promise<void> {
	const networks = dependencies.listOwnedNetworks(projectId);
	if (networks.some((name) => name !== `supabase_network_${projectId}`))
		throw new Error(
			"refusing to remove a network without the exact owned network name",
		);
	return networks.length > 0
		? dependencies.removeNetworks(networks)
		: Promise.resolve();
}

async function verifyCleanupResiduals<TServer>(
	ownership: GateOwnership,
	dependencies: ReleaseGateCleanupDependencies<TServer>,
	failures: CleanupFailure[],
): Promise<void> {
	for (const [category, listResources] of [
		[CLEANUP_CATEGORY.CONTAINER_RESIDUAL_CHECK, dependencies.listOwnedContainers],
		[CLEANUP_CATEGORY.VOLUME_RESIDUAL_CHECK, dependencies.listOwnedVolumes],
		[CLEANUP_CATEGORY.NETWORK_RESIDUAL_CHECK, dependencies.listOwnedNetworks],
	] as const)
		try {
			if (listResources(ownership.projectId).length > 0)
				recordCleanupFailure(
					failures,
					category,
					new Error("disposable Supabase cleanup left owned Docker state"),
				);
		} catch (error) {
			recordCleanupFailure(failures, category, error);
		}
	try {
		if (dependencies.workdirExists(ownership.workdir))
			recordCleanupFailure(
				failures,
				CLEANUP_CATEGORY.WORKDIR_RESIDUAL_CHECK,
				new Error("disposable workdir still exists"),
			);
	} catch (error) {
		recordCleanupFailure(
			failures,
			CLEANUP_CATEGORY.WORKDIR_RESIDUAL_CHECK,
			error,
		);
	}
}

export async function cleanupReleaseGate<TServer>(
	state: ReleaseGateCleanupState<TServer>,
	dependencies: ReleaseGateCleanupDependencies<TServer>,
): Promise<void> {
	const failures: CleanupFailure[] = [];
	await runOwnedServerCleanup(
		state.servers ?? [],
		async (server) => {
			try {
				await dependencies.stopServer(server);
			} catch (error) {
				recordCleanupFailure(failures, CLEANUP_CATEGORY.SERVER_STOP, error);
			}
		},
		async (server) => {
			try {
				await dependencies.verifyServerStopped(server);
			} catch (error) {
				recordCleanupFailure(
					failures,
					CLEANUP_CATEGORY.SERVER_VERIFICATION,
					error,
				);
			}
		},
	);
	for (const reservation of state.reservations ?? [])
		try {
			await reservation.release();
		} catch (error) {
			recordCleanupFailure(failures, CLEANUP_CATEGORY.RESERVATION_RELEASE, error);
		}
	if (!state.ownership) {
		if (failures.length > 0) throw new ReleaseGateCleanupError(failures);
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
		recordCleanupFailure(failures, CLEANUP_CATEGORY.OWNERSHIP_MARKER, error);
	}
	await runOwnedCleanup(
		actions,
		async (action) => {
			try {
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
				else if (
					action.kind === "remove-owned-networks" &&
					state.stackMutationAttempted
				)
					await removeOwnedNetworks(action.projectId, dependencies);
				else if (action.kind === "remove-workdir")
					await dependencies.removeWorkdir(action.workdir);
			} catch (error) {
				const category =
					action.kind === "stop-stack"
						? CLEANUP_CATEGORY.STACK_STOP
						: action.kind === "remove-owned-containers"
							? CLEANUP_CATEGORY.OWNED_CONTAINER_CLEANUP
							: action.kind === "remove-owned-volumes"
								? CLEANUP_CATEGORY.OWNED_VOLUME_CLEANUP
								: action.kind === "remove-owned-networks"
									? CLEANUP_CATEGORY.OWNED_NETWORK_CLEANUP
									: CLEANUP_CATEGORY.WORKDIR_REMOVE;
				recordCleanupFailure(failures, category, error);
			}
		},
		() => verifyCleanupResiduals(ownership, dependencies, failures),
	);
	if (failures.length > 0) throw new ReleaseGateCleanupError(failures);
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
