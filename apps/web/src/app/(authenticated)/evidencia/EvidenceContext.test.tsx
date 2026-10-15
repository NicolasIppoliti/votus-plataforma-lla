import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => {
  const state: unknown[] = [];
  let cursor = 0;
  return {
    begin: () => { cursor = 0; },
    reset: () => { state.length = 0; cursor = 0; },
    useState<T>(initial: T) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index] as T, (value: T) => { state[index] = value; }] as const;
    },
  };
});
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: hooks.useState }));
const { EvidenceContext } = await import("./EvidenceContext");
const fields = [
  { name: "electionId", label: "Elección", value: "old", options: [{ value: "old", label: "Elección anterior" }, { value: "new", label: "Elección nueva" }] },
  { name: "categoryId", label: "Categoría", value: "category", options: [{ value: "category", label: "Categoría anterior" }] },
];
function render() {
  hooks.begin();
  return EvidenceContext({ fields, children: <p>Evidencia servida</p> });
}
beforeEach(() => hooks.reset());
afterEach(() => vi.unstubAllGlobals());

it("offers the complete selected value in a keyboard-accessible disclosure", () => {
  const html = renderToStaticMarkup(render());
  expect(html).toContain('<summary>Ver selección completa: Elección</summary>');
  expect(html).toContain('<p>Elección anterior</p>');
});

it("clears descendants and their full-value text together before native GET submission", () => {
  class Select { constructor(public name: string, public value: string) {} }
  vi.stubGlobal("HTMLSelectElement", Select);
  const election = new Select("electionId", "new"), category = new Select("categoryId", "category");
  const requestSubmit = vi.fn();
  const form = { elements: { namedItem: (name: string) => name === "electionId" ? election : category }, requestSubmit };
  const tree = render();
  const formNode = (tree.props as { children: ReactElement[] }).children[0] as ReactElement<{ onChange: (event: unknown) => void }>;
  formNode.props.onChange({ currentTarget: form, target: election });
  expect(category.value).toBe("");
  expect(requestSubmit).toHaveBeenCalledOnce();
  const html = renderToStaticMarkup(render());
  expect(html).toContain('aria-hidden="true">Elección nueva</span>');
  expect(html).not.toContain('aria-hidden="true">Categoría anterior</span>');
  expect(html).not.toContain("Evidencia servida");
  expect(html).toContain('action="/evidencia" method="get"');
});
