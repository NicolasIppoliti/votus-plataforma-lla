import type { ReactElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { ElectoralGlossary } from "./ElectoralGlossary";

const state = vi.hoisted(() => ({ open: false }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useId: () => "glossary-test",
  useState: () => [state.open, (open: boolean) => { state.open = open; }],
}));
type Node = ReactElement<Record<string, unknown>>;
function parts() {
  const root = ElectoralGlossary({ field: "mesaCode" })!;
  const [button, tooltip] = root.props.children as [Node, Node];
  return { root, button, tooltip };
}
beforeEach(() => { state.open = false; });
it("opens on keyboard focus, associates the definition, dismisses with Escape without moving focus, and closes on blur", () => {
  let { button, tooltip } = parts();
  expect(button.props.type).toBe("button");
  expect(button.props["aria-describedby"]).toBe(tooltip.props.id);
  expect(tooltip.props.hidden).toBe(true);
  (button.props.onFocus as () => void)();
  expect(parts().tooltip.props.hidden).toBe(false);
  const event = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() };
  (button.props.onKeyDown as (event: unknown) => void)(event);
  expect(parts().tooltip.props.hidden).toBe(true);
  expect(event.preventDefault).toHaveBeenCalled();
  (button.props.onFocus as () => void)();
  (button.props.onBlur as () => void)();
  ({ button, tooltip } = parts());
  expect(tooltip.props.hidden).toBe(true);
});
it("supports hover and touch/click without submitting a surrounding form", () => {
  const { root, button } = parts();
  (root.props.onMouseEnter as () => void)();
  expect(parts().tooltip.props.hidden).toBe(false);
  const leave = root.props.onMouseLeave as (event: unknown) => void;
  leave({ currentTarget: { contains: () => true, ownerDocument: { activeElement: {} } } });
  expect(parts().tooltip.props.hidden).toBe(false);
  leave({ currentTarget: { contains: () => false, ownerDocument: { activeElement: null } } });
  expect(parts().tooltip.props.hidden).toBe(true);
  (button.props.onClick as () => void)();
  expect(parts().tooltip.props.hidden).toBe(false);
});
it("does not invent glossary entries for unrelated or unknown fields", () => {
  for (const field of ["electionId", "categoryId", "distritoCode", "unknown", "constructor"]) {
    expect(ElectoralGlossary({ field })).toBeNull();
  }
});
