import type { ReviewFetchHandler } from "./review-state-control";

interface FiscalSelection {
  electionId: string;
  categoryId: string;
  distritoCode: string;
  seccionCode: string;
}
const FISCAL_PATHS = { coverage: "/rest/v1/rpc/fiscalizacion_coverage", result: "/rest/v1/rpc/fiscalizacion_result" } as const;
type FiscalSide = keyof typeof FISCAL_PATHS;
const PASSTHROUGH_RPC = new Set([
  "bootstrap_workspace_context", "available_organizations", "current_workspace",
  "switch_workspace_context", "official_facets", "review_items",
]);

export function createFiscalStateHandler(
  origin: string,
  selection: FiscalSelection,
  respond: (side: FiscalSide, request: Request) => ReturnType<ReviewFetchHandler>,
): ReviewFetchHandler {
  const endpoint = new URL(origin);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || !endpoint.port || endpoint.pathname !== "/" || endpoint.search || endpoint.hash || endpoint.username || endpoint.password)
    throw new Error("fiscal state origin must be an exact loopback URL");
  const expected = {
    p_election_id: selection.electionId, p_category_id: selection.categoryId,
    p_distrito_code: selection.distritoCode, p_seccion_code: selection.seccionCode, p_opt_in: true,
  };
  return async (request) => {
    const url = new URL(request.url);
    if (url.origin !== endpoint.origin || url.hash) return "abort";
    const side = url.pathname === FISCAL_PATHS.coverage ? "coverage" : url.pathname === FISCAL_PATHS.result ? "result" : null;
    if (!side) {
      const rpc = url.pathname.replace("/rest/v1/rpc/", "");
      const allowed =
        (request.method === "POST" && PASSTHROUGH_RPC.has(rpc) && !url.search) ||
        (request.method === "GET" && !url.search &&
          ["/auth/v1/user", "/auth/v1/.well-known/jwks.json"].includes(url.pathname)) ||
        (request.method === "POST" && url.pathname === "/auth/v1/token" &&
          url.search === "?grant_type=refresh_token");
      return allowed ? fetch(request, { redirect: "error" }) : "abort";
    }
    if (request.method !== "POST" || url.search) return "abort";
    let body: unknown;
    try { body = await request.clone().json(); } catch { return "abort"; }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 5 ||
        !Object.entries(expected).every(([key, value]) => Object.hasOwn(body, key) && Reflect.get(body, key) === value)) return "abort";
    return respond(side, request);
  };
}

export function fiscalWireStates(selection: FiscalSelection) {
  const pair = fiscalWirePair(selection);
  const empty = { items: [], total: 0, truncated: false };
  return [
    {
      side: "result",
      payload: {
        ...pair.result, status: "no_rows", rows: empty, unmapped: empty,
        exclusions: { items: [{ reason: "source_kind_official", rows: 108 }], total: 1, truncated: false },
        provenance: empty, truncated: false,
      },
      text: "Evidencia sin filas",
    },
    ...(["coverage", "result"] as const).flatMap((side) => [
      { side, payload: { status: "authorization_denied", authorization_status: null }, text: "Estado de evidencia: denied" },
      { side, payload: { ...pair[side], status: "payload_too_large" }, text: "Estado de evidencia: oversized" },
      { side, payload: { status: "source_inconsistent", exclusions: pair[side].exclusions }, text: "Estado de evidencia: invalid" },
    ]),
    ...(["denominator_unavailable", "source_unavailable"] as const).map((status) => ({
      side: "coverage" as const, payload: { ...pair.coverage, status }, text: "Estado de evidencia: unavailable",
    })),
  ] as const;
}

// These wire collections obey the production sanitizer's exact min(total, limit) contract.
export function fiscalWirePair(selection: FiscalSelection) {
  const claims = { status: "ok", authorization_status: "authorized", source_kind: "fiscalizacion", is_random_sample: false };
  const exclusions = { items: [{ reason: "missing_identity", rows: 3 }], total: 1, truncated: false };
  return {
    coverage: {
      ...claims, vote_data: "not_included", observed_units: 7, denominator_units: 108,
      uncovered: {
        items: Array.from({ length: 100 }, (_, i) => ({
          code: i + 8, circuito_code: "00002",
          establecimiento_code: `E${i}`, establecimiento_name: "Sentinel school",
        })),
        total: 101, truncated: true,
      },
      exclusions, truncated: true,
    },
    result: {
      ...claims,
      reference: {
        election_year: 2025, election_round: "legislativas", category_name: "DIPUTADO NACIONAL",
        distrito_code: selection.distritoCode, seccion_code: selection.seccionCode, denominator_units: 108,
      },
      rows: {
        items: Array.from({ length: 100 }, (_, i) => ({
          list_id: `A${i}`, canonical_party_id: "sentinel-party", party_name: "Sentinel Party",
          granularity: "mesa", votes: 876543, rows: 1,
        })),
        total: 101, truncated: true,
      },
      unmapped: { items: [{ list_id: "sentinel-unmapped", votes: 456789, rows: 1 }], total: 1, truncated: false },
      exclusions,
      provenance: {
        items: [{ id: "fiscal/sentinel", sha256: "a".repeat(64), fetched_at: "2026-01-01T00:00:00Z", status: "ok" }],
        total: 1, truncated: false,
      },
      truncated: true,
    },
  };
}
