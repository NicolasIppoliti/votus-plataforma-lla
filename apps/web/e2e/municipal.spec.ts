import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { assertE2eEnvironment } from "./gate-contract";
import { test as nextTest } from "./review-test-fixture";
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
    await page.getByRole("combobox", { name: "Organización", exact: true }).selectOption(fixture.organization_id);
    const switched = page.waitForResponse((response) => response.url().endsWith("/api/workspace") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Cambiar organización" }).click();
    expect({ ok: (await switched).ok() }).toEqual({ ok: true });
    return await run();
  } finally {
    const cleanup = await admin.rpc("e2e_cleanup_authorized_fiscal_fixture", { p_fixture: fixture });
    if (cleanup.error || cleanup.data?.cleaned !== true) throw new Error(cleanup.error?.message ?? "municipal fixture cleanup failed");
  }
}

nextTest("retries unavailable municipal evidence with the exact configured request", async ({ page, next }) => {
  const bodies: unknown[] = [];
  const origin = new URL(environment.NEXT_PUBLIC_SUPABASE_URL).origin;
  next.onFetch(async (request) => {
    const url = new URL(request.url);
    if (url.origin !== origin) return "abort";
    if (url.pathname !== "/rest/v1/rpc/official_result") return fetch(request, { redirect: "error" });
    if (request.method !== "POST" || url.search || url.hash) return "abort";
    bodies.push(await request.clone().json());
    if (bodies.length === 1) return Response.json({ message: "controlled unavailable" }, { status: 503 });
    return fetch(request, { redirect: "error" });
  });

  await withResultFixture(SPEC, MUNICIPAL_SOURCE_ISOLATION_FIXTURE, async () =>
    withAuthorizedMunicipalWorkspace(page, async () => {
      const path = `/municipal?electionId=${encodeURIComponent(MUNICIPAL_SCOPE.electionId)}`;
      const submittedUrl = new URL(path, baseURL).toString();
      const expectedBody = {
        p_election_id: MUNICIPAL_SCOPE.electionId,
        p_category_id: MUNICIPAL_SCOPE.categoryId,
        p_distrito_code: "02",
        p_seccion_code: "027",
        p_circuito_code: null,
        p_establecimiento_code: null,
        p_mesa_code: null,
        p_requested_level: "seccion",
      };

      await page.goto(submittedUrl);
      const main = page.getByRole("main");
      await expect(main.getByRole("alert")).toContainText("no está disponible");
      expect(bodies).toEqual([expectedBody]);
      const retry = main.getByRole("link", { name: "Reintentar misma consulta", exact: true });
      const reset = main.getByRole("link", { name: "Volver a elección configurada", exact: true });
      await expect(retry).toHaveAttribute("href", path);
      await expect(reset).toHaveAttribute("href", "/municipal");
      await expect(main.getByRole("table")).toHaveCount(0);
      await expect(main.getByRole("list", { name: "procedencia" })).toHaveCount(0);

      await page.locator("html").evaluate((element) => { element.dataset.retrySentinel = "original-document"; });
      await retry.focus();
      await expect(retry).toBeFocused();
      await retry.press("Enter");
      await expect.poll(() => bodies.length).toBe(2);
      expect(bodies).toEqual([expectedBody, expectedBody]);
      await expect(page).toHaveURL(submittedUrl);
      await expect(page.locator("html")).not.toHaveAttribute("data-retry-sentinel", "original-document");
      await expect(main.getByRole("rowheader", { name: "ALIANZA LA LIBERTAD AVANZA" })).toBeVisible();
      await expect(main.getByRole("cell", { name: String(OFFICIAL_VOTES) })).toBeVisible();
      await expect(retry).toHaveCount(0);
      await expect(reset).toHaveCount(0);
    }),
  );
});

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
      const main = page.getByRole("main");
      await expect(main.getByRole("button", { name: "Ver resultados oficiales" })).toHaveCount(0);
      expect(new URL(page.url()).search).toBe("");

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
      const coldMain = page.getByRole("main");
      await expect(coldMain.getByRole("heading", { name: "Coronel Rosales", level: 1 })).toBeVisible();
      await expect(coldMain).toContainText("Distrito 02 · Sección 027");
      await expect(coldMain.getByRole("button", { name: "Ver resultados oficiales" })).toHaveCount(0);
      expect(new URL(page.url()).search).toBe("");
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { name: "Coronel Rosales", level: 1 })).toBeVisible();
      await expect(main).toContainText("Distrito 02 · Sección 027");
      await expect(main.getByRole("heading", { name: "Resultados exactos" })).toBeVisible();
      await expect(main.getByRole("heading", { name: "Resultados exactos" })).toHaveCSS("font-size", "20px");
      await expect(main.getByRole("rowheader", { name: "ALIANZA LA LIBERTAD AVANZA" })).toBeVisible();
      await expect(main.getByRole("cell", { name: String(OFFICIAL_VOTES) })).toBeVisible();
      await expect(main).toContainText(`1 fila fiscalización / ${FISCALIZACION_VOTES} votos`);
      const archiveSummary = main.locator("summary").filter({ hasText: "Archivo y procedencia" });
      await expect(archiveSummary).toBeVisible();
      await expect(main.getByRole("list", { name: "procedencia" })).not.toBeVisible();
      await archiveSummary.focus();
      await expect(archiveSummary).toBeFocused();
      await archiveSummary.press("Enter");
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
        name: "Coronel Rosales",
        level: 1,
      });
      const results = main.getByRole("region", {
        name: "Resultados exactos", exact: true,
      });
      const evidence = main.getByRole("region", { name: "Referencias de la consulta", exact: true });
      const coverage = main.getByRole("region", { name: "Cobertura y exclusiones", exact: true });
      const distribution = main.getByRole("region", { name: "Votos por partido identificado", exact: true });
      await expect(distribution).toBeVisible();
      await expect(distribution.getByRole("img")).toHaveCount(1);
      await expect(distribution.getByRole("img")).toHaveAttribute("aria-label", "ALIANZA LA LIBERTAD AVANZA: 11.111 votos");
      await expect(distribution).toContainText("Las filas sin partido identificado se informan por separado");
      const selection = main.getByRole("region", {
        name: "Contexto de la consulta",
      });

      await expect(coverage.getByRole("alert")).toContainText(
        "1 de 2 filas (3333 votos) se resolvieron sin un partido curado",
      );
      await expect(coverage.getByRole("listitem").filter({
        hasText: /^110: 1 filas, 3333 votos$/,
      })).toHaveCount(1);

      for (const width of [1710, 1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(heading).toHaveCSS("font-size", "32px");
        await expect.poll(() => main.locator(":scope > .shell-container").evaluate((element) => {
          const workspace = element.closest(".app-shell__workspace");
          if (!(workspace instanceof HTMLElement)) throw new Error("Municipal requires an application workspace");
          const style = getComputedStyle(workspace);
          const availableWidth = workspace.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
          return Math.abs(element.getBoundingClientRect().width - Math.min(1540, availableWidth));
        }), { message: "Municipal keeps its full workspace width up to1540px" }).toBeLessThanOrEqual(1);
        await expect.poll(async () => {
          const boxes = await Promise.all([selection, results, evidence].map((region) => region.evaluate((element) => {
            const { x, y, width, bottom } = element.getBoundingClientRect();
            return { x, y, width, bottom };
          })));
          return {
            contextBefore: boxes[0]!.bottom <= boxes[1]!.y,
            evidenceAfter: boxes[1]!.bottom <= boxes[2]!.y,
            aligned: Math.abs(boxes[1]!.x - boxes[2]!.x) <= 1,
            fullWidth: Math.abs(boxes[1]!.width - boxes[2]!.width) <= 1,
          };
        }).toEqual({ contextBefore: true, evidenceAfter: true, aligned: true, fullWidth: true });
        await expect.poll(() => distribution.evaluate((element) => {
          const axis = element.querySelector('[aria-hidden="true"] > div');
          const svg = element.querySelector("svg");
          if (!axis || !svg) return false;
          const axisBox = axis.getBoundingClientRect();
          const svgBox = svg.getBoundingClientRect();
          const ticks = [...axis.children].map((tick) => {
            const box = tick.getBoundingClientRect();
            return box.x + box.width / 2;
          });
          const mark = svg.querySelector("rect")?.getBoundingClientRect();
          return ticks.length === 2 && Math.abs(axisBox.x - svgBox.x) <= 1
            && Math.abs(axisBox.width - svgBox.width) <= 1
            && Math.abs(ticks[0]! - svgBox.x) <= 1
            && Math.abs(ticks[1]! - svgBox.right) <= 1
            && !!mark && Math.abs(mark.width - svgBox.width) <= 1;
        }), { message: "Municipal zero/max tick centers, plot and largest bar share one scale" }).toBe(true);
        await expect(tableRegion).toHaveAttribute("tabindex", "0");
        await tableRegion.focus();
        await expect(tableRegion).toBeFocused();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      }

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByRole("combobox", { name: "Tema", exact: true }).selectOption("dark");
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expect(distribution).toBeVisible();
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(await distribution.locator("rect").evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).transitionDuration),
      )).toBeLessThanOrEqual(0.00001);
      await page.locator("html").evaluate((element) => { element.style.zoom = "2"; });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await tableRegion.focus();
      await expect(tableRegion).toBeFocused();
      await page.locator("html").evaluate((element) => { element.style.zoom = ""; });
      await page.getByRole("combobox", { name: "Tema", exact: true }).selectOption("light");
      await page.emulateMedia({ reducedMotion: "no-preference" });

    }));
  });
});
