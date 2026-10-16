import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// #613: Simulación follows the shared electoral context. When that context is
// the election the official base represents (2025 provinciales · CONCEJALES ·
// 02/027), the base loads on its own; any other context never borrows its figures.
const facets = vi.hoisted(() => vi.fn());
vi.mock("@/lib/workspace/official-facets", () => ({ createAuthorizedOfficialFacetRepository: () => ({ facets }) }));
// Same platform boundary as page.test.tsx: render the server page without an app router.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual,
    useState: <T,>(initial: T | (() => T)) => [typeof initial === "function" ? (initial as () => T)() : initial, () => {}],
    useTransition: () => [false, (callback: () => void) => callback()],
    useActionState: (_action: unknown, initial: readonly string[]) => [initial, () => {}, false] };
});

import SimulatePage from "./page";

const PROVINCIALES = "prov-2025", LEGISLATIVAS = "leg-2025", CONCEJALES = "concejales", DIPUTADOS = "diputados";
const option = (code: string) => ({ code, name: null, nameStatus: "missing" as const, nameVariantCount: 0 });
beforeEach(() => {
  facets.mockReset().mockImplementation(async (selection: { electionId?: string }) => ({
    elections: [{ id: PROVINCIALES, year: 2025, round: "provinciales", label: "2025 provinciales" }, { id: LEGISLATIVAS, year: 2025, round: "legislativas", label: "2025 legislativas" }],
    categories: selection.electionId === PROVINCIALES ? [{ id: CONCEJALES, name: "CONCEJALES" }] : selection.electionId === LEGISLATIVAS ? [{ id: DIPUTADOS, name: "DIPUTADO NACIONAL" }] : [],
    distritos: [option("02")], secciones: [option("027")], circuitos: [], establecimientos: [], mesas: [], availableLevels: ["seccion"], exclusions: [],
  }));
});
const render = async (params: Record<string, string>) => renderToStaticMarkup(await SimulatePage({ searchParams: Promise.resolve(params) }) as ReactElement);

it("loads the official base on its own when the default context is 2025 provinciales · CONCEJALES · Coronel Rosales", async () => {
  const html = await render({});
  expect(html).toContain("Base oficial 2025 · JEBA definitivo");
  expect(html).toContain("Resultado (municipal de PBA)");
  expect(html).not.toContain("Territorio no vinculado");
});

it("loads it for the same election chosen explicitly in the context bar", async () => {
  const html = await render({ electionId: PROVINCIALES, categoryId: CONCEJALES, distritoCode: "02", seccionCode: "027", sourceKind: "official" });
  expect(html).toContain("Base oficial 2025 · JEBA definitivo");
});

it("never borrows the base for another election and says which base exists", async () => {
  const html = await render({ electionId: LEGISLATIVAS, categoryId: DIPUTADOS, distritoCode: "02", seccionCode: "027", sourceKind: "official" });
  expect(html).not.toContain("Base oficial 2025 · JEBA definitivo");
  expect(html).toContain("La base oficial disponible es 2025 provinciales · Concejales · Coronel Rosales; la selección actual no tiene base para simular.");
});

it("keeps today's empty editor when the context cannot be verified", async () => {
  facets.mockRejectedValue(new Error("unavailable"));
  const html = await render({});
  expect(html).not.toContain("Base oficial 2025 · JEBA definitivo");
  expect(html).not.toContain("la selección actual no tiene base para simular");
  expect(html).toContain('href="/simulate?officialBase=2025"');
});

it("leaves an explicit scenario untouched", async () => {
  const html = await render({ scenario: "persistencia" });
  expect(html).not.toContain("Base oficial 2025 · JEBA definitivo");
});
