import { expect, test, type Page } from "@playwright/test";

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
}

test.describe("the simulation route labels caller-supplied projections", () => {
  test("test_projection_form_reaches_the_municipal_hare_result", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);

    await page
      .getByRole("navigation", { name: "principal" })
      .getByRole("link", { name: "Simulación de bancas", exact: true })
      .click();
    await expect(page).toHaveURL(/\/simulate$/);

    const form = page.getByRole("form", {
      name: "Formulario de simulación de bancas",
    });
    await expect(form).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Crear un escenario" }),
    ).toBeVisible();
    await expect(
      form.getByRole("group", { name: "Elección y alcance" }),
    ).toBeVisible();
    await expect(
      form.getByRole("group", { name: "Totales del escenario" }),
    ).toBeVisible();
    await expect(
      form.getByRole("group", { name: "Listas y votos" }),
    ).toBeVisible();

    const municipalConfiguration = page.getByRole("region", {
      name: "Concejo configurado",
    });
    await expect(municipalConfiguration).toContainText(
      /Municipio admitido\s*Coronel de Marina Leonardo Rosales/,
    );
    await expect(municipalConfiguration).toContainText(
      /Composición total\s*18 bancas/,
    );
    await expect(municipalConfiguration).toContainText(
      /Bancas renovadas por elección\s*9 bancas/,
    );
    await expect(
      municipalConfiguration.locator("input, select, textarea, button"),
    ).toHaveCount(0);

    await expect(
      form.getByRole("combobox", { name: /método|concejo|municipio/i }),
    ).toHaveCount(0);
    await expect(
      form.getByRole("radio", { name: /método/i }),
    ).toHaveCount(0);
    await expect(
      form.getByRole("spinbutton", { name: /umbral/i }),
    ).toHaveCount(0);
    await expect(
      form.getByRole("textbox", { name: /held.?over|json/i }),
    ).toHaveCount(0);
    await expect(form.getByLabel("Bancas a asignar")).toHaveCount(0);
    await expect(form.locator("textarea")).toHaveCount(0);
    await expect(form).not.toContainText(/heldOver|JSON/);
    await expectNoHorizontalOverflow(page);

    await form.getByLabel("Granularidad").selectOption("seccion");
    await form.getByRole("button", { name: "Agregar lista" }).click();
    await expect(form.getByLabel("Nombre de la lista").nth(1)).toBeFocused();
    await form.getByRole("button", { name: "Agregar lista" }).click();
    await expect(form.getByLabel("Nombre de la lista").nth(2)).toBeFocused();
    await expect(form.getByLabel("Nombre de la lista")).toHaveCount(3);

    await form.getByRole("button", { name: "Agregar lista" }).click();
    await expect(form.getByLabel("Nombre de la lista").nth(3)).toBeFocused();
    await form.getByRole("button", { name: "Quitar lista 3" }).click();
    await expect(form.getByLabel("Nombre de la lista").nth(2)).toBeFocused();
    await form.getByRole("button", { name: "Quitar lista 3" }).click();
    await expect(form.getByLabel("Nombre de la lista").nth(1)).toBeFocused();
    await expect(form.getByLabel("Nombre de la lista")).toHaveCount(2);

    const listNames = form.getByLabel("Nombre de la lista");
    const listVotes = form.getByLabel("Votos de la lista");
    await listNames.nth(0).fill("Lista A");
    await listVotes.nth(0).fill("6000");
    await listNames.nth(1).fill("Lista B");
    await listVotes.nth(1).fill("4000");
    await form.getByLabel("Total de votos").fill("9000");
    await form.getByLabel("Votos en blanco").fill("0");
    await form.getByLabel("Votos anulados").fill("0");

    await form.getByRole("button", { name: "Simular bancas" }).click();
    const validationAlert = form.getByRole("alert");
    await expect(validationAlert).toContainText(
      "Los totales de votos no son consistentes entre sí ni con los votos de las listas.",
    );
    await expect(form.getByLabel("Total de votos")).toHaveValue("9000");
    await expect(listNames.nth(0)).toHaveValue("Lista A");
    await expect(listVotes.nth(0)).toHaveValue("6000");
    await expect(listNames.nth(1)).toHaveValue("Lista B");
    await expect(listVotes.nth(1)).toHaveValue("4000");

    await form.getByLabel("Total de votos").fill("10000");
    await form.getByRole("button", { name: "Simular bancas" }).click();
    await expect(page).toHaveURL(/\/simulate\?/);

    const submittedUrl = new URL(page.url());
    expect(submittedUrl.pathname).toBe("/simulate");
    expect(submittedUrl.searchParams.getAll("input")).toHaveLength(1);
    expect(submittedUrl.searchParams.get("council")).toBe(
      "Coronel de Marina Leonardo Rosales",
    );
    expect(submittedUrl.searchParams.has("heldOver")).toBe(false);
    expect([...submittedUrl.searchParams.keys()].sort()).toEqual([
      "council",
      "input",
    ]);

    const inputParam = submittedUrl.searchParams.get("input");
    expect(inputParam).not.toBeNull();
    if (inputParam === null) throw new Error("missing canonical input query");
    const decodedInput: unknown = JSON.parse(inputParam);
    expect(decodedInput).toEqual({
      level: "pba_municipal",
      granularity: "seccion",
      totalVotes: 10_000,
      blankVotes: 0,
      annulledVotes: 0,
      unmodeledVotes: 0,
      unmodeledVoteBreakdown: [],
      seatsToFill: 9,
      councilTotal: 18,
      isProjection: true,
      lists: [
        { listId: "list-1", listName: "Lista A", votes: 6_000 },
        { listId: "list-2", listName: "Lista B", votes: 4_000 },
      ],
    });
    expect(decodedInput).not.toHaveProperty("method");

    const result = page.getByRole("region", {
      name: "Resultado de la asignación",
    });
    await expect(
      result.getByRole("heading", { name: "Resultado (municipal de PBA)" }),
    ).toBeVisible();
    await expect(result).toContainText(
      "Proyección hipotética aportada por quien realiza la consulta",
    );
    await expect(
      result.getByRole("status", { name: "granularidad: seccion" }),
    ).toBeVisible();
    await expect(result).toContainText(
      /Huella de los datos proporcionados \(no es procedencia de archivo\): sha256 [a-f0-9]{64}/,
    );
    await expect(
      result.getByRole("heading", { name: "Cociente Hare con mayor residuo" }),
    ).toBeVisible();
    await expect(result).toContainText("Método legal: Ley 5109, arts. 109–110");

    const allocationScroll = result.getByRole("region", {
      name: "Asignación Hare por lista",
    });
    const allocationTable = allocationScroll.getByRole("table", {
      name: "Asignación Hare por lista",
    });
    const listARow = allocationTable
      .getByRole("rowheader", { name: "Lista A", exact: true })
      .locator("..");
    const listBRow = allocationTable
      .getByRole("rowheader", { name: "Lista B", exact: true })
      .locator("..");
    await expect(listARow.getByRole("cell").last()).toHaveText("5");
    await expect(listBRow.getByRole("cell").last()).toHaveText("4");

    await expect(result.getByRole("link", { name: /archivo|fuente/i })).toHaveCount(
      0,
    );
    await expect(result).not.toContainText("Resultado histórico oficial");
    await expect(result).not.toContainText("D’Hondt");
    await expectNoHorizontalOverflow(page);

    for (const evidenceLabel of [
      "Asignación Hare por lista",
      "Evidencia de asignación por banca",
    ]) {
      const evidenceScroll = result.getByRole("region", {
        name: evidenceLabel,
      });
      await expect(evidenceScroll).toBeVisible();
      await expect(evidenceScroll).toHaveAttribute("tabindex", "0");
      await evidenceScroll.focus();
      await expect(evidenceScroll).toBeFocused();
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/simulate");
    await expect(page).toHaveURL(/\/simulate$/);
    const desktopForm = page.getByRole("form", {
      name: "Formulario de simulación de bancas",
    });
    await expect(desktopForm).toBeVisible();
    await expect(desktopForm.getByRole("group")).toHaveCount(3);
    const desktopGeometry = await desktopForm.evaluate((element) => {
      const rectangle = element.getBoundingClientRect();
      return {
        left: rectangle.left,
        right: rectangle.right,
        width: rectangle.width,
        viewportWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    expect(desktopGeometry.left).toBeGreaterThanOrEqual(0);
    expect(desktopGeometry.width).toBeGreaterThan(0);
    expect(desktopGeometry.right).toBeLessThanOrEqual(
      desktopGeometry.viewportWidth,
    );
    expect(desktopGeometry.scrollWidth).toBeLessThanOrEqual(
      desktopGeometry.clientWidth,
    );
  });
});
