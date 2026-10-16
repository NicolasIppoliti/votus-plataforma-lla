import { type ReactElement, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { FiscalizacionSelectionForm } from "./FiscalizacionSelectionForm";

const state = vi.hoisted(() => ({ refs: [] as Array<{ current: unknown }>, index: 0, effects: [] as Array<() => void>, replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: state.replace }) }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useRef: (initial: unknown) => state.refs[state.index++] ?? (state.refs[state.index - 1] = { current: initial }),
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: (effect: () => void) => { state.effects.push(effect); },
}));
function render(electionId: string) {
  state.index = 0;
  state.effects = [];
  return FiscalizacionSelectionForm({ selected: { electionId, categoryId: "", distritoCode: "", seccionCode: "" }, sourceKind: "official", fields: [{ name: "electionId", id: "election", label: "Elección", placeholder: "Elegir", options: [] }], children: null });
}
function control(node: ReactNode): ReactElement<{ onChange: (event: unknown) => void }> | undefined {
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const element = node as ReactElement<{ name?: string; children?: ReactNode }>;
  if (element.props.name === "electionId") return element as ReturnType<typeof control>;
  for (const child of [element.props.children].flat()) { const found = control(child); if (found) return found; }
}
beforeEach(() => { state.refs = []; state.effects = []; vi.clearAllMocks(); });
it.each([false, true])("restores focus lost during navigation without stealing a user's new focus (%s)", moved => {
  const body = {};
  const target = { focus: vi.fn(), isConnected: true };
  vi.stubGlobal("document", { body, documentElement: {}, activeElement: moved ? {} : body });
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  try {
    const tree = render("");
    control(tree)!.props.onChange({ target: { value: "new" }, currentTarget: target });
    expect(state.replace).toHaveBeenCalled();
    render("new");
    for (const effect of state.effects) effect();
    expect(target.focus).toHaveBeenCalledTimes(moved ? 0 : 1);
  } finally { vi.unstubAllGlobals(); }
});
