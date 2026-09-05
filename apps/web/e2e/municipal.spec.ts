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
      await expect(main).toContainText("2026-08-10T00:00:00+00:00");
      const tableRegion = main.getByRole("region", { name: "Tabla de resultados oficiales exactos por partido" });
      await tableRegion.focus(); await expect(tableRegion).toBeFocused();
      await page.setViewportSize({ width: 1440, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
      await page.setViewportSize({ width: 320, height: 720 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    }));
  });
});
