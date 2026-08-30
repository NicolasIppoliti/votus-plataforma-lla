import { loadSafeFiscalizacionCoverage, normalizeFiscalizacionEvidenceRequest } from "../../../../../lib/workspace/fiscalizacion-evidence";

const PRIVATE_HEADERS = { "cache-control": "private, no-store, max-age=0" };

export async function GET(request: Request): Promise<Response> {
  try {
    const { selection, optIn } = normalizeFiscalizacionEvidenceRequest(request);
    return Response.json(await loadSafeFiscalizacionCoverage(selection, optIn), { headers: PRIVATE_HEADERS });
  } catch (error) {
    const invalid = error instanceof Error && error.message === "invalid request";
    return Response.json({ status: invalid ? "invalid_request" : "unavailable" }, { status: invalid ? 400 : 403, headers: PRIVATE_HEADERS });
  }
}
