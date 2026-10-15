import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { ElectoralContextBar } from "./ElectoralContextBar";

const state = vi.hoisted(() => ({
  query: "electionId=explicit-page-election&categoryId=explicit-category&sourceKind=fiscalizacion",
  push: vi.fn(), replace: vi.fn(), refresh: vi.fn(),
  effects: [] as Array<() => void>,
  load: vi.fn(),
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useEffect: (effect: () => void) => { state.effects.push(effect); },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/fiscalizacion",
  useSearchParams: () => new URLSearchParams(state.query),
  useRouter: () => ({ push: state.push, replace: state.replace, refresh: state.refresh }),
}));
vi.mock("./WorkspacePresentation", () => ({ useWorkspaceSnapshot: () => null }));
vi.mock("./context-actions", () => ({ loadContextOptions: state.load }));

beforeEach(() => {
  vi.clearAllMocks();
  state.effects.length = 0;
});

it("gives the bar a region and distinct accessible names alongside page-local labels", () => {
  const markup = renderToStaticMarkup(<ElectoralContextBar />);
  expect(markup).toContain('<section aria-label="Contexto electoral"');
  for (const label of ["Elección", "Categoría", "Distrito", "Sección", "Fuente"]) {
    expect(markup).toContain(`aria-label="Contexto electoral: ${label}"`);
    expect(markup).not.toContain(`aria-label="${label}"`);
  }
});

it.each([null, {
  context: { electionId: "server-default", sourceKind: "official" },
  facets: { elections: [], categories: [], distritos: [], secciones: [] },
}])("never navigates on render or facet resolution, preserving explicit page selection (%j)", async result => {
  state.load.mockResolvedValue(result);
  const markup = renderToStaticMarkup(<ElectoralContextBar />);
  expect(markup).toContain('data-source="fiscalizacion"');
  for (const effect of state.effects) effect();
  await Promise.resolve();
  expect(state.load).toHaveBeenCalledWith(state.query);
  expect(state.push).not.toHaveBeenCalled();
  expect(state.replace).not.toHaveBeenCalled();
  expect(state.refresh).not.toHaveBeenCalled();
});
