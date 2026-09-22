import { expect, test, type Locator, type Page } from "@playwright/test";

interface ElementRectangle {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

async function elementRectangle(locator: Locator): Promise<ElementRectangle> {
  return locator.evaluate((element) => {
    const rectangle = element.getBoundingClientRect();
    return {
      bottom: rectangle.bottom,
      left: rectangle.left,
      right: rectangle.right,
      top: rectangle.top,
    };
  });
}

async function expectBoundedSection(locator: Locator): Promise<void> {
  const bounds = await locator.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      borderWidth: Number.parseFloat(styles.borderTopWidth),
      paddingBlock: Number.parseFloat(styles.paddingTop),
      paddingInline: Number.parseFloat(styles.paddingLeft),
    };
  });

  expect(bounds.borderWidth).toBeGreaterThan(0);
  expect(bounds.paddingBlock).toBeGreaterThan(0);
  expect(bounds.paddingInline).toBeGreaterThan(0);
}

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
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/dashboard");
    await expect(page).toHaveURL(new URL("/", page.url()).toString());

    const drawerTrigger = page.getByRole("button", {
      name: "Abrir navegación",
    });
    await expect(drawerTrigger).toBeVisible();
    await expect(drawerTrigger).toHaveAttribute("aria-expanded", "false");
    await drawerTrigger.click();

    const drawer = page.getByRole("dialog", {
      name: "Navegación principal",
    });
    const simulationNavigationLink = drawer.getByRole("link", {
      name: "Simulación 2027",
      exact: true,
    });
    await expect(drawer).toBeVisible();
    await simulationNavigationLink.click();
    await expect(page).toHaveURL(/\/simulate$/);
    await expect(drawer).toBeHidden();
    await expect(drawerTrigger).toHaveAttribute("aria-expanded", "false");

    await drawerTrigger.click();
    await expect(drawer).toBeVisible();
    const currentSimulationNavigationLink = drawer.getByRole("link", {
      name: "Simulación 2027",
      exact: true,
    });
    await expect(currentSimulationNavigationLink).toHaveAttribute(
      "aria-current",
      "page",
    );
    await drawer.getByRole("button", { name: "Cerrar navegación" }).click();
    await expect(drawer).toBeHidden();

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

    const electionSection = form.getByRole("group", {
      name: "Elección y alcance",
    });
    const totalsSection = form.getByRole("group", {
      name: "Totales del escenario",
    });
    const listsSection = form.getByRole("group", {
      name: "Listas y votos",
    });
    const municipalConfiguration = form.getByRole("region", {
      name: "Concejo configurado",
    });
    const mobileSections = [
      electionSection,
      municipalConfiguration,
      totalsSection,
      listsSection,
    ];
    for (const section of mobileSections) await expectBoundedSection(section);

    const mobileSectionRectangles = await Promise.all(
      mobileSections.map(elementRectangle),
    );
    for (let index = 1; index < mobileSectionRectangles.length; index += 1) {
      expect(mobileSectionRectangles[index]!.top).toBeGreaterThan(
        mobileSectionRectangles[index - 1]!.bottom,
      );
    }

    const firstListEditor = listsSection
      .getByRole("heading", { name: "Lista 1" })
      .locator("..");
    const firstListRemove = firstListEditor.getByRole("button", {
      name: "Quitar lista 1",
    });
    await expect(firstListRemove).toBeVisible();
    const mobileListGeometry = await listsSection.evaluate((section) => {
      const sectionStyles = getComputedStyle(section);
      const sectionRectangle = section.getBoundingClientRect();
      const listEditor = section.querySelector("h3")?.parentElement;
      if (!listEditor) throw new Error("missing first list editor");
      const listRectangle = listEditor.getBoundingClientRect();
      return {
        contentLeft:
          sectionRectangle.left +
          Number.parseFloat(sectionStyles.borderLeftWidth) +
          Number.parseFloat(sectionStyles.paddingLeft),
        contentRight:
          sectionRectangle.right -
          Number.parseFloat(sectionStyles.borderRightWidth) -
          Number.parseFloat(sectionStyles.paddingRight),
        listLeft: listRectangle.left,
        listRight: listRectangle.right,
      };
    });
    expect(mobileListGeometry.listLeft).toBeCloseTo(
      mobileListGeometry.contentLeft,
      0,
    );
    expect(mobileListGeometry.listRight).toBeCloseTo(
      mobileListGeometry.contentRight,
      0,
    );

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
    await expectNoHorizontalOverflow(page);

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

    const validationAlert = page.getByRole("main").getByRole("alert");
    await expect(validationAlert).toHaveCount(1);
    await expect(validationAlert).toContainText(
      /totales|reglas|consistentes/i,
    );
    await expect(form.getByLabel("Total de votos")).toHaveValue("9000");
    await expect(listNames.nth(0)).toHaveValue("Lista A");
    await expect(listVotes.nth(0)).toHaveValue("6000");
    await expect(listNames.nth(1)).toHaveValue("Lista B");
    await expect(listVotes.nth(1)).toHaveValue("4000");

    await form.getByLabel("Total de votos").fill("10000");
    await expect.poll(() => {
      const input = new URL(page.url()).searchParams.get("input");
      return input ? JSON.parse(input).totalVotes : null;
    }).toBe(10000);
    await expect(form.getByRole("button", { name: "Simular bancas" })).toHaveCount(0);
    await expect(form.getByLabel("Total de votos")).toBeFocused();

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
    const seatChart = result.getByRole("region", { name: "Distribución de bancas", exact: true });
    await expect(seatChart).toBeVisible();
    await expect(seatChart).toContainText("Lista A");
    await expect(seatChart).toContainText("Lista B");
    await expect(seatChart).toContainText(/9/);
    // Invalid edits remove the preceding result immediately, including its trace.
    await listVotes.nth(0).fill("");
    await expect(result).toHaveCount(0);
    await expect(page.getByText(/Huella de los datos proporcionados/)).toHaveCount(0);
    await expect(listVotes.nth(0)).toBeFocused();
    await listVotes.nth(0).fill("5000");
    await listVotes.nth(0).fill("6000");
    await expect(result).toBeVisible();
    await expect(listARow.getByRole("cell").last()).toHaveText("5");
    await expect(listVotes.nth(0)).toHaveValue("6000");
    await expect(listVotes.nth(0)).toBeFocused();
    await listVotes.nth(0).fill("8000");
    await listVotes.nth(1).fill("2000");
    await expect(listARow.getByRole("cell").last()).toHaveText("7");
    await expect(listBRow.getByRole("cell").last()).toHaveText("2");
    await expect(seatChart).toBeVisible();
    await listVotes.nth(0).fill("6000");
    await listVotes.nth(1).fill("4000");
    await expect(listARow.getByRole("cell").last()).toHaveText("5");
    await expect(listBRow.getByRole("cell").last()).toHaveText("4");
    await page.reload();
    await expect(listNames.nth(0)).toHaveValue("Lista A");
    await expect(listVotes.nth(0)).toHaveValue("6000");
    await expect(seatChart).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expectNoHorizontalOverflow(page);


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

    await page.setViewportSize({ width: 320, height: 720 });
    await expectNoHorizontalOverflow(page);
    await expect(seatChart).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(result.getByRole("heading", { name: "Resultado (municipal de PBA)" })).toHaveCSS("font-size", "20px");
    await page.goto("/simulate");
    await expect(page).toHaveURL(/\/simulate$/);
    const desktopForm = page.getByRole("form", {
      name: "Formulario de simulación de bancas",
    });
    await expect(desktopForm).toBeVisible();
    await expect(desktopForm.getByRole("group")).toHaveCount(3);
    const desktopSections = [
      desktopForm.getByRole("group", { name: "Elección y alcance" }),
      desktopForm.getByRole("region", { name: "Concejo configurado" }),
      desktopForm.getByRole("group", { name: "Totales del escenario" }),
      desktopForm.getByRole("group", { name: "Listas y votos" }),
    ];
    for (const section of desktopSections) await expectBoundedSection(section);

    const desktopSectionRectangles = await Promise.all(
      desktopSections.map(elementRectangle),
    );
    const firstDesktopSection = desktopSectionRectangles[0]!;
    for (const section of desktopSectionRectangles.slice(1)) {
      expect(section.left).toBeCloseTo(firstDesktopSection.left, 0);
      expect(section.right).toBeCloseTo(firstDesktopSection.right, 0);
    }
    for (let index = 1; index < desktopSectionRectangles.length; index += 1) {
      expect(desktopSectionRectangles[index]!.top).toBeGreaterThan(
        desktopSectionRectangles[index - 1]!.bottom,
      );
    }

    const desktopListsSection = desktopSections[3]!;
    const desktopListEditor = desktopListsSection
      .getByRole("heading", { name: "Lista 1" })
      .locator("..");
    await expect(
      desktopListEditor.getByRole("button", { name: "Quitar lista 1" }),
    ).toBeVisible();
    const desktopListGeometry = await desktopListsSection.evaluate((section) => {
      const sectionStyles = getComputedStyle(section);
      const sectionRectangle = section.getBoundingClientRect();
      const listEditor = section.querySelector("h3")?.parentElement;
      if (!listEditor) throw new Error("missing first list editor");
      const listRectangle = listEditor.getBoundingClientRect();
      return {
        contentLeft:
          sectionRectangle.left +
          Number.parseFloat(sectionStyles.borderLeftWidth) +
          Number.parseFloat(sectionStyles.paddingLeft),
        contentRight:
          sectionRectangle.right -
          Number.parseFloat(sectionStyles.borderRightWidth) -
          Number.parseFloat(sectionStyles.paddingRight),
        listLeft: listRectangle.left,
        listRight: listRectangle.right,
      };
    });
    expect(desktopListGeometry.listLeft).toBeCloseTo(
      desktopListGeometry.contentLeft,
      0,
    );
    expect(desktopListGeometry.listRight).toBeCloseTo(
      desktopListGeometry.contentRight,
      0,
    );

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


test("preserves a rich supplied scenario until another scenario is explicitly started", async ({ page }) => {
  const input = {
    level: "pba_municipal",
    voteTotals: { kind: "valid_votes_only", validVotes: 10000 },
    unmodeledVotes: 1000,
    unmodeledVoteBreakdown: [{ reason: "omitted_non_qualifying_lists", votes: 1000 }],
    seatsToFill: 9, councilTotal: 18, isProjection: true, granularity: "seccion",
    lists: [
      { listId: "provided-a", listName: "Lista A", votes: 6000 },
      { listId: "provided-b", listName: "Lista B", votes: 3000 },
    ],
  };
  const query = new URLSearchParams({ input: JSON.stringify(input) });
  await page.goto(`/simulate?${query.toString()}`);
  const suppliedUrl = page.url();
  const result = page.getByRole("region", { name: "Resultado de la asignación" });
  await expect(page.getByText("Escenario proporcionado", { exact: true })).toBeVisible();
  await expect(result).toContainText("1.000 explícitamente fuera del modelo");
  await expect(result.getByRole("region", { name: "Distribución de bancas", exact: true })).toBeVisible();
  await expect(page.getByRole("form", { name: "Formulario de simulación de bancas" })).toHaveCount(0);
  await page.reload();
  await expect(page).toHaveURL(suppliedUrl);
  await expect(result).toContainText("1.000 explícitamente fuera del modelo");
  await page.getByRole("button", { name: "Crear otro escenario", exact: true }).click();
  await expect(page.getByRole("form", { name: "Formulario de simulación de bancas" })).toBeVisible();
  await expect(result).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Nombre de la lista" }).first()).toHaveValue("");
  await expect(page).toHaveURL(/\/simulate$/);
});

test("restores the served scenario while a superseded response is pending", async ({ page }) => {
  await page.clock.install();
  await page.goto("/simulate");
  const form = page.getByRole("form", { name: "Formulario de simulación de bancas" });
  const names = form.getByLabel("Nombre de la lista");
  const votes = form.getByLabel("Votos de la lista");
  await names.first().fill("Lista A");
  await votes.first().fill("6000");
  await form.getByRole("button", { name: "Agregar lista" }).click();
  await names.nth(1).fill("Lista B");
  await votes.nth(1).fill("4000");
  await form.getByLabel("Total de votos").fill("10000");
  const result = page.getByRole("region", { name: "Resultado de la asignación" });
  const chart = result.getByRole("region", { name: "Distribución de bancas", exact: true });
  const trace = result.getByText(/Huella de los datos proporcionados/);
  await expect(chart).toBeVisible();
  const servedUrl = page.url();
  const servedTrace = await trace.innerText();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));

  let responseReady = false;
  let responseDelivered = false;
  let releaseResponse: () => void = () => {};
  const responseDelay = new Promise<void>((resolve) => { releaseResponse = resolve; });
  await page.route("**/simulate?**", async (route) => {
    const input = new URL(route.request().url()).searchParams.get("input");
    if (!input?.includes('"listName":"Lista pendiente"')) {
      await route.continue();
      return;
    }
    // Delay the actual server response, not a fabricated result or calculation.
    const response = await route.fetch();
    responseReady = true;
    await responseDelay;
    await route.fulfill({ response });
    responseDelivered = true;
  });
  try {
    await names.first().fill("Lista pendiente");
    await expect(result).toHaveCount(0);
    await expect(page.getByText(/Huella de los datos proporcionados/)).toHaveCount(0);
    await page.clock.runFor(400);
    await expect.poll(() => responseReady).toBe(true);
    await names.first().fill("Lista A");
    await expect(result).toHaveCount(0);
    await expect(names.first()).toBeFocused();
    await page.clock.runFor(400);
    await expect(names.first()).toHaveValue("Lista A");
    releaseResponse();
    await expect.poll(() => responseDelivered).toBe(true);
    await page.clock.resume();
    await expect(chart).toBeVisible();
    await expect(page).toHaveURL(servedUrl);
    await expect(names.first()).toHaveValue("Lista A");
    await expect(names.first()).toBeFocused();
    await expect(chart.getByRole("img", { name: "Lista A: 5 de 9 bancas", exact: true })).toBeVisible();
    await expect(chart.getByRole("img", { name: "Lista B: 4 de 9 bancas", exact: true })).toBeVisible();
    await expect(result).not.toContainText("Lista pendiente");
    await expect(trace).toHaveText(servedTrace);
    const allocation = result.getByRole("table", { name: "Asignación Hare por lista" });
    await expect(allocation.getByRole("rowheader", { name: "Lista A", exact: true }).locator("..").getByRole("cell").last()).toHaveText("5");
    await expect(allocation.getByRole("rowheader", { name: "Lista B", exact: true }).locator("..").getByRole("cell").last()).toHaveText("4");
  } finally {
    releaseResponse();
    await page.clock.resume();
    await page.unrouteAll({ behavior: "wait" });
  }
});
