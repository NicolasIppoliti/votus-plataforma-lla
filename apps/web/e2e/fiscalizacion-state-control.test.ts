import { afterEach, expect, it, vi } from "vitest";
import { sanitizeFiscalizacionCoverage, sanitizeFiscalizacionResult } from "../src/lib/workspace/fiscalizacion-evidence";
import { createFiscalStateHandler, fiscalWirePair, fiscalWireStates } from "./fiscalizacion-state-control";

const origin = "http://127.0.0.1:54321";
const selection = { electionId: "election", categoryId: "category", distritoCode: "02", seccionCode: "027" };
const body = { p_election_id: "election", p_category_id: "category", p_distrito_code: "02", p_seccion_code: "027", p_opt_in: true };
const request = (path = "fiscalizacion_coverage", value: unknown = body) => new Request(`${origin}/rest/v1/rpc/${path}`, { method: "POST", body: JSON.stringify(value) });
afterEach(() => vi.unstubAllGlobals());

it("intercepts both exact fiscal requests and returns sanitizer-valid bounded wire evidence", async () => {
  const matched = vi.fn();
  const pair = fiscalWirePair(selection);
  const handler = createFiscalStateHandler(origin, selection, (side) => { matched(side); return Response.json(pair[side]); });
  for (const side of ["coverage", "result"] as const) {
    const response = await handler(request(`fiscalizacion_${side}`));
    if (!(response instanceof Response)) throw new Error("expected fiscal response");
    const wire: unknown = await response.json();
    const safe = side === "coverage" ? sanitizeFiscalizacionCoverage(wire) : sanitizeFiscalizacionResult(wire, selection);
    expect(safe).toMatchObject({ status: "ok", truncated: true });
  }
  expect(matched.mock.calls).toEqual([["coverage"], ["result"]]);
});

it.each(fiscalWireStates(selection))("keeps $side $payload.status reachable through the sanitizer", ({ side, payload }) => {
  const safe = side === "coverage" ? sanitizeFiscalizacionCoverage(payload) : sanitizeFiscalizacionResult(payload, selection);
  expect(safe).toMatchObject({ status: payload.status });
});

it("aborts malformed, foreign, wrong-method and non-opted-in requests without matching or forwarding", async () => {
  const forward = vi.fn(); vi.stubGlobal("fetch", forward);
  const matched = vi.fn();
  const handler = createFiscalStateHandler(origin, selection, matched);
  for (const invalid of [
    request("fiscalizacion_coverage", { ...body, p_opt_in: false }),
    request("fiscalizacion_result", { ...body, p_seccion_code: "028" }),
    request("fiscalizacion_result", { ...body, extra: true }), request("fiscalizacion_result", null),
    new Request(`${origin}/rest/v1/rpc/fiscalizacion_result`),
    new Request(`${origin}/rest/v1/rpc/fiscalizacion_result?extra=1`, { method: "POST", body: JSON.stringify(body) }),
    new Request(`${origin}/rest/v1/rpc/fiscalizacion_result`, { method: "POST", body: "{" }),
    new Request("http://127.0.0.1:54322/auth/v1/user"), new Request(`${origin}/rest/v1/rpc/unknown`),
  ]) expect(await handler(invalid)).toBe("abort");
  expect(matched).not.toHaveBeenCalled(); expect(forward).not.toHaveBeenCalled();
});

it("forwards only allowlisted same-origin requests without following redirects", async () => {
  const forward = vi.fn().mockResolvedValue(Response.json({})); vi.stubGlobal("fetch", forward);
  const handler = createFiscalStateHandler(origin, selection, vi.fn());
  const allowed = request("official_facets", {});
  await handler(allowed);
  expect(forward).toHaveBeenCalledWith(allowed, { redirect: "error" });
  for (const invalid of ["https://127.0.0.1:54321", `${origin}/path`, "http://localhost:54321", "http://127.0.0.1"])
    expect(() => createFiscalStateHandler(invalid, selection, vi.fn())).toThrow(/loopback/);
});
