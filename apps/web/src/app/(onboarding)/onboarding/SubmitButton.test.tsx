import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { SubmitButton } from "./SubmitButton";
const state = vi.hoisted(() => ({ pending: false }));
vi.mock("react-dom", () => ({ useFormStatus: () => state }));
it.each([false, true])("reflects form submission pending=%s", (pending) => {
  state.pending = pending;
  const html = renderToStaticMarkup(<SubmitButton label="Ingresar a Votus" pendingLabel="Guardando…" />);
  expect(html).toContain('type="submit"');
  expect(html).toContain(pending ? "Guardando…" : "Ingresar a Votus");
  expect(html.includes('disabled=""')).toBe(pending);
  expect(html.includes('aria-busy="true"')).toBe(pending);
});
