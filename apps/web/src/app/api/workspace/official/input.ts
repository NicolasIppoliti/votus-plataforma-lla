const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODE = {
  distrito: /^\d{2}$/,
  seccion: /^\d{3}$/,
  circuito: /^[0-9A-Z]{1,16}$/,
  establecimiento: /^[0-9A-Z._-]{1,64}$/,
} as const;
export const OFFICIAL_LEVEL = {
  DISTRITO: "distrito", SECCION: "seccion", CIRCUITO: "circuito", ESTABLECIMIENTO: "establecimiento", MESA: "mesa",
} as const;
export type OfficialLevel = (typeof OFFICIAL_LEVEL)[keyof typeof OFFICIAL_LEVEL];
export interface OfficialSelection {
  electionId: string;
  categoryId: string;
  distritoCode: string;
  seccionCode: string | null;
  circuitoCode: string | null;
  establecimientoCode: string | null;
  mesaCode: number | null;
  requestedLevel: OfficialLevel;
}

const KEYS = ["election_id", "category_id", "distrito_code", "seccion_code", "circuito_code", "establecimiento_code", "mesa_code", "requested_level"] as const;

function one(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  if (values.length > 1) throw new Error("invalid request");
  return values[0] ?? null;
}

function parseSelection(params: URLSearchParams, prefix = ""): OfficialSelection {
  const electionId = one(params, `${prefix}election_id`);
  const categoryId = one(params, `${prefix}category_id`);
  const distritoCode = one(params, `${prefix}distrito_code`);
  const seccionCode = one(params, `${prefix}seccion_code`);
  const circuitoCode = one(params, `${prefix}circuito_code`);
  const establecimientoCode = one(params, `${prefix}establecimiento_code`);
  const mesaValue = one(params, `${prefix}mesa_code`);
  const requestedLevel = one(params, `${prefix}requested_level`);
  const levels = Object.values(OFFICIAL_LEVEL) as string[];
  if (!electionId || !CANONICAL_UUID.test(electionId) || !categoryId || !CANONICAL_UUID.test(categoryId) || !distritoCode || !CODE.distrito.test(distritoCode) || !requestedLevel || !levels.includes(requestedLevel)) throw new Error("invalid request");
  if ((seccionCode && !CODE.seccion.test(seccionCode)) || (circuitoCode && !CODE.circuito.test(circuitoCode)) || (establecimientoCode && !CODE.establecimiento.test(establecimientoCode))) throw new Error("invalid request");
  const mesaCode = mesaValue === null ? null : Number(mesaValue);
  if (mesaCode !== null && (!/^\d{1,6}$/.test(mesaValue!) || !Number.isSafeInteger(mesaCode))) throw new Error("invalid request");
  return { electionId, categoryId, distritoCode, seccionCode, circuitoCode, establecimientoCode, mesaCode, requestedLevel: requestedLevel as OfficialLevel };
}

export function parseResultRequest(request: Request): OfficialSelection {
  if (request.url.length > 2_048) throw new Error("invalid request");
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => !KEYS.includes(key as (typeof KEYS)[number]))) throw new Error("invalid request");
  return parseSelection(params);
}

export function parseComparisonRequest(request: Request): readonly [OfficialSelection, OfficialSelection] {
  if (request.url.length > 4_096) throw new Error("invalid request");
  const params = new URL(request.url).searchParams;
  const allowed = new Set(KEYS.flatMap((key) => [`left_${key}`, `right_${key}`]));
  if ([...params.keys()].some((key) => !allowed.has(key))) throw new Error("invalid request");
  return [parseSelection(params, "left_"), parseSelection(params, "right_")];
}
