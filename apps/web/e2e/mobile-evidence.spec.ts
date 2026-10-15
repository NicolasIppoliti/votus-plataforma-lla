import { expect, test, type Page } from "@playwright/test";
import { withReviewItem } from "./authorized-review-fixture";
import { emptyStorageState } from "./gate-contract";

const viewport = { width: 320, height: 844 };

// This runs only against the release gate's disposable, synthetic database.
// Keep screenshots opt-in here; never enable global authenticated screenshots.
async function capture(page: Page, name: string): Promise<void> {
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`e2e-evidence-463-${name}.png`), fullPage: true });
}

test("login evidence at 320px (#463)", async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error("mobile evidence requires the gate base URL");
  const context = await browser.newContext({ baseURL, storageState: emptyStorageState(), viewport });
  try {
    const page = await context.newPage();
    await page.goto("/login");
    await expect(page.getByLabel("Correo electrónico")).toBeVisible();
    await expect(page.getByLabel("Contraseña", { exact: true })).toBeVisible();
    await capture(page, "login");
  } finally {
    await context.close();
  }
});

for (const route of ["/", "/drilldown", "/compare", "/municipal", "/fiscalizacion", "/evidencia", "/review", "/scenarios", "/simulate"]) {
  test(`mobile evidence for ${route} at 320px (#463)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await withReviewItem(page, async () => {
      const name = route === "/" ? "root" : route.slice(1);
      if (route === "/simulate") {
        // Use the same seeded scenario journey as simulate.spec.ts so all
        // three forms, not just the empty editor, are captured.
        await page.goto("/scenarios");
        await page.getByTestId("scenario-persistencia").getByRole("link", { name: "Editar este escenario" }).click();
        await expect(page.getByTestId("allocation-result")).toBeVisible();
        for (const label of ["Editar los datos del escenario", "Sensibilidad de la transferencia"]) {
          const summary = page.locator("details > summary").filter({ hasText: label });
          if (!await summary.locator("..").evaluate(element => (element as HTMLDetailsElement).open)) await summary.click();
        }
        for (const label of ["Formulario de simulación de bancas", "Transferencia de votos a total fijo", "Muestreo de transferencias a total fijo"]) {
          await expect(page.getByRole("form", { name: label, exact: true })).toBeVisible();
        }
      } else {
        await page.goto(route);
      }
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.locator("#main-content h1").first()).toBeVisible();
      const pickers = page.locator("#main-content details").filter({ has: page.locator("select, input") });
      for (let index = 0; index < await pickers.count(); index++) {
        const picker = pickers.nth(index);
        if (!await picker.evaluate(element => (element as HTMLDetailsElement).open)) await picker.locator(":scope > summary").click();
      }
      await capture(page, name);
      await page.getByRole("button", { name: "Abrir navegación" }).click();
      const drawer = page.getByRole("dialog", { name: "Navegación principal" });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("combobox", { name: "Organización", exact: true })).toBeVisible();
      await capture(page, `${name}-drawer-workspace`);
      await drawer.locator("summary").filter({ hasText: "Cuenta" }).click();
      await expect(drawer.getByRole("button", { name: "Cerrar sesión", exact: true })).toBeVisible();
      await capture(page, `${name}-drawer-account`);
      await drawer.getByRole("button", { name: "Cerrar navegación" }).click();
    });
  });
}
