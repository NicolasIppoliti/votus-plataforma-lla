import type { SupabaseClient } from "@supabase/supabase-js";

export interface CoverageSelection {
	electionId: string;
	categoryId: string;
	distritoCode: string;
	seccionCode: string;
}

export interface CoverageFigure {
	observedUnits: number;
	denominatorUnits: number;
	isRandomSample: false;
}

export interface CoverageExclusion {
	reason: string;
	rows: number;
	votes: number;
}

const SCHOOL_EXCLUSION_REASON = {
	WITHOUT_CIRCUITO_AND_ESTABLECIMIENTO:
		"official_rows_without_circuito_and_establecimiento_code",
	WITHOUT_CIRCUITO: "official_rows_without_circuito_code",
	WITHOUT_ESTABLECIMIENTO: "official_rows_without_establecimiento_code",
} as const;
type SchoolExclusionReason =
	(typeof SCHOOL_EXCLUSION_REASON)[keyof typeof SCHOOL_EXCLUSION_REASON];
const SCHOOL_EXCLUSION_REASONS = new Set<string>(
	Object.values(SCHOOL_EXCLUSION_REASON),
);

export interface CoverageAudit {
	kind: string;
	rows: number;
	votes: number;
	mesas: number;
}

export interface CoverageMesa {
	code: number;
	circuitoCode: string | null;
	establecimientoCode: string | null;
	establecimientoName: string | null;
	covered: boolean;
	officialResultHref: string | null;
}

export interface CoverageSchool extends CoverageFigure {
	circuitoCode: string;
	code: string;
	name: string | null;
	officialArchiveEntryIds: string[];
	officialResultHref: string;
}

interface CoverageSchoolsAvailable {
	status: "available";
	exclusions: CoverageExclusion[];
	items: CoverageSchool[];
}

interface CoverageSchoolsUnavailable {
	status: "source_unavailable";
	reason: string;
	exclusions: CoverageExclusion[];
	items: [];
}

export type CoverageSchools =
	| CoverageSchoolsAvailable
	| CoverageSchoolsUnavailable;

export interface CoverageProvenance {
	officialArchiveEntryIds: string[];
	fiscalizacionArchiveEntryIds: string[];
}

export interface CoverageOk {
	status: "ok";
	sourceKind: "fiscalizacion";
	isRandomSample: false;
	electionYear: number;
	electionRound: string;
	distritoCode: string;
	seccionCode: string;
	mesasCoverage: CoverageFigure;
	mesas: CoverageMesa[];
	escuelas: CoverageSchools;
	sourceAudit: CoverageAudit[];
	denominatorAudit: CoverageAudit[];
	exclusions: CoverageExclusion[];
	provenance: CoverageProvenance;
}

export const COVERAGE_REFUSAL_STATUS = {
	DENOMINATOR_UNAVAILABLE: "denominator_unavailable",
	SELECTION_INVALID: "selection_invalid",
	SOURCE_INCONSISTENT: "source_inconsistent",
} as const;
interface CoverageRefusalBase {
	reason: string;
	counts: Record<string, number>;
}
export interface CoverageEvidenceRefusal extends CoverageRefusalBase {
	status:
		| typeof COVERAGE_REFUSAL_STATUS.DENOMINATOR_UNAVAILABLE
		| typeof COVERAGE_REFUSAL_STATUS.SOURCE_INCONSISTENT;
	exclusions: CoverageExclusion[];
}
export interface CoverageSelectionRefusal extends CoverageRefusalBase {
	status: typeof COVERAGE_REFUSAL_STATUS.SELECTION_INVALID;
	exclusions?: CoverageExclusion[];
}
export type CoverageRefusal =
	| CoverageEvidenceRefusal
	| CoverageSelectionRefusal;
export type CoverageResult = CoverageOk | CoverageRefusal;

interface RpcResponse {
	data: unknown;
	error: { message: string } | null;
}

export interface CoverageRpcClient {
	rpc(name: string, args: Record<string, unknown>): Promise<RpcResponse>;
}

export class CoverageContractError extends Error {
	constructor(detail: string) {
		super(`results_exploration_coverage_contract: ${detail}`);
		this.name = "CoverageContractError";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, key: string): string {
	const field = value[key];
	if (typeof field !== "string" || field.length === 0)
		throw new Error(`invalid ${key}`);
	return field;
}

function nullableString(
	value: Record<string, unknown>,
	key: string,
): string | null {
	const field = value[key];
	if (field !== null && typeof field !== "string")
		throw new Error(`invalid ${key}`);
	return field;
}

function integer(value: Record<string, unknown>, key: string): number {
	const field = value[key];
	if (typeof field !== "number" || !Number.isSafeInteger(field) || field < 0) {
		throw new Error(`invalid ${key}`);
	}
	return field;
}

function counts(value: unknown): Record<string, number> {
	if (!isRecord(value)) throw new Error("invalid counts");
	return Object.fromEntries(
		Object.entries(value).map(([key, count]) => {
			if (
				typeof count !== "number" ||
				!Number.isSafeInteger(count) ||
				count < 0
			) {
				throw new Error("invalid counts");
			}
			return [
				key.replace(/_([a-z])/g, (_match, letter: string) =>
					letter.toUpperCase(),
				),
				count,
			];
		}),
	);
}

function figure(value: unknown): CoverageFigure {
	if (!isRecord(value) || value["is_random_sample"] !== false)
		throw new Error("invalid coverage");
	const observedUnits = integer(value, "observed_units");
	const denominatorUnits = integer(value, "denominator_units");
	if (denominatorUnits === 0 || observedUnits > denominatorUnits)
		throw new Error("invalid coverage");
	return { observedUnits, denominatorUnits, isRandomSample: false };
}

function exclusions(value: unknown): CoverageExclusion[] {
	if (!Array.isArray(value)) throw new Error("invalid exclusions");
	return value.map((entry) => {
		if (!isRecord(entry)) throw new Error("invalid exclusion");
		return {
			reason: stringField(entry, "reason"),
			rows: integer(entry, "rows"),
			votes: integer(entry, "votes"),
		};
	});
}

function schoolExclusions(value: unknown): CoverageExclusion[] {
	const parsed = exclusions(value);
	const seen = new Set<string>();
	let previousReason: string | null = null;
	for (const entry of parsed) {
		if (
			!SCHOOL_EXCLUSION_REASONS.has(entry.reason) ||
			entry.rows === 0 ||
			seen.has(entry.reason) ||
			(previousReason !== null && entry.reason <= previousReason)
		) {
			throw new Error("invalid school exclusions");
		}
		seen.add(entry.reason);
		previousReason = entry.reason;
	}
	return parsed;
}

function schoolExclusionReason(
	mesa: CoverageMesa,
): SchoolExclusionReason | null {
	if (mesa.circuitoCode && mesa.establecimientoCode) return null;
	if (!mesa.circuitoCode && !mesa.establecimientoCode) {
		return SCHOOL_EXCLUSION_REASON.WITHOUT_CIRCUITO_AND_ESTABLECIMIENTO;
	}
	if (!mesa.circuitoCode) return SCHOOL_EXCLUSION_REASON.WITHOUT_CIRCUITO;
	return SCHOOL_EXCLUSION_REASON.WITHOUT_ESTABLECIMIENTO;
}

function validateSchoolExclusionEvidence(
	mesas: CoverageMesa[],
	evidence: CoverageExclusion[],
	requireAllMesasExcluded: boolean,
): void {
	const excludedMesasByReason = new Map<SchoolExclusionReason, number>();
	for (const mesa of mesas) {
		const reason = schoolExclusionReason(mesa);
		if (reason === null) {
			if (requireAllMesasExcluded)
				throw new Error("invalid unavailable schools");
			continue;
		}
		excludedMesasByReason.set(
			reason,
			(excludedMesasByReason.get(reason) ?? 0) + 1,
		);
	}
	if (evidence.length !== excludedMesasByReason.size) {
		throw new Error("school exclusion evidence mismatch");
	}
	for (const entry of evidence) {
		const excludedMesas = excludedMesasByReason.get(
			entry.reason as SchoolExclusionReason,
		);
		if (excludedMesas === undefined || entry.rows < excludedMesas) {
			throw new Error("school exclusion evidence mismatch");
		}
	}
}

function audit(
	value: unknown,
	expectedKind: "official" | "fiscalizacion",
): CoverageAudit[] {
	if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
		throw new Error("invalid source audit");
	}
	const entry = value[0];
	if (entry["kind"] !== expectedKind) throw new Error("invalid source audit");
	return [
		{
			kind: expectedKind,
			rows: integer(entry, "rows"),
			votes: integer(entry, "votes"),
			mesas: integer(entry, "mesas"),
		},
	];
}

function archiveIds(value: unknown): string[] {
	if (
		!Array.isArray(value) ||
		!value.every((entry) => typeof entry === "string" && entry.length > 0)
	) {
		throw new Error("invalid provenance");
	}
	if (new Set(value).size !== value.length)
		throw new Error("invalid provenance");
	return value;
}

function resultHref(
	selection: CoverageSelection,
	mesa: Omit<CoverageMesa, "officialResultHref">,
): string | null {
	if (!mesa.circuitoCode || !mesa.establecimientoCode) return null;
	const params = new URLSearchParams({
		electionId: selection.electionId,
		categoryId: selection.categoryId,
		distritoCode: selection.distritoCode,
		seccionCode: selection.seccionCode,
		circuitoCode: mesa.circuitoCode,
		establecimientoCode: mesa.establecimientoCode,
		mesaCode: String(mesa.code),
		level: "mesa",
	});
	return `/drilldown?${params.toString()}`;
}

function schoolResultHref(
	selection: CoverageSelection,
	circuitoCode: string,
	code: string,
): string {
	const params = new URLSearchParams({
		electionId: selection.electionId,
		categoryId: selection.categoryId,
		distritoCode: selection.distritoCode,
		seccionCode: selection.seccionCode,
		circuitoCode,
		establecimientoCode: code,
		level: "establecimiento",
	});
	return `/drilldown?${params.toString()}`;
}

function parseSuccess(
	value: Record<string, unknown>,
	selection: CoverageSelection,
): CoverageOk {
	if (
		value["source_kind"] !== "fiscalizacion" ||
		value["is_random_sample"] !== false
	) {
		throw new Error("invalid envelope");
	}
	const distritoCode = stringField(value, "distrito_code");
	const seccionCode = stringField(value, "seccion_code");
	if (
		distritoCode !== selection.distritoCode ||
		seccionCode !== selection.seccionCode
	) {
		throw new Error("scope mismatch");
	}
	const mesasCoverage = figure(value["mesas_coverage"]);
	if (!Array.isArray(value["mesas"])) throw new Error("invalid mesas");
	const mesas = value["mesas"].map((raw): CoverageMesa => {
		if (!isRecord(raw) || typeof raw["covered"] !== "boolean")
			throw new Error("invalid mesa");
		const identity = {
			code: integer(raw, "code"),
			circuitoCode: nullableString(raw, "circuito_code"),
			establecimientoCode: nullableString(raw, "establecimiento_code"),
			establecimientoName: nullableString(raw, "establecimiento_name"),
			covered: raw["covered"],
		};
		return { ...identity, officialResultHref: resultHref(selection, identity) };
	});
	const completeMesaIdentities = new Set<string>();
	for (const mesa of mesas) {
		if (!mesa.circuitoCode || !mesa.establecimientoCode) continue;
		const identity = JSON.stringify([
			mesa.circuitoCode,
			mesa.establecimientoCode,
			mesa.code,
		]);
		if (completeMesaIdentities.has(identity))
			throw new Error("duplicate mesa identity");
		completeMesaIdentities.add(identity);
	}
	if (
		mesas.length !== mesasCoverage.denominatorUnits ||
		mesas.filter((mesa) => mesa.covered).length !== mesasCoverage.observedUnits
	) {
		throw new Error("mesa coverage mismatch");
	}
	const schoolEnvelope = value["escuelas"];
	if (!isRecord(schoolEnvelope)) {
		throw new Error("invalid escuelas");
	}
	const schoolItems = schoolEnvelope["items"];
	if (!Array.isArray(schoolItems)) throw new Error("invalid escuelas");
	const parsedSchoolExclusions = schoolExclusions(schoolEnvelope["exclusions"]);
	let escuelas: CoverageSchools;
	if (schoolEnvelope["status"] === "source_unavailable") {
		if (schoolItems.length !== 0 || parsedSchoolExclusions.length === 0) {
			throw new Error("invalid escuelas");
		}
		validateSchoolExclusionEvidence(mesas, parsedSchoolExclusions, true);
		escuelas = {
			status: "source_unavailable",
			reason: stringField(schoolEnvelope, "reason"),
			exclusions: parsedSchoolExclusions,
			items: [],
		};
	} else if (schoolEnvelope["status"] === "available") {
		const items = schoolItems.map((raw): CoverageSchool => {
			if (!isRecord(raw)) throw new Error("invalid school");
			const circuitoCode = stringField(raw, "circuito_code");
			const code = stringField(raw, "code");
			return {
				circuitoCode,
				code,
				name: nullableString(raw, "name"),
				...figure(raw),
				officialArchiveEntryIds: archiveIds(raw["official_archive_entry_ids"]),
				officialResultHref: schoolResultHref(selection, circuitoCode, code),
			};
		});
		const identities = new Set<string>();
		for (const school of items) {
			const identity = JSON.stringify([school.circuitoCode, school.code]);
			if (identities.has(identity))
				throw new Error("duplicate school identity");
			identities.add(identity);
			const schoolMesas = mesas.filter(
				(mesa) =>
					mesa.circuitoCode === school.circuitoCode &&
					mesa.establecimientoCode === school.code,
			);
			if (
				schoolMesas.length !== school.denominatorUnits ||
				schoolMesas.filter((mesa) => mesa.covered).length !==
					school.observedUnits
			) {
				throw new Error("school coverage mismatch");
			}
		}
		const incompleteReasons = new Map<string, number>();
		for (const mesa of mesas) {
			if (mesa.circuitoCode && mesa.establecimientoCode) {
				if (
					!identities.has(
						JSON.stringify([mesa.circuitoCode, mesa.establecimientoCode]),
					)
				) {
					throw new Error(
						"mesa school identity missing from available schools",
					);
				}
				continue;
			}
			const reason =
				!mesa.circuitoCode && !mesa.establecimientoCode
					? "official_rows_without_circuito_and_establecimiento_code"
					: !mesa.circuitoCode
						? "official_rows_without_circuito_code"
						: "official_rows_without_establecimiento_code";
			incompleteReasons.set(reason, (incompleteReasons.get(reason) ?? 0) + 1);
		}
		for (const [reason, mesaCount] of incompleteReasons) {
			const evidence = parsedSchoolExclusions.find(
				(entry) => entry.reason === reason,
			);
			if (!evidence || evidence.rows < mesaCount)
				throw new Error("missing school exclusion evidence");
		}
		validateSchoolExclusionEvidence(mesas, parsedSchoolExclusions, false);
		escuelas = {
			status: "available",
			exclusions: parsedSchoolExclusions,
			items,
		};
	} else {
		throw new Error("invalid escuelas");
	}
	const sourceAudit = audit(value["source_audit"], "fiscalizacion");
	const denominatorAudit = audit(value["denominator_audit"], "official");
	if (
		sourceAudit[0]?.mesas !== mesasCoverage.observedUnits ||
		denominatorAudit[0]?.mesas !== mesasCoverage.denominatorUnits ||
		denominatorAudit[0].rows === 0
	)
		throw new Error("audit mismatch");
	if (!isRecord(value["provenance"])) throw new Error("invalid provenance");
	const provenance = {
		officialArchiveEntryIds: archiveIds(
			value["provenance"]["official_archive_entry_ids"],
		),
		fiscalizacionArchiveEntryIds: archiveIds(
			value["provenance"]["fiscalizacion_archive_entry_ids"],
		),
	};
	if (
		provenance.officialArchiveEntryIds.length === 0 ||
		(sourceAudit[0].rows === 0) !==
			(provenance.fiscalizacionArchiveEntryIds.length === 0)
	) {
		throw new Error("provenance mismatch");
	}
	return {
		status: "ok",
		sourceKind: "fiscalizacion",
		isRandomSample: false,
		electionYear: integer(value, "election_year"),
		electionRound: stringField(value, "election_round"),
		distritoCode,
		seccionCode,
		mesasCoverage,
		mesas,
		escuelas,
		sourceAudit,
		denominatorAudit,
		exclusions: exclusions(value["exclusions"]),
		provenance,
	};
}

function parseCoverage(
	value: unknown,
	selection: CoverageSelection,
): CoverageResult {
	try {
		if (!isRecord(value)) throw new Error("invalid envelope");
		const status = value["status"];
		if (
			status === COVERAGE_REFUSAL_STATUS.DENOMINATOR_UNAVAILABLE ||
			status === COVERAGE_REFUSAL_STATUS.SOURCE_INCONSISTENT
		)
			return {
				status,
				reason: stringField(value, "reason"),
				counts: counts(value["counts"]),
				exclusions: exclusions(value["exclusions"]),
			};
		if (status === COVERAGE_REFUSAL_STATUS.SELECTION_INVALID)
			return {
				status,
				reason: stringField(value, "reason"),
				counts: counts(value["counts"]),
				...(value["exclusions"] === undefined
					? {}
					: { exclusions: exclusions(value["exclusions"]) }),
			};
		if (status !== "ok") throw new Error("invalid status");
		return parseSuccess(value, selection);
	} catch {
		throw new CoverageContractError("malformed or inconsistent payload");
	}
}

export class ResultsCoverageRepository {
	constructor(private readonly client: CoverageRpcClient) {}

	async coverage(selection: CoverageSelection): Promise<CoverageResult> {
		const { data, error } = await this.client.rpc(
			"results_exploration_coverage",
			{
				p_election_id: selection.electionId,
				p_category_id: selection.categoryId,
				p_distrito_code: selection.distritoCode,
				p_seccion_code: selection.seccionCode,
			},
		);
		if (error)
			throw new Error(`results_exploration_coverage failed: ${error.message}`);
		return parseCoverage(data, selection);
	}
}

export function createResultsCoverageRepository(
	client: SupabaseClient,
): ResultsCoverageRepository {
	return new ResultsCoverageRepository({
		rpc: async (name, args) => {
			const response = await client.rpc(name, args);
			return { data: response.data, error: response.error };
		},
	});
}
