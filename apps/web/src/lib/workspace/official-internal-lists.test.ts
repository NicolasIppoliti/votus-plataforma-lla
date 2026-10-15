import { beforeEach, expect, it, vi } from "vitest";
import { pasoSectionPayload } from "../../../e2e/paso-internas-fixture";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), claims: vi.fn(), schema: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../supabase/server-client", () => ({ createSupabaseServerClient: async () => ({
  auth: { getClaims: mocks.claims }, schema: mocks.schema,
}) }));
const selection = { electionId: "10000000-0000-4000-8000-000000000001", categoryId: "20000000-0000-4000-8000-000000000001", distritoCode: "02", seccionCode: "027" };
const { loadOfficialInternalLists } = await import("./official-internal-lists");
function payload() {
  const data = pasoSectionPayload();
  return { ...data, lists: data.lists.map((list) => {
    const parent = ({ "132": "JXC", "134": "UXP", "135": "LLA" } as Record<string, string>)[list.list_id.split("-")[0]!];
    return parent ? { ...list, canonical_party_id: parent, display_name: parent, identity_status: "canonical" } : list;
  }) };
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.schema.mockReturnValue({ rpc: mocks.rpc });
  mocks.claims.mockResolvedValue({ data: { claims: { sub: selection.electionId, session_id: selection.categoryId, exp: Math.floor(Date.now() / 1000) + 3600 } }, error: null });
  mocks.rpc.mockResolvedValue({ data: payload(), error: null });
});
it("keeps real non-positive totals separate from positive party shares", async () => {
  const non_positive = { status: "available", totals: { "EN BLANCO": 2121, NULO: 319, IMPUGNADO: 12, RECURRIDO: 4, COMANDO: 12 } };
  mocks.rpc.mockResolvedValue({ data: { ...payload(), non_positive }, error: null });
  const result = await loadOfficialInternalLists(selection);
  expect(result.status).toBe("ok");
  if (result.status !== "ok") throw new Error("expected measured totals");
  expect(result.non_positive).toEqual(non_positive);
  expect(result.positive_total).toBe(33250);
  expect(result.lists.find((l) => l.list_id === "135-3016")?.ofPositive?.denominator).toBe(33250);
});
it.each([
  { "EN BLANCO": 2121, NULO: 319, IMPUGNADO: 12, RECURRIDO: 4 },
  { "EN BLANCO": 2121, NULO: -1, IMPUGNADO: 12, RECURRIDO: 4, COMANDO: 12 },
  { "EN BLANCO": 2121, NULO: 319, IMPUGNADO: 12, RECURRIDO: 4, COMANDO: Number.MAX_SAFE_INTEGER + 1 },
  { "EN BLANCO": 2121, NULO: 319, IMPUGNADO: 12, RECURRIDO: 4, COMANDO: 12, POSITIVO: 33250 },
])("rejects incomplete, unsafe or mixed non-positive totals", async (totals) => {
  mocks.rpc.mockResolvedValue({ data: { ...payload(), non_positive: { status: "available", totals } }, error: null });
  await expect(loadOfficialInternalLists(selection)).resolves.toEqual({ status: "malformed" });
});
it("loads exact section internas through verified workspace RPC", async () => {
  const result = await loadOfficialInternalLists(selection);
  expect(result.status).toBe("ok");
  if (result.status !== "ok") throw new Error("expected success");
  expect(result.positive_total).toBe(33250);
  expect(result.lists.find((l) => l.list_id === "132-3008")).toMatchObject({ votes: 8698, withinParty: { numerator: 8698, denominator: 12695 }, ofPositive: { numerator: 8698, denominator: 33250 }, singleList: false });
  expect(result.lists.find((l) => l.list_id === "135-3016")).toMatchObject({ singleList: true });
  expect(result.lists.find((l) => l.list_id === "131-3004")).toMatchObject({ votes: 0, identity_status: "unmapped", label: "Lista sin mapear", withinParty: null, singleList: null });
  expect(mocks.schema).toHaveBeenCalledWith("workspace_api");
  expect(mocks.rpc).toHaveBeenCalledWith("official_internal_lists", { p_election_id: selection.electionId, p_category_id: selection.categoryId, p_distrito_code: "02", p_seccion_code: "027" });
});
it.each([
  { status: "authorization_denied", authorization_status: "scope_denied", truncated: false },
  { status: "authorization_denied", authorization_status: "scope_required", reason: "an exact section is required for an authorized official operation", truncated: false },
  { status: "source_unavailable", authorization_status: "authorized", truncated: false, counts: { conflicting_result_identity: 1 } },
  { status: "source_unavailable", authorization_status: "authorized", truncated: false, counts: { unsupported_internal_list_source: 5 } },
  { status: "source_unavailable", authorization_status: "authorized", truncated: false, reason: "mixed", counts: { included_mesa_rows: 4, included_seccion_rows: 1 } },
  { status: "source_unavailable", authorization_status: "authorized", truncated: false, reason: "missing section", exclusions: [{ reason: "official_rows_without_section_identity" }], source_exclusions: [] },
  { status: "selection_invalid", authorization_status: "authorized", truncated: false, reason: "unknown category_id", counts: { unknown_category_id: 1 } },
  { status: "no_rows", authorization_status: "authorized", truncated: false, reason: "no official rows exist for the selected scope", counts: { selected_rows: 0, requested_level_seccion: 0 } },
  { status: "payload_too_large", authorization_status: "authorized", truncated: true, total_bytes: 120001 },
])("preserves bounded refusal $status", async (data) => {
  mocks.rpc.mockResolvedValue({ data, error: null });
  await expect(loadOfficialInternalLists(selection)).resolves.toEqual(data);
});
it.each(["extra", "total", "duplicate", "marker", "source", "identity", "unsafe"])("rejects malformed %s without partial totals", async (kind) => {
  const data = payload();
  const bad = kind === "extra" ? { ...data, secret: "unexpected" } : kind === "total" ? { ...data, positive_total: 1 } : kind === "duplicate" ? { ...data, lists: [...data.lists, data.lists[0]] } : kind === "marker" ? { ...data, non_positive: { status: "ok" } } : kind === "source" ? { ...data, source_kind: "fiscalizacion" } : kind === "unsafe" ? { ...data, positive_total: Number.MAX_SAFE_INTEGER + 1 } : { ...data, lists: [{ ...data.lists[0], identity_status: "canonical" }] };
  mocks.rpc.mockResolvedValue({ data: bad, error: null });
  await expect(loadOfficialInternalLists(selection)).resolves.toEqual({ status: "malformed" });
});
it.each(["selection_invalid", "source_unavailable", "no_rows"])("rejects unknown nested counts in %s", async (status) => {
  mocks.rpc.mockResolvedValue({ data: { status, authorization_status: "authorized", truncated: false,
    reason: "unknown", counts: { unexpected: 1 } }, error: null });
  await expect(loadOfficialInternalLists(selection)).resolves.toEqual({ status: "malformed" });
});
it("keeps zero-only canonical lists with undefined rather than fabricated shares", async () => {
  const data = payload();
  mocks.rpc.mockResolvedValue({ data: { ...data, positive_total: 0, lists: data.lists.filter((l) => l.canonical_party_id === "JXC").map((l) => ({ ...l, votes: 0 })) }, error: null });
  const result = await loadOfficialInternalLists(selection);
  expect(result.status).toBe("ok");
  if (result.status === "ok") expect(result.lists.map((l) => [l.votes, l.withinParty, l.ofPositive, l.singleList])).toEqual([[0, null, null, false], [0, null, null, false]]);
});
it("contains transport errors and rejects unknown refusal fields", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "VOT03" } });
  await expect(loadOfficialInternalLists(selection)).resolves.toEqual({ status: "unavailable" });
  mocks.rpc.mockResolvedValueOnce({ data: { status: "authorization_denied", authorization_status: "scope_denied", truncated: false, lists: [] }, error: null });
  await expect(loadOfficialInternalLists(selection)).resolves.toEqual({ status: "malformed" });
});
it("does not call RPC with invalid claims", async () => {
  mocks.claims.mockResolvedValue({ data: null, error: null });
  await expect(loadOfficialInternalLists(selection)).resolves.toEqual({ status: "unavailable" });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
