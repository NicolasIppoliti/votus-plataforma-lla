import { type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { ElectoralContextBar } from "./ElectoralContextBar";

const state = vi.hoisted(() => ({
  query: "electionId=explicit-page-election&categoryId=explicit-category&sourceKind=fiscalizacion",
  push: vi.fn(), replace: vi.fn(), refresh: vi.fn(),
  bar: null as HTMLElement | null,
  effects: [] as Array<() => void | (() => void)>,
  load: vi.fn(),
  loaded: null as unknown,
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useEffect: (effect: () => void) => { state.effects.push(effect); },
  useRef: () => ({ current: state.bar }),
  useState: (initial: unknown) => [state.loaded ?? initial, vi.fn()],
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
  state.bar = null;
  state.loaded = null;
  state.query = "electionId=explicit-page-election&categoryId=explicit-category&sourceKind=fiscalizacion";
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

it("keeps distrito and sección when changing category through the shared bar", () => {
  state.query = "electionId=e2025&categoryId=old&distritoCode=02&seccionCode=027&sourceKind=official";
  state.loaded = { query: state.query, result: { context: { electionId: "e2025", categoryId: "old", distritoCode: "02", seccionCode: "027", sourceKind: "official" }, facets: { elections: [], categories: [], distritos: [], secciones: [] } } };
  function visit(node: ReactNode): ReactElement<{ onChange: (event: { target: { value: string } }) => void }> | undefined {
    if (!node || typeof node !== "object" || !("type" in node)) return;
    const element = node as ReactElement<{ children?: ReactNode; "aria-label"?: string }>;
    if (element.props["aria-label"] === "Contexto electoral: Categoría") return element as ReturnType<typeof visit>;
    if (typeof element.type === "function") return visit((element.type as (props: unknown) => ReactNode)(element.props));
    for (const child of [element.props.children].flat()) {
      const found = visit(child);
      if (found) return found;
    }
  }
  const category = visit(<ElectoralContextBar />);
  expect(category).toBeDefined();
  category!.props.onChange({ target: { value: "new" } });
  const url = new URL(state.push.mock.calls[0]![0], "https://example.test");
  expect(url.searchParams.get("categoryId")).toBe("new");
  expect(url.searchParams.get("distritoCode")).toBe("02");
  expect(url.searchParams.get("seccionCode")).toBe("027");
});

it("measures both sticky rows, updates on resize, and clears offsets on unmount", () => {
  let barHeight = 180;
  const topbar = { getBoundingClientRect: () => ({ height: 64 }) };
  state.bar = {
    getBoundingClientRect: () => ({ height: barHeight }),
    parentElement: { querySelector: () => topbar },
  } as unknown as HTMLElement;
  const style = { setProperty: vi.fn(), removeProperty: vi.fn() };
  const observe = vi.fn(), disconnect = vi.fn();
  let resize = () => {};
  vi.stubGlobal("document", { documentElement: { style } });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  try {
    renderToStaticMarkup(<ElectoralContextBar />);
    const cleanup = state.effects[0]!();
    expect(observe).toHaveBeenCalledWith(state.bar);
    expect(observe).toHaveBeenCalledWith(topbar);
    expect(style.setProperty).toHaveBeenCalledWith("--electoral-context-height", "180px");
    expect(style.setProperty).toHaveBeenCalledWith("--electoral-topbar-height", "64px");
    barHeight = 320;
    resize();
    expect(style.setProperty).toHaveBeenCalledWith("--electoral-context-height", "320px");
    expect(typeof cleanup).toBe("function");
    if (cleanup) cleanup();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(style.removeProperty).toHaveBeenCalledWith("--electoral-context-height");
    expect(style.removeProperty).toHaveBeenCalledWith("--electoral-topbar-height");
  } finally { vi.unstubAllGlobals(); }
});
