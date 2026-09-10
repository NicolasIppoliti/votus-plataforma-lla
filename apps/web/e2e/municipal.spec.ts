import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { assertE2eEnvironment } from "./gate-contract";
import {
  FISCALIZACION_VOTES,
  OFFICIAL_VOTES,
  sourceIsolationFixture,
  withResultFixture,
} from "./result-fixture";
import { resultScenarioIdentity, scenarioBaseUrl } from "./scenario-ownership";

const environment = assertE2eEnvironment(process.env);
const SPEC = "e2e/municipal.spec.ts";
const { scope: MUNICIPAL_SCOPE, seed: MUNICIPAL_SOURCE_ISOLATION_FIXTURE } =
  sourceIsolationFixture(SPEC);
const baseURL = scenarioBaseUrl(SPEC, environment);
const identity = resultScenarioIdentity(SPEC);

interface WorkspaceFixture { organization_id: string; user_id: string; distrito_code: string; seccion_code: string; }
async function withAuthorizedMunicipalWorkspace<T>(page: Page, run: () => Promise<T>): Promise<T> {
  const admin = createClient(environment.NEXT_PUBLIC_SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY);
  const { data: users, error: userError } = await admin.auth.admin.listUsers();
  const user = users?.users.find((candidate) => candidate.email?.toLowerCase() === environment.VOTUS_E2E_TEST_USER_EMAIL.toLowerCase());
  if (userError || !user) throw new Error("failed to resolve municipal fixture user");
  const { data, error } = await admin.rpc("e2e_setup_authorized_fiscal_fixture", { p_user_id: user.id, p_distrito_code: "02", p_seccion_code: "027" });
  if (error || typeof data?.organization_id !== "string") throw new Error("failed to set up authorized municipal fixture");
  const fixture = data as WorkspaceFixture;
  try {
    await page.goto(new URL("/dashboard", baseURL).toString());
    await page.getByLabel("Organización").selectOption(fixture.organization_id);
    const switched = page.waitForResponse((response) => response.url().endsWith("/api/workspace") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Cambiar organización" }).click();
    expect({ ok: (await switched).ok() }).toEqual({ ok: true });
    return await run();
  } finally {
    const cleanup = await admin.rpc("e2e_cleanup_authorized_fiscal_fixture", { p_fixture: fixture });
    if (cleanup.error || cleanup.data?.cleaned !== true) throw new Error(cleanup.error?.message ?? "municipal fixture cleanup failed");
  }
}

test.describe("the municipal route requires workspace-authorized official results", () => {
  test("test_route_is_reachable_and_fails_closed_without_workspace_entitlement", async ({ page }) => {
    await withResultFixture(SPEC, MUNICIPAL_SOURCE_ISOLATION_FIXTURE, async () => {
      await page.goto(new URL("/", baseURL).toString());
      const municipalNavigationLink = page
        .getByRole("navigation", { name: "principal" })
        .getByRole("link", { name: "Municipal", exact: true });
      await municipalNavigationLink.click();
      await expect(page).toHaveURL(/\/municipal$/);
      await expect(municipalNavigationLink).toHaveAttribute(
        "aria-current",
        "page",
      );
      await page.getByLabel("Elección municipal").selectOption(MUNICIPAL_SCOPE.electionId);
      await page.getByRole("button", { name: "Ver resultados oficiales" }).click();
      const url = new URL(page.url());
      expect([[...url.searchParams.keys()], url.searchParams.get("electionId")]).toEqual([["electionId"], MUNICIPAL_SCOPE.electionId]);

      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { name: "Municipal (Concejales)" })).toBeVisible();
      await expect(main.getByRole("alert")).toContainText("El espacio de trabajo no autoriza esta sección municipal");
      await expect(main.getByRole("region", {
        name: "Tabla de resultados oficiales exactos por partido", exact: true,
      })).toHaveCount(0);
      await expect(main.getByRole("table")).toHaveCount(0);
      await expect(main.getByRole("rowheader")).toHaveCount(0);
      await expect(main).not.toContainText(`ALIANZA LA LIBERTAD AVANZA: ${OFFICIAL_VOTES} voto(s)`);
      await expect(main).not.toContainText("110: 1 filas");
      await expect(main.getByRole("status", { name: "granularidad: seccion" })).toHaveCount(0);
      await expect(main).not.toContainText(`1 fila fiscalización / ${FISCALIZACION_VOTES} votos`);
      await expect(main.getByRole("list", { name: "procedencia" })).toHaveCount(0);
      await expect(main).not.toContainText(String(OFFICIAL_VOTES + FISCALIZACION_VOTES));
      await expect(main).not.toContainText("party-internal, unofficial");
    });
  });

  test("test_authorized_workspace_shows_exact_official_table_and_adjacent_evidence", async ({ page }) => {
    await withResultFixture(SPEC, MUNICIPAL_SOURCE_ISOLATION_FIXTURE, async () => withAuthorizedMunicipalWorkspace(page, async () => {
      await page.goto(new URL("/", baseURL).toString());
      const municipalNavigationLink = page.getByRole("navigation", { name: "principal" }).getByRole("link", { name: "Municipal", exact: true });
      await municipalNavigationLink.click();
      await page.getByLabel("Elección municipal").selectOption(MUNICIPAL_SCOPE.electionId);
      await page.getByRole("button", { name: "Ver resultados oficiales" }).click();
      expect(new URL(page.url()).searchParams.toString()).toBe(`electionId=${MUNICIPAL_SCOPE.electionId}`);
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { name: "Resultados exactos" })).toBeVisible();
      await expect(main.getByRole("rowheader", { name: "ALIANZA LA LIBERTAD AVANZA" })).toBeVisible();
      await expect(main.getByRole("cell", { name: String(OFFICIAL_VOTES) })).toBeVisible();
      await expect(main).toContainText(`1 fila fiscalización / ${FISCALIZACION_VOTES} votos`);
      await expect(main.getByRole("list", { name: "procedencia" })).toContainText(`${identity.archiveEntryIds[0]} — sha256: ${MUNICIPAL_SOURCE_ISOLATION_FIXTURE.archiveEntries![0]!["sha256"]}`);
      await expect(main.getByRole("list", { name: "procedencia" })).not.toContainText(identity.archiveEntryIds[1]!);
      await expect(main.getByRole("list", { name: "procedencia" })).not.toContainText(identity.archiveEntryIds[2]!);
      await expect(main).toContainText("2026-08-10T00:00:00+00:00");
      const tableRegion = main.getByRole("region", { name: "Tabla de resultados oficiales exactos por partido" });
      const officialRows = tableRegion.getByRole("table").locator("tbody").getByRole("row");
      await expect(officialRows).toHaveCount(1);
      await expect(officialRows.getByRole("rowheader")).toHaveText(["ALIANZA LA LIBERTAD AVANZA"]);
      await expect(officialRows.getByRole("cell")).toHaveText([String(OFFICIAL_VOTES)]);
      await tableRegion.focus(); await expect(tableRegion).toBeFocused();
      const heading = main.getByRole("heading", {
        name: "Resultados municipales (Concejales)",
        level: 1,
      });
      const results = main.getByRole("region", {
        name: "Resultados exactos", exact: true,
      });
      const evidence = main.getByRole("complementary", {
        name: "Evidencia oficial",
      });
      const selection = main.getByRole("region", {
        name: "Contexto de la consulta",
      });

      await expect(evidence.getByRole("alert")).toContainText(
        "1 de 2 filas (3333 votos) se resolvieron sin un partido curado",
      );
      await expect(evidence.getByRole("listitem").filter({
        hasText: /^110: 1 filas, 3333 votos$/,
      })).toHaveCount(1);

      const expectEffectiveLayoutWidth = async () => {
        const layout = main.locator(":scope > .official-municipal__layout");
        await expect(layout).toBeVisible();
        await expect(page.locator(".app-shell__workspace")).toBeVisible();
        await expect.poll(async () => layout.evaluate((element) => {
          const workspace = element.closest(".app-shell__workspace");
          if (!(workspace instanceof HTMLElement)) {
            throw new Error("Municipal layout requires an application workspace");
          }
          const style = getComputedStyle(workspace);
          const availableWidth = workspace.clientWidth
            - Number.parseFloat(style.paddingLeft)
            - Number.parseFloat(style.paddingRight);
          const expectedWidth = Math.min(1540, availableWidth);
          return Math.abs(element.getBoundingClientRect().width - expectedWidth);
        }), {
          message: "Municipal layout fills the workspace up to its 1540px cap",
        }).toBeLessThanOrEqual(1);
      };

      await page.setViewportSize({ width: 1710, height: 906 });
      await expect(heading).toBeVisible();
      await expect(heading).toHaveCSS("font-size", "36px");
      await expect(heading).toHaveCSS("line-height", "36px");
      await expect(heading).toHaveCSS("letter-spacing", "-1.62px");
      await expect(main.locator(":scope > .shell-container")).toHaveCSS(
        "max-width", "1540px",
      );
      await expectEffectiveLayoutWidth();
      const desktopResults = await results.evaluate((element) => {
        const { x, y, right } = element.getBoundingClientRect();
        return { x, y, right };
      });
      const desktopEvidence = await evidence.evaluate((element) => {
        const { x, y, right, width } = element.getBoundingClientRect();
        return { x, y, right, width };
      });
      const desktopSelection = await selection.evaluate((element) => {
        const { x, right, bottom } = element.getBoundingClientRect();
        return { x, right, bottom };
      });
      expect(desktopEvidence.x).toBeGreaterThanOrEqual(desktopResults.right);
      expect(Math.abs(desktopEvidence.y - desktopResults.y)).toBeLessThanOrEqual(1);
      expect(desktopEvidence.width).toBeCloseTo(304, 0);
      expect(desktopSelection.bottom).toBeLessThanOrEqual(desktopResults.y);
      expect(Math.abs(desktopSelection.x - desktopResults.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(desktopSelection.right - desktopEvidence.right))
        .toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(1710);

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(heading).toHaveCSS("font-size", "28px");
      await expectEffectiveLayoutWidth();
      const mobileResults = await results.evaluate((element) => {
        const { x, bottom, width } = element.getBoundingClientRect();
        return { x, bottom, width };
      });
      const mobileEvidence = await evidence.evaluate((element) => {
        const { x, y, width } = element.getBoundingClientRect();
        return { x, y, width };
      });
      expect(mobileEvidence.y).toBeGreaterThanOrEqual(mobileResults.bottom);
      expect(Math.abs(mobileEvidence.x - mobileResults.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(mobileEvidence.width - mobileResults.width))
        .toBeLessThanOrEqual(1);
      await expect(tableRegion).toHaveAttribute("tabindex", "0");
      await tableRegion.focus();
      await expect(tableRegion).toBeFocused();
      expect(await tableRegion.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      )).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(390);

      await page.setViewportSize({ width: 1440, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
      await page.setViewportSize({ width: 320, height: 720 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    }));
  });
});
