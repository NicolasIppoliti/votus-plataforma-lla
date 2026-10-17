import { expect, type Locator } from "@playwright/test";

/** Exercise the rendered input without moving focus out of it while filtering. */
export async function assertTerritorialFilter(region: Locator, input: Locator, query: string, total: number, matches: number) {
  const status = region.getByRole("status").filter({ hasText: "territorios listados" });
  await expect(status).toHaveText(`${total} visibles · ${total} territorios listados`);
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status).toHaveAttribute("aria-atomic", "true");
  await input.press("Shift+Tab");
  await input.page().keyboard.press("Tab");
  await expect(input).toBeFocused();
  await input.pressSequentially(query);
  await expect(status).toHaveText(`${matches} visibles · ${total} territorios listados`);
  await expect(input).toBeFocused();
  await input.press("ControlOrMeta+A");
  await input.pressSequentially("sin-coincidencias-603");
  await expect(status).toHaveText(`0 visibles · ${total} territorios listados · No hay coincidencias.`);
  await expect(input).toBeFocused();
  await input.press("ControlOrMeta+A");
  await input.press("Backspace");
  await expect(status).toHaveText(`${total} visibles · ${total} territorios listados`);
  await expect(input).toBeFocused();
}
