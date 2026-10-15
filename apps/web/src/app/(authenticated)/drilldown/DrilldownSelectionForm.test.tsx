import { beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { canonicalScopeSearchParams } from "@/components/scope-selector-behavior";

const harness = vi.hoisted(() => ({ navigation: {}, push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => harness }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: <T,>(value: T) => [value, vi.fn()], useRef: <T,>(value: T) => ({ current: value }),
  useEffect: vi.fn(), useTransition: () => [false, (task: () => void) => task()],
  useContext: () => harness.navigation,
}));
import { DrilldownSelectionForm } from "./DrilldownSelectionForm";
import { TerritorialNavigator } from "./TerritorialNavigator";

type Node = ReactElement<Record<string, unknown>>;
function find(node: unknown, predicate: (node: Node) => boolean): Node {
  if (Array.isArray(node)) {
    for (const child of node) { try { return find(child, predicate); } catch { /* next sibling */ } }
  } else if (node && typeof node === "object" && "props" in node) {
    const element = node as Node;
    if (predicate(element)) return element;
    return find(element.props.children, predicate);
  }
  throw new Error("Element not found");
}
const selected = { electionId: "e1", categoryId: "c1", distritoCode: "02", seccionCode: "027", level: "seccion" };
const child = { ...selected, circuitoCode: "00001", level: "circuito" };
function render() {
  const form = DrilldownSelectionForm({ selected, fields: [{ name: "categoryId", id: "category", label: "Categoría", placeholder: "Elegir", options: [{ value: "c1", label: "Una" }, { value: "c2", label: "Otra" }] }], notes: null, children: null });
  harness.navigation = form.props.value;
  const navigator = TerritorialNavigator({ items: [{ name: "Sección", values: selected }, { name: "Circuito", values: child }], options: [{ name: "Otro circuito", values: child }], title: "Circuito", terminal: false });
  return { form, navigator };
}
const url = (values: typeof selected) => `/drilldown?${canonicalScopeSearchParams(values)}`;
beforeEach(() => vi.clearAllMocks());
it("pushes child opening through the real navigator and form", () => {
  const { navigator } = render();
  (find(navigator, node => node.props["aria-label"] === "Abrir Otro circuito").props.onClick as () => void)();
  expect(harness.push).toHaveBeenCalledWith(url(child), { scroll: false });
  expect(harness.replace).not.toHaveBeenCalled();
});
it("pushes ancestor trail traversal through the form's real link boundary", () => {
  const { form, navigator } = render();
  const link = find(navigator, node => node.type === "a");
  const preventDefault = vi.fn();
  (find(form, node => typeof node.props.onClick === "function").props.onClick as (event: unknown) => void)({ target: { closest: () => ({ href: `https://example.test${link.props.href}` }) }, preventDefault });
  expect(preventDefault).toHaveBeenCalled();
  expect(harness.push).toHaveBeenCalledWith(url(selected), { scroll: false });
  expect(harness.replace).not.toHaveBeenCalled();
});
it("replaces frequent selector edits through the real form", () => {
  const { form } = render();
  (find(form, node => node.props.id === "category").props.onChange as (event: unknown) => void)({ target: { value: "c2" } });
  expect(harness.replace).toHaveBeenCalledWith("/drilldown?electionId=e1&categoryId=c2", { scroll: false });
  expect(harness.push).not.toHaveBeenCalled();
});
it("pushes the internal parent button without removing it", () => {
  const { navigator } = render();
  (find(navigator, node => node.type === "button" && JSON.stringify(node.props.children) === JSON.stringify(["Volver a ", "Sección"])).props.onClick as () => void)();
  expect(harness.push).toHaveBeenCalledWith(url(selected), { scroll: false });
});
