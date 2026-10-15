import type { ReactElement } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server-client", () => ({ createSupabaseServerClient: async () => ({
  auth: { getClaims: async () => ({ data: { claims: { sub: "10000000-0000-4000-8000-000000000001", session_id: "10000000-0000-4000-8000-000000000002", exp: 4102444800 } }, error: null }) },
  schema: () => ({ rpc: mocks.rpc }),
}) as unknown as SupabaseClient }));
import ComparePage from "./page";

it.each([
  ["42501", "denied"], ["PGRST301", "denied"], ["57014", "unavailable"],
  ["08006", "unavailable"], ["PGRST000", "unavailable"], ["unknown", "unavailable"],
  ["throw", "unavailable"],
])("renders classified RPC failure %s through the real loader and page", async (code, variant) => {
  mocks.rpc.mockReset();
  if (code === "throw") mocks.rpc.mockRejectedValue(new TypeError("private transport detail"));
  else mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "private RPC detail" } });
  const params = { sourceKind: "official", electionId: "10000000-0000-4000-8000-000000000003", distritoCode: "02" };
  const html = renderToStaticMarkup(await ComparePage({ searchParams: Promise.resolve(params) }) as ReactElement);
  expect(html).toContain(`data-variant="${variant}"`);
  expect(html).toContain(variant === "denied" ? "No tiene autorización" : "temporalmente no disponibles");
  expect(html).toContain('href="/compare?sourceKind=official&amp;electionId=10000000-0000-4000-8000-000000000003&amp;distritoCode=02"');
  expect(html).toContain("Reintentar");
  expect(html).not.toContain("private");
  expect(mocks.rpc).toHaveBeenCalledWith("official_facets", expect.any(Object));
});
