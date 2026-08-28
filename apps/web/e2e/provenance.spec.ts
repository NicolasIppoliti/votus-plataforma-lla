import { expect, test, type Page } from "@playwright/test";

import { assertE2eEnvironment } from "./gate-contract";
import {
  FISCALIZACION_VOTES,
  OFFICIAL_VOTES,
  sourceIsolationFixture,
  withResultFixture,
} from "./result-fixture";
import { resultScenarioIdentity, scenarioBaseUrl } from "./scenario-ownership";

/**
 * Threat matrix, "Unofficial-source leakage into official figures", path 3
 * of 3: the RENDERED page, independent of `repository.test.ts`'s coverage
 * of the default query (path 1) and the aggregate (path 2). Blocking one
 * path does not block the others (design.md threat matrix row), so this
 * test exercises the actual HTML the operator sees, not the API surface.
 */

const environment = assertE2eEnvironment(process.env);
const SPEC = "e2e/provenance.spec.ts";
const identity = resultScenarioIdentity(SPEC);
const { scope: SOURCE_SCOPE, seed: SOURCE_ISOLATION_FIXTURE } =
  sourceIsolationFixture(SPEC);
const baseURL = scenarioBaseUrl(SPEC, environment);
// The badge marker rendered only when a figure's `sourceKind` is
// `fiscalizacion` (see `src/components/GranularityBadge.tsx` /
// `SourceDisclaimer.tsx`, task 11.17). No page rendered without an
// explicit unofficial opt-in may ever contain it.
const FISCALIZACION_MARKER = "party-internal, unofficial";

async function expectNoBlankSearchParams(page: Page): Promise<void> {
  const url = new URL(page.url());
  for (const [name, value] of url.searchParams) {
    expect(value, `${name} must be omitted instead of serialized blank`).not.toBe("");
  }
}

test.describe("no fiscalización leakage into the rendered page", () => {
  test("test_rendered_page_excludes_fiscalizacion_without_opt_in", async ({ page }) => {
    await withResultFixture(SPEC, SOURCE_ISOLATION_FIXTURE, async () => {
      await page.goto(new URL("/dashboard", baseURL).toString());
      await expect(page).toHaveURL(/\/dashboard/);

      await page.goto(new URL(
        `/drilldown?electionId=${SOURCE_SCOPE.electionId}` +
          `&jurisdictionId=${SOURCE_SCOPE.jurisdictionId}&categoryId=${SOURCE_SCOPE.categoryId}` +
          `&partyCategory=${encodeURIComponent(identity.categoryName)}&partyJurisdiction=national`,
        baseURL,
      ).toString());

      const main = page.getByRole("main");
      const officialTotal = main.getByRole("note").filter({ hasText: "Total oficial:" });
      await expect(officialTotal).toContainText(`Total oficial: ${OFFICIAL_VOTES} votos`);
      await expect(officialTotal).not.toContainText(String(FISCALIZACION_VOTES));
      await expect(main).toContainText(
        `1 fila fiscalización / ${FISCALIZACION_VOTES} votos se excluyeron por el filtro de fuente oficial`,
      );
      await expect(main).not.toContainText(FISCALIZACION_MARKER);
      await expect(main).not.toContainText(`Total oficial: ${OFFICIAL_VOTES + FISCALIZACION_VOTES}`);

      await page.getByRole("link", { name: "Explorar resultados" }).click();
      await expect(page).toHaveURL(new URL("/drilldown", baseURL).toString());
      const coldUrl = page.url();
      let draftUrl = coldUrl;
      await page.getByRole("button", { name: "Aplicar selección" }).click();
      await expect(page).toHaveURL(coldUrl);
      await expect(page.getByRole("combobox", { name: "Elección", exact: true })).toBeFocused();
      for (const label of [
        "Categoría", "Distrito", "Sección", "Circuito", "Establecimiento", "Mesa",
        "Nivel del informe",
      ]) {
        const descendant = page.getByRole("combobox", { name: label, exact: true });
        await expect(descendant).toBeDisabled();
        expect(await descendant.evaluate((element) => {
          (element as HTMLSelectElement).focus();
          return document.activeElement === element;
        })).toBe(false);
      }

      const form = page.locator('form[action="/drilldown"]'); await page.locator("html").evaluate((element) => { element.dataset.scopeSentinel = "alive"; });
      const draft = async (label: string, value: string, dependent?: string, optionText?: string): Promise<void> => {
        const control = page.getByRole("combobox", { name: label, exact: true });
        if (optionText) await expect(control.getByRole("option", { name: optionText, exact: true })).toHaveAttribute("value", value);
        const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/drilldown/scope-options");
        await control.focus(); await control.selectOption(value);
        expect(page.url()).toBe(draftUrl); await expect(control).toBeFocused();
        if (dependent) {
          const child = page.getByRole("combobox", { name: dependent, exact: true }); await expect(child).toHaveValue(""); await expect(child).toBeDisabled();
        }
        expect(await (await responsePromise).json()).toMatchObject({ capability: "official-exploration", meaning: "scope-options-only" });
        if (dependent && value) await expect(page.getByRole("combobox", { name: dependent, exact: true })).toBeEnabled();
        await expect(form).not.toHaveAttribute("aria-busy", "true"); await expect(form.locator('[aria-live="polite"]')).toHaveText("");
      };
      await draft("Elección", SOURCE_SCOPE.electionId, "Categoría"); await draft("Categoría", SOURCE_SCOPE.categoryId, "Distrito");
      await draft("Distrito", identity.distritoCode, "Sección", `${identity.distritoCode} — Buenos Aires`); await draft("Sección", identity.seccionCode, "Circuito", `${identity.seccionCode} — Coronel de Marina L. Rosales`);
      await draft("Nivel del informe", "seccion"); await draft("Circuito", "00001", "Establecimiento", "00001 — 00001"); expect(page.url()).toBe(draftUrl);
      await draft("Establecimiento", "E1", "Mesa", "E1 — Synthetic school"); await draft("Mesa", "1"); await draft("Nivel del informe", "");
      const clearResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/drilldown/scope-options");
      const section = page.getByRole("combobox", { name: "Sección", exact: true }); await section.focus(); await section.selectOption("");
      expect(page.url()).toBe(draftUrl); await expect(section).toBeFocused();
      for (const label of ["Circuito", "Establecimiento", "Mesa"]) {
        const child = page.getByRole("combobox", { name: label, exact: true });
        await expect(child).toHaveValue(""); await expect(child).toBeDisabled();
      }
      await clearResponse;
      await draft("Sección", identity.seccionCode, "Circuito");
      await draft("Circuito", "00001", "Establecimiento");
      await draft("Establecimiento", "E1", "Mesa");
      await draft("Mesa", "1"); await draft("Nivel del informe", "mesa");
      const navigations: string[] = [];
      page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
      await page.getByRole("button", { name: "Aplicar selección" }).click();
      await expectNoBlankSearchParams(page);
      const explorerUrl = new URL(
        `/drilldown?electionId=${SOURCE_SCOPE.electionId}&categoryId=${SOURCE_SCOPE.categoryId}` +
          `&distritoCode=${encodeURIComponent(identity.distritoCode)}` +
          `&seccionCode=${encodeURIComponent(identity.seccionCode)}` +
          `&circuitoCode=00001&establecimientoCode=E1&mesaCode=1&level=mesa`,
        baseURL,
      ).toString();
      await expect(page).toHaveURL(explorerUrl);
      expect([...new Set(navigations)]).toEqual([explorerUrl]);
      expect(navigations.some((href) => href.includes("circuitoCode=") && href.includes("level=seccion"))).toBe(false);
      const explorer = page.getByRole("main");
      await expect(explorer).toContainText(`${OFFICIAL_VOTES} votos a nivel mesa, obtenidos de filas de fuente mesa`);
      await expect(explorer).toContainText(
        `Se excluyeron 1 fila de fuente fiscalización / ${FISCALIZACION_VOTES} votos del agregado oficial`);
      await expect(explorer).not.toContainText(`${OFFICIAL_VOTES + FISCALIZACION_VOTES} votos a nivel mesa`);
      await expect(page.getByRole("list", { name: "procedencia" }).getByRole("listitem")).toHaveCount(1);

      await page.goBack(); await expect(page).toHaveURL(draftUrl);
      await page.locator("html").evaluate((element) => { element.dataset.scopeSentinel = "alive"; });
      draftUrl = coldUrl; navigations.length = 0;
      await draft("Elección", SOURCE_SCOPE.electionId, "Categoría"); await draft("Categoría", SOURCE_SCOPE.categoryId, "Distrito"); await draft("Distrito", identity.distritoCode, "Sección");
      await draft("Sección", identity.seccionCode, "Circuito"); await draft("Circuito", "00001", "Establecimiento"); await draft("Establecimiento", "E1", "Mesa"); await draft("Nivel del informe", "establecimiento");
      const secondUrl = explorerUrl.replace("&mesaCode=1&level=mesa", "&level=establecimiento");
      await page.getByRole("button", { name: "Aplicar selección" }).click();
      await expect(page).toHaveURL(secondUrl); await expectNoBlankSearchParams(page);
      expect([...new Set(navigations)]).toEqual([secondUrl]);

      await expect(explorer).toContainText("votos a nivel establecimiento");
      await page.goto(new URL("/dashboard", baseURL).toString()); await page.goBack();
      await expect(page).toHaveURL(secondUrl);
      await expect(page.getByRole("combobox", { name: "Nivel del informe", exact: true })).toHaveValue("establecimiento");
      await page.reload(); await expect(page).toHaveURL(secondUrl);

      await page.goto(new URL(
        `/drilldown?electionId=${SOURCE_SCOPE.electionId}&categoryId=${SOURCE_SCOPE.categoryId}` +
          `&distritoCode=${identity.distritoCode}&seccionCode=${identity.seccionCode}` +
          "&circuitoCode=00001&establecimientoCode=E1&mesaCode=invalid&level=mesa",
        baseURL,
      ).toString());
      await expect(page.getByRole("main").getByRole("alert")).toContainText("Se rechazó");

      await page.goto(new URL(
        `/drilldown?electionId=${SOURCE_SCOPE.electionId}&categoryId=${SOURCE_SCOPE.categoryId}` +
          `&distritoCode=${identity.distritoCode}&distritoCode=84&level=distrito`,
        baseURL,
      ).toString());
      await expect(page.getByRole("main").getByRole("alert")).toContainText("Se rechazó");
    });
  });
});
