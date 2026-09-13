import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { test as nextTest } from "./review-test-fixture";

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

nextTest("retries unavailable official evidence with the submitted selection after a draft edit", async ({ page, next }) => {
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
  await withResultFixture(SPEC, SOURCE_ISOLATION_FIXTURE, async () => withAuthorizedOfficialWorkspace(page, async () => {
    const path = `/drilldown?electionId=${SOURCE_SCOPE.electionId}&categoryId=${SOURCE_SCOPE.categoryId}` +
      `&distritoCode=${identity.distritoCode}&seccionCode=${identity.seccionCode}` +
      "&circuitoCode=00001&establecimientoCode=E1&mesaCode=1&level=mesa";
    const submittedUrl = new URL(path, baseURL).toString();
    const expectedBody = {
      p_election_id: SOURCE_SCOPE.electionId, p_category_id: SOURCE_SCOPE.categoryId,
      p_distrito_code: identity.distritoCode, p_seccion_code: identity.seccionCode,
      p_circuito_code: "00001", p_establecimiento_code: "E1", p_mesa_code: 1, p_requested_level: "mesa",
    };
    await page.goto(submittedUrl);
    await expect(page.getByRole("main").getByRole("alert")).toContainText("no está disponible");
    expect(bodies).toEqual([expectedBody]);
    const options = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/drilldown/scope-options" && response.request().method() === "POST");
    await page.getByRole("combobox", { name: "Nivel del informe", exact: true }).selectOption("establecimiento");
    expect((await options).ok()).toBe(true);
    await expect(page.locator('form[action="/drilldown"]')).not.toHaveAttribute("aria-busy", "true");
    await expect(page).toHaveURL(submittedUrl);
    await page.locator("html").evaluate((element) => { element.dataset.retrySentinel = "original-document"; });
    const retry = page.getByRole("link", { name: "Reintentar carga", exact: true });
    await expect(retry).toHaveCount(1);
    await expect(retry).toHaveAttribute("href", path);
    await retry.focus();
    await expect(retry).toBeFocused();
    await retry.press("Enter");
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies).toEqual([expectedBody, expectedBody]);
    await expect(page).toHaveURL(submittedUrl);
    await expect(page.locator("html")).not.toHaveAttribute("data-retry-sentinel", "original-document");
    await expect(page.getByRole("combobox", { name: "Nivel del informe", exact: true })).toHaveValue("mesa");
    await expect(page.getByRole("main")).toContainText(`${OFFICIAL_VOTES} votos a nivel mesa`);
    await expect(page.getByRole("list", { name: "procedencia" })).toContainText("SHA-256");
    await expect(retry).toHaveCount(0);
  }));
});

async function expectNoBlankSearchParams(page: Page): Promise<void> {
  const url = new URL(page.url());
  for (const [name, value] of url.searchParams) {
    expect(value, `${name} must be omitted instead of serialized blank`).not.toBe("");
  }
}

    async function withAuthorizedOfficialWorkspace<T>(page: Page, run: () => Promise<T>): Promise<T> {
      const admin = createClient(environment.NEXT_PUBLIC_SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY);
      const { data: auth, error: authError } = await admin.auth.admin.listUsers();
      const user = auth?.users.find((candidate) => candidate.email?.toLowerCase() === environment.VOTUS_E2E_TEST_USER_EMAIL.toLowerCase());
      if (authError || !user) throw new Error(`failed to resolve official fixture user: ${authError?.message ?? "user missing"}`);
      const { data: fixture, error: fixtureError } = await admin.rpc("e2e_setup_authorized_fiscal_fixture", { p_user_id: user.id, p_distrito_code: identity.distritoCode, p_seccion_code: identity.seccionCode });
      if (fixtureError || typeof fixture?.organization_id !== "string") throw new Error(`failed to set up authorized official fixture: ${fixtureError?.message ?? "invalid response"}`);
      let outcome: { value: T } | { error: unknown }; let cleanupError: { message: string } | null;
      try {
        await page.goto(new URL("/dashboard", baseURL).toString()); const selector = page.getByRole("combobox", { name: "Organización", exact: true }); await expect(selector).toBeVisible(); await selector.selectOption(fixture.organization_id);
        const switched = page.waitForResponse((response) => response.url().endsWith("/api/workspace") && response.request().method() === "POST"); await page.getByRole("button", { name: "Cambiar organización" }).click(); const response = await switched;
        expect({ ok: response.ok(), body: await response.json() }).toMatchObject({ ok: true, body: { status: "active" } }); outcome = { value: await run() };
      } catch (error) { outcome = { error }; } finally { ({ error: cleanupError } = await admin.rpc("e2e_cleanup_authorized_fiscal_fixture", { p_fixture: fixture })); }
      if ("error" in outcome) { if (cleanupError) throw new AggregateError([outcome.error, new Error(cleanupError.message)], "official assertion and fixture cleanup failed"); throw outcome.error; }
      if (cleanupError) throw new Error(`failed to clean official fixture: ${cleanupError.message}`); return outcome.value;
    }

    test.describe("no fiscalización leakage into the rendered page", () => {
  test("test_rendered_page_excludes_fiscalizacion_without_opt_in", async ({ page }) => {
    await withResultFixture(SPEC, SOURCE_ISOLATION_FIXTURE, async () => withAuthorizedOfficialWorkspace(page, async () => {
      await page.goto(new URL("/dashboard", baseURL).toString());
      await expect(page).toHaveURL(new URL("/", baseURL).toString());

      await page.goto(new URL(
        `/drilldown?electionId=${SOURCE_SCOPE.electionId}` +
          `&jurisdictionId=${SOURCE_SCOPE.jurisdictionId}&categoryId=${SOURCE_SCOPE.categoryId}` +
          `&partyCategory=${encodeURIComponent(identity.categoryName)}&partyJurisdiction=national`,
        baseURL,
      ).toString());

      const legacy = page.getByRole("main");
      await expect(legacy.getByRole("alert")).toContainText("parámetros heredados");
      await expect(legacy.getByRole("alert")).toContainText("jurisdictionId");
      await expect(legacy).not.toContainText(`${OFFICIAL_VOTES} votos`);

      await page
        .getByRole("navigation", { name: "principal" })
        .getByRole("link", { name: "Explorar", exact: true })
        .click();
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
        await expect(form).not.toHaveAttribute("aria-busy", "true"); await expect(form.locator('[aria-live="polite"]')).toHaveText(""); await expect(page.locator("html")).toHaveAttribute("data-scope-sentinel", "alive");
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
      expect(navigations).toEqual([explorerUrl]);
      expect(navigations.some((href) => href.includes("circuitoCode=") && href.includes("level=seccion"))).toBe(false); await expect(page.locator("html")).toHaveAttribute("data-scope-sentinel", "alive");
      const explorer = page.getByRole("main");
      await expect(explorer).toContainText(`${OFFICIAL_VOTES} votos a nivel mesa, obtenidos de filas de fuente mesa`);
      await expect(explorer).toContainText(
        `Se excluyeron 1 fila de fuente fiscalización / ${FISCALIZACION_VOTES} votos del agregado oficial`);
      await expect(explorer).not.toContainText(`${OFFICIAL_VOTES + FISCALIZACION_VOTES} votos a nivel mesa`);
      await expect(explorer).not.toContainText(FISCALIZACION_MARKER);
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(explorer.getByRole("heading", { name: "Explorador oficial" })).toBeVisible();
      await expect(explorer.getByRole("heading", { name: "Referencia electoral autorizada" })).toBeVisible();
      const voteTable = explorer.getByRole("region", { name: "Votos oficiales y porcentaje por partido" });
      await voteTable.focus();
      await expect(voteTable).toBeFocused();
      expect(await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

      await page.setViewportSize({ width: 320, height: 720 });
      await expect(explorer.getByRole("heading", { name: "Explorador oficial" })).toBeVisible();
      await expect(explorer.getByText("Resultados y evidencia", { exact: true })).toBeVisible();
      await expect(voteTable).toBeVisible();
      await voteTable.focus();
      await expect(voteTable).toBeFocused();
      expect(await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.setViewportSize({ width: 1440, height: 900 });

      const provenance = page.getByRole("list", { name: "procedencia" });
      await expect(provenance.getByRole("listitem")).toHaveCount(1);
      await expect(provenance).toContainText(identity.archiveEntryIds[0]!);
      await expect(provenance).toContainText("SHA-256");
      await expect(provenance.getByRole("link")).toHaveCount(0);
      await expect(provenance).not.toContainText("http://");
      await expect(provenance).not.toContainText("https://");

      const submittedScope = explorer.getByRole("region", { name: "Alcance aplicado", exact: true });
      const results = explorer.getByRole("region", { name: "Desglose oficial autorizado", exact: true });
      const evidence = explorer.getByRole("region", { name: "Referencias de la consulta", exact: true });
      const submittedHeading = results.getByRole("heading", { name: "Desglose oficial autorizado", exact: true });
      await expect(submittedScope).toBeVisible();
      const submitted = {
        scope: await submittedScope.innerText(), heading: await submittedHeading.innerText(),
        votes: await voteTable.innerText(), provenance: await provenance.innerText(),
        results: await results.innerText(), evidence: await evidence.innerText(),
      };
      const dirty = form.getByText("Cambios sin aplicar", { exact: true });
      const level = form.getByRole("combobox", { name: "Nivel del informe", exact: true });
      await expect(level).toHaveValue("mesa");
      await expect(dirty).toHaveCount(0);
      for (const value of ["establecimiento", "mesa"]) {
        const options = page.waitForResponse((response) =>
          new URL(response.url()).pathname === "/api/drilldown/scope-options" && response.request().method() === "POST");
        await level.selectOption(value);
        expect((await options).ok()).toBe(true);
        await expect(form).not.toHaveAttribute("aria-busy", "true");
        await expect(level).toHaveValue(value);
        if (value === "establecimiento") await expect(dirty).toBeVisible();
        else await expect(dirty).toHaveCount(0);
        await expect(page).toHaveURL(explorerUrl);
        await expect.poll(async () => ({
          scope: await submittedScope.innerText(), heading: await submittedHeading.innerText(),
          votes: await voteTable.innerText(), provenance: await provenance.innerText(),
          results: await results.innerText(), evidence: await evidence.innerText(),
        })).toEqual(submitted);
      }
      const filters = explorer.getByRole("region", { name: "Elegir el alcance de los resultados", exact: true });
      await expect.poll(async () => {
        const [filterBox, resultBox, evidenceBox] = await Promise.all(
          [filters, results, evidence].map((region) => region.evaluate((element) => {
            const { top, bottom, left, right, width } = element.getBoundingClientRect();
            return { top, bottom, left, right, width };
          })),
        );
        return {
          filtersAbove: filterBox!.bottom <= Math.min(resultBox!.top, evidenceBox!.top),
          adjacent: resultBox!.right <= evidenceBox!.left,
          aligned: Math.abs(resultBox!.top - evidenceBox!.top) <= 2,
          resultsDominant: resultBox!.width > evidenceBox!.width,
        };
      }).toEqual({ filtersAbove: true, adjacent: true, aligned: true, resultsDominant: true });

      await page.goBack(); await expect(page).toHaveURL(draftUrl);
      await page.locator("html").evaluate((element) => { element.dataset.scopeSentinel = "alive"; });
      draftUrl = coldUrl; navigations.length = 0;
      await draft("Elección", SOURCE_SCOPE.electionId, "Categoría"); await draft("Categoría", SOURCE_SCOPE.categoryId, "Distrito"); await draft("Distrito", identity.distritoCode, "Sección");
      await draft("Sección", identity.seccionCode, "Circuito"); await draft("Circuito", "00001", "Establecimiento"); await draft("Establecimiento", "E1", "Mesa"); await draft("Nivel del informe", "establecimiento");
      const secondUrl = explorerUrl.replace("&mesaCode=1&level=mesa", "&level=establecimiento");
      await page.getByRole("button", { name: "Aplicar selección" }).click();
      await expect(page).toHaveURL(secondUrl); await expectNoBlankSearchParams(page);
      expect(navigations).toEqual([secondUrl]);
      await expect(page.locator("html")).toHaveAttribute("data-scope-sentinel", "alive");
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
    }));
  });
});
