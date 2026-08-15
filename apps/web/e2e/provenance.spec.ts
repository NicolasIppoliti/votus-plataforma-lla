import { expect, test } from "@playwright/test";

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
      await expect(page).toHaveURL(/\/drilldown/);
      for (const [label, value] of [["Elección", SOURCE_SCOPE.electionId],
        ["Categoría", SOURCE_SCOPE.categoryId], ["Distrito", identity.distritoCode],
        ["Sección", identity.seccionCode], ["Circuito", "00001"], ["Establecimiento", "E1"]] as const) {
        await page.getByLabel(label).selectOption(value);
        await page.getByRole("button", { name: "Aplicar selección" }).click();
      }
      await page.getByLabel("Mesa").selectOption("1");
      await page.getByLabel("Nivel del informe").selectOption("mesa");
      await page.getByRole("button", { name: "Aplicar selección" }).click();
      const explorerUrl = new URL(
        `/drilldown?electionId=${SOURCE_SCOPE.electionId}&categoryId=${SOURCE_SCOPE.categoryId}` +
          `&distritoCode=${encodeURIComponent(identity.distritoCode)}` +
          `&seccionCode=${encodeURIComponent(identity.seccionCode)}` +
          `&circuitoCode=00001&establecimientoCode=E1&mesaCode=1&level=mesa`,
        baseURL,
      ).toString();
      await expect(page).toHaveURL(explorerUrl);
      const explorer = page.getByRole("main");
      await expect(explorer).toContainText(`${OFFICIAL_VOTES} votos a nivel mesa, obtenidos de filas de fuente mesa`);
      await expect(explorer).toContainText(
        `Se excluyeron 1 fila de fuente fiscalización / ${FISCALIZACION_VOTES} votos del agregado oficial`);
      await expect(explorer).not.toContainText(`${OFFICIAL_VOTES + FISCALIZACION_VOTES} votos a nivel mesa`);
      await expect(page.getByRole("list", { name: "procedencia" }).getByRole("listitem")).toHaveCount(1);
      await page.reload();
      await expect(page).toHaveURL(explorerUrl);

      await page.goto(new URL(
        `/drilldown?electionId=${SOURCE_SCOPE.electionId}&categoryId=${SOURCE_SCOPE.categoryId}` +
          `&distritoCode=${identity.distritoCode}&distritoCode=84&level=distrito`,
        baseURL,
      ).toString());
      await expect(page.getByRole("main").getByRole("alert")).toContainText("Se rechazó");
    });
  });
});
