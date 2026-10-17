import { isDeepStrictEqual } from "node:util";
import { writeFile } from "node:fs/promises";
import { formatCount } from "../src/lib/format/number";
import { type Locator, type Page, type Request } from "@playwright/test";
import { expect, test } from "./onboarded-test";
import { writeSimulateBackRestore } from "./simulate-back-restore";
import { expectMobileFormGeometry } from "./mobile-form-geometry";

for (const width of [320, 390]) {
  test(`all three simulation forms remain usable at ${width}px (#463)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/scenarios");
    await page.getByTestId("scenario-persistencia").getByRole("link", { name: "Editar este escenario" }).click();
    await expect(page.getByTestId("allocation-result")).toBeVisible();
    await openSimulationDisclosure(page, "Editar los datos del escenario");
    await openSimulationDisclosure(page, "Sensibilidad de la transferencia");
    for (const name of ["Formulario de simulación de bancas", "Transferencia de votos a total fijo", "Muestreo de transferencias a total fijo"]) {
      await expect(page.getByRole("form", { name, exact: true })).toBeVisible();
    }
    const donor = page.locator("#transfer-donor");
    const lastOption = await donor.locator("option").last().getAttribute("value");
    expect(lastOption).not.toBeNull();
    await donor.selectOption(lastOption!);
    await expect(donor.locator("..").locator("[data-mobile-select-value]")).toHaveText(await donor.locator("option:checked").innerText());
    // Box helper assertions at this call site; the reporter otherwise classifies
    // their source locations as foreign to the spec and cannot identify the step.
    await test.step("Geometría móvil de los tres formularios", async () => {
      await expectMobileFormGeometry(page, page.locator(".app-shell__workspace"));
    }, { box: true });
    // Controlled changes alone must not submit the transfer or hide allocation evidence.
    await expect(page.getByTestId("allocation-result")).toBeVisible();
  });
}

test("Escenarios opens editable projections with scenario provenance", async ({ page }) => {
  for (const [id, name] of [["persistencia", "Persistencia"], ["transferencias_ei", "Transferencias estimadas por inferencia ecológica"]]) {
    await page.goto("/scenarios");
    await page.getByTestId(`scenario-${id}`).getByRole("link", { name: "Editar este escenario" }).click();
    await expect(page).toHaveURL(/\/simulate\?scenario=/);
    const provenance = page.getByRole("region", { name: "Procedencia del escenario" });
    await expect(provenance).toContainText(name!);
    await expect(provenance).toContainText("no es un resultado oficial");
    if (id === "transferencias_ei") await expect(provenance).toContainText("mayores restos");
    await openSimulationDisclosure(page, "Editar los datos del escenario");
    const votes = page.getByLabel("Votos de la lista", { exact: true });
    await expect(votes).toHaveCount(8);
    const values = await votes.evaluateAll((inputs) => inputs.map((input) => Number((input as HTMLInputElement).value)));
    expect(values.reduce((sum, value) => sum + value, 0)).toBe(32291);
    if (id === "persistencia") expect(values).toEqual([14550, 7300, 4540, 1788, 1512, 1384, 1027, 190]);
    await expect(page.getByTestId("allocation-result")).toBeVisible();
  }
});

async function openSimulationDisclosure(page: Page, name: string): Promise<void> {
  const summary = page.locator("details > summary").filter({ hasText: name });
  await expect(summary).toBeVisible();
  const details = summary.locator("..");
  if (!await details.evaluate((element) => (element as HTMLDetailsElement).open)) {
    // Opening supporting evidence must not disturb the editor-focus assertions.
    const previousFocus = await page.evaluateHandle(() => document.activeElement);
    await summary.click();
    await previousFocus.evaluate((element) => {
      if (element instanceof HTMLElement && element.isConnected && element !== document.body) element.focus();
    });
    await previousFocus.dispose();
  }
}

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

test("compares server-calculated base and scenario, switches distribution and resets at desktop and mobile widths", async ({ page }) => {
  const input = {
    level: "pba_municipal", totalVotes: 10000, blankVotes: 0, annulledVotes: 0,
    unmodeledVotes: 0, unmodeledVoteBreakdown: [], seatsToFill: 9,
    isProjection: true, granularity: "seccion",
    lists: [{ listId: "A", listName: "Lista A", votes: 6000 }, { listId: "B", listName: "Lista B", votes: 4000 }],
  };
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/simulate?${new URLSearchParams({ input: JSON.stringify(input) })}`);
    const transfer = page.getByRole("form", { name: "Transferencia de votos a total fijo" });
    await transfer.getByLabel("Lista donante").selectOption("A");
    await transfer.getByLabel("Lista receptora").selectOption("B");
    await transfer.getByLabel("Cantidad a transferir").fill("2000");
    await transfer.getByRole("button", { name: "Transferir votos", exact: true }).click();
    await expect(page.getByRole("region", { name: "Comparación exacta de base y escenario", exact: true })).toContainText("−2.000");
    await page.reload();
    const view = page.getByRole("group", { name: "Vista de la distribución", exact: true });
    const impact = page.getByRole("complementary", { name: "Construir el supuesto", exact: true });
    await expect(impact.getByRole("region", { name: "Bancas calculadas: 9 de 9", exact: true })).toBeVisible();
    await expect(impact).toContainText("Divisor Hare: 9 bancas renovadas, no 18 bancas totales");
    await expect(impact.getByRole("img", { name: "Lista A: 4 de 9 bancas", exact: true })).toBeVisible();
    await view.getByRole("button", { name: "Base", exact: true }).click();
    await expect(view.getByRole("button", { name: "Base", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(impact.getByRole("img", { name: "Lista A: 5 de 9 bancas", exact: true })).toBeVisible();
    await view.getByRole("button", { name: "Escenario", exact: true }).click();
    await expect(impact.getByRole("img", { name: "Lista A: 4 de 9 bancas", exact: true })).toBeVisible();
    await impact.getByRole("link", { name: "Restablecer base", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.has("baseInput")).toBe(false);
    await expect(impact.getByRole("img", { name: "Lista A: 5 de 9 bancas", exact: true })).toBeVisible();
    expect(JSON.parse(new URL(page.url()).searchParams.get("input")!)).toEqual(input);
    await expectNoHorizontalOverflow(page);
  }
});

test.describe("the simulation route labels caller-supplied projections", () => {
  test("test_projection_form_reaches_the_municipal_hare_result", async ({
    page,
  }, testInfo) => {
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
      name: "Simulación",
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
      name: "Simulación",
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
    await expect(page.getByRole("region", { name: "Laboratorio territorial", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Geografía no disponible", exact: true })).toBeVisible();
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

    await form.getByLabel("Nivel", { exact: true }).selectOption("seccion");
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

    await openSimulationDisclosure(page, "Cómo se asignaron las bancas");
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
      result.getByRole("status", { name: "granularidad: sección" }),
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
    const seatChart = page.getByRole("complementary", { name: "Construir el supuesto" }).getByRole("region", { name: "Distribución de bancas", exact: true });
    await expect(seatChart).toBeVisible();
    await expect(seatChart).toContainText("Lista A");
    await expect(seatChart).toContainText("Lista B");
    await expect(seatChart).toContainText(/9/);
    await seatChart.getByText("Cómo leer la distribución", { exact: true }).click();
    const listASeats = seatChart.getByRole("img", { name: "Detalle de Lista A: 5 de 9 bancas", exact: true });
    const listBSeats = seatChart.getByRole("img", { name: "Detalle de Lista B: 4 de 9 bancas", exact: true });
    await expect(listASeats.locator('[data-seat-state="awarded"]')).toHaveCount(5);
    await expect(listASeats.locator('[data-seat-state="empty"]')).toHaveCount(4);
    await expect(listBSeats.locator('[data-seat-state="awarded"]')).toHaveCount(4);
    const originalTrace = await result.getByText(/Huella de los datos proporcionados/).innerText();
    // Invalid edits remove the preceding result immediately, including its trace.
    await listVotes.nth(0).fill("");
    await expect(result).toHaveCount(0);
    await expect(page.getByText(/Huella de los datos proporcionados/)).toHaveCount(0);
    await expect(listVotes.nth(0)).toBeFocused();
    await listVotes.nth(0).fill("5000");
    await listVotes.nth(0).fill("6000");
    await expect(result).toBeVisible();
    await openSimulationDisclosure(page, "Cómo se asignaron las bancas");
    await expect(listARow.getByRole("cell").last()).toHaveText("5");
    await expect(listVotes.nth(0)).toHaveValue("6000");
    await expect(listVotes.nth(0)).toBeFocused();
    await listVotes.nth(0).fill("8000");
    await listVotes.nth(1).fill("2000");
    await openSimulationDisclosure(page, "Cómo se asignaron las bancas");
    await expect(listARow.getByRole("cell").last()).toHaveText("7");
    await expect(listBRow.getByRole("cell").last()).toHaveText("2");
    await expect(seatChart).toBeVisible();
    await listVotes.nth(0).fill("6000");
    await listVotes.nth(1).fill("4000");
    await openSimulationDisclosure(page, "Cómo se asignaron las bancas");
    await expect(listARow.getByRole("cell").last()).toHaveText("5");
    await expect(listBRow.getByRole("cell").last()).toHaveText("4");
    await page.reload();
    await openSimulationDisclosure(page, "Editar los datos del escenario");
    await openSimulationDisclosure(page, "Cómo se asignaron las bancas");
    // Reload restores native disclosures to closed; role locators exclude their contents.
    await seatChart.getByText("Cómo leer la distribución", { exact: true }).click();
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

    const awardsScroll = result.getByRole("region", { name: "Evidencia de asignación por banca", exact: true });
    // Inspect DOM order, then traverse it with real keys from one known start.
    expect(await result.locator('[tabindex="0"]').evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("aria-label")),
    )).toEqual(["Asignación Hare por lista", "Evidencia de asignación por banca"]);
    await allocationScroll.focus();
    await expect(allocationScroll).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(awardsScroll).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(allocationScroll).toBeFocused();

    await page.setViewportSize({ width: 320, height: 720 });
    await expectNoHorizontalOverflow(page);
    await expect(seatChart).toBeVisible();
    await expect(listASeats.locator('[data-seat-state="awarded"]')).toHaveCount(5);
    await expect(result.getByText(/Huella de los datos proporcionados/)).toHaveText(originalTrace);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(listBSeats.locator('[data-seat-state="awarded"]')).toHaveCount(4);
    await expectNoHorizontalOverflow(page);
    await expect(result.getByRole("heading", { name: "Resultado (municipal de PBA)" })).toHaveCSS("font-size", "20px");
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    const awardedBlock = listASeats.locator('[data-seat-state="awarded"]').first();
    const emptyBlock = listASeats.locator('[data-seat-state="empty"]').first();
    // Global reduced-motion policy caps durations at 0.01ms, not exact zero.
    const reducedMotionLimitSeconds = 0.00001;
    for (const block of [awardedBlock, emptyBlock]) {
      const motion = await block.evaluate((element) => ({
        state: element.getAttribute("data-seat-state"),
        styles: [null, "::after"].map((pseudo) => {
          const style = getComputedStyle(element, pseudo);
          return {
            pseudo, transition: style.transitionDuration, animation: style.animationDuration,
            transitionDelay: style.transitionDelay, animationDelay: style.animationDelay,
            name: style.animationName,
          };
        }),
        effects: element.getAnimations({ subtree: true }).map((animation) => ({
          state: animation.playState, pending: animation.pending,
          timing: animation.effect?.getTiming(), computed: animation.effect?.getComputedTiming(),
        })),
      }));
      const diagnostic = `Seat relief motion: ${JSON.stringify(motion)}`;
      for (const style of motion.styles) {
        for (const durations of [style.transition, style.animation]) {
          for (const duration of durations.split(",")) {
            expect(Number.parseFloat(duration), diagnostic).toBeGreaterThanOrEqual(0);
            expect(Number.parseFloat(duration), diagnostic).toBeLessThanOrEqual(reducedMotionLimitSeconds);
          }
        }
        expect(style.name, diagnostic).toBe("none");
        for (const delays of [style.transitionDelay, style.animationDelay]) {
          expect(delays.split(",").map(Number.parseFloat), diagnostic).toEqual(delays.split(",").map(() => 0));
        }
      }
      for (const effect of motion.effects) {
        expect(effect.pending, diagnostic).toBe(false);
        expect(effect.state, diagnostic).not.toBe("running");
        expect(effect.state, diagnostic).not.toBe("paused");
        expect(effect.timing?.delay, diagnostic).toBe(0);
        expect(effect.timing?.endDelay, diagnostic).toBe(0);
        expect(effect.computed?.activeDuration, diagnostic).toBeLessThanOrEqual(reducedMotionLimitSeconds * 1000);
      }
    }
    // One capture batch before navigation clears the actual served result.
    for (const [name, width] of [["desktop", 1280], ["mobile", 320]] as const) {
      await page.setViewportSize({ width, height: 800 });
      await expect(listASeats.locator('[data-seat-state="awarded"]')).toHaveCount(5);
      await expect(listBSeats.locator('[data-seat-state="awarded"]')).toHaveCount(4);
      await expect(municipalConfiguration).toContainText(/18 bancas/);
      await expect(result.getByText(/Huella de los datos proporcionados/)).toHaveText(originalTrace);
      await expectNoHorizontalOverflow(page);
      await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
      const capturePath = testInfo.outputPath(`seat-relief-municipal-${name}.png`);
      await page.screenshot({ path: capturePath, fullPage: true, animations: "disabled" });
      await testInfo.attach(`seat-relief-municipal-${name}`, { path: capturePath, contentType: "image/png" });
    }
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
    const faces = await Promise.all([awardedBlock, emptyBlock].map((block) => block.evaluate((element) => {
      const style = getComputedStyle(element);
      const face = getComputedStyle(element, "::after");
      return {
        outline: style.borderTopStyle, width: Number.parseFloat(style.borderTopWidth), background: style.backgroundColor,
        faceContent: face.content, faceBorder: face.borderTopStyle, faceHeight: Number.parseFloat(face.height),
      };
    })));
    expect(faces[0]!.outline).toBe("solid");
    expect(faces[1]!.outline).toBe("dashed");
    expect(faces.every((face) => face.width > 0)).toBe(true);
    expect(faces[0]!.background).not.toBe(faces[1]!.background);
    expect(faces[0]!.faceContent).not.toBe("none");
    expect(faces[0]!.faceBorder).toBe("solid");
    expect(faces[0]!.faceHeight).toBeGreaterThan(0);
    expect(faces[1]!.faceContent).toBe("none");
    await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 800 });
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


test.describe("simulation operation focus (#601)", () => {
  test.beforeAll(async ({ browser }, testInfo) => {
    const factsPath = testInfo.outputPath("e2e-facts-simulation-browser.json");
    await writeFile(factsPath, JSON.stringify({ version: browser.version() }));
    await testInfo.attach("simulation-browser-version", {
      path: factsPath,
      contentType: "application/json",
    });
  });

  const input = {
    level: "pba_municipal", totalVotes: 10000, blankVotes: 0, annulledVotes: 0,
    unmodeledVotes: 0, unmodeledVoteBreakdown: [], seatsToFill: 9,
    isProjection: true, granularity: "seccion",
    lists: [{ listId: "A", listName: "Lista A", votes: 6000 }, { listId: "B", listName: "Lista B", votes: 4000 }],
  };

  for (const operation of ["transfer", "sensitivity", "reset"] as const) {
    test(`keyboard ${operation} preserves controls while pending and focuses a stable target after completion`, async ({ page }) => {
      await page.goto(`/simulate?${new URLSearchParams({ input: JSON.stringify(input) })}`);
      const transfer = page.getByRole("form", { name: "Transferencia de votos a total fijo", exact: true });
      const transferButton = transfer.getByRole("button", { name: "Transferir votos", exact: true });
      if (operation === "reset") {
        // Arrange a served comparison before testing the reset operation itself.
        await transfer.getByLabel("Lista donante").selectOption("A");
        await transfer.getByLabel("Lista receptora").selectOption("B");
        await transfer.getByLabel("Cantidad a transferir").fill("1000");
        await transferButton.click();
        await expect(page.getByRole("region", { name: "Comparación exacta de base y escenario", exact: true })).toBeVisible();
        await page.reload();
      }
      await openSimulationDisclosure(page, "Sensibilidad de la transferencia");
      const sweep = page.getByRole("form", { name: "Muestreo de transferencias a total fijo", exact: true });
      const sweepButton = sweep.getByRole("button", { name: "Evaluar muestras", exact: true });
      const reset = page.getByRole("link", { name: "Restablecer base", exact: true });
      if (operation === "transfer") {
        await transfer.getByLabel("Lista donante").selectOption("A");
        await transfer.getByLabel("Lista receptora").selectOption("B");
        await transfer.getByLabel("Cantidad a transferir").fill("1000");
        await page.keyboard.press("Tab");
        await expect(transferButton).toBeFocused();
      } else if (operation === "sensitivity") {
        await sweep.getByLabel("Donante del muestreo").selectOption("A");
        await sweep.getByLabel("Receptora del muestreo").selectOption("B");
        await sweep.getByLabel("Máximo a transferir").fill("1000");
        await sweep.getByLabel("Paso del muestreo").fill("500");
        await page.keyboard.press("Tab");
        await expect(sweepButton).toBeFocused();
      } else {
        // Tab from the transfer submit through its help disclosure to reset.
        await transfer.getByLabel("Cantidad a transferir").focus();
        await page.keyboard.press("Tab");
        await page.keyboard.press("Tab");
        await page.keyboard.press("Tab");
        await expect(reset).toBeFocused();
      }

      // Hold the real RSC navigation so pending visibility is deterministic,
      // rather than hoping to observe a fast local server between renders.
      let navigationHeld = false;
      let releaseNavigation!: () => void;
      const navigationReleased = new Promise<void>((resolve) => { releaseNavigation = resolve; });
      await page.route("**/simulate?**", async (route) => {
        if (route.request().headers()["rsc"] !== "1") return route.continue();
        navigationHeld = true;
        await navigationReleased;
        await route.continue();
      });
      const previousUrl = page.url();
      try {
        await page.keyboard.press("Enter");
        await expect.poll(() => navigationHeld).toBe(true);
        await expect(transfer).toBeVisible();
        await expect(sweep).toBeVisible();
        // Stale allocation evidence must disappear, not the operation controls.
        await expect(page.getByTestId("allocation-result")).not.toBeVisible();
        await expect(page.getByRole("region", { name: "Comparación exacta de base y escenario", exact: true })).not.toBeVisible();
      } finally {
        releaseNavigation();
      }
      await expect(page).not.toHaveURL(previousUrl);
      await expect(page.getByTestId("allocation-result")).toBeVisible();
      if (operation === "transfer") {
        await expect(transferButton).toBeFocused();
        await expect.poll(() => JSON.parse(new URL(page.url()).searchParams.get("input")!).lists[0].votes).toBe(5000);
      } else if (operation === "sensitivity") {
        await expect(sweepButton).toBeFocused();
        await expect(page.getByRole("region", { name: "Resultados del muestreo", exact: true })).toContainText("3 muestras evaluadas");
      } else {
        await expect(page.getByRole("heading", { name: "Resultado (municipal de PBA)", exact: true })).toBeFocused();
        await expect.poll(() => new URL(page.url()).searchParams.has("baseInput")).toBe(false);
      }
    });
  }

  for (const operation of ["transfer", "sensitivity"] as const) {
    test(`keyboard ${operation} error keeps focus and announces validation without navigation`, async ({ page }) => {
      await page.goto(`/simulate?${new URLSearchParams({ input: JSON.stringify(input) })}`);
      if (operation === "sensitivity") await openSimulationDisclosure(page, "Sensibilidad de la transferencia");
      const isTransfer = operation === "transfer";
      const form = page.getByRole("form", { name: isTransfer ? "Transferencia de votos a total fijo" : "Muestreo de transferencias a total fijo", exact: true });
      await form.getByLabel(isTransfer ? "Lista donante" : "Donante del muestreo").selectOption("A");
      await form.getByLabel(isTransfer ? "Lista receptora" : "Receptora del muestreo").selectOption("B");
      await form.getByLabel(isTransfer ? "Cantidad a transferir" : "Máximo a transferir").fill("6001");
      if (!isTransfer) await form.getByLabel("Paso del muestreo").fill("1000");
      await page.keyboard.press("Tab");
      const submit = form.getByRole("button", { name: isTransfer ? "Transferir votos" : "Evaluar muestras", exact: true });
      await expect(submit).toBeFocused();
      // Polling only after the alert misses a transient disabled state: Chrome
      // may blur the submit before React finishes this synchronous validation.
      await submit.evaluate((button) => {
        button.setAttribute("data-focus-losses", "0");
        const record = () => button.setAttribute("data-focus-losses",
          String(Number(button.getAttribute("data-focus-losses")) + 1));
        button.addEventListener("blur", record, { once: true });
        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            // oldValue also catches disabled being removed in the same turn.
            if (mutation.oldValue !== null || button.hasAttribute("disabled")) record();
          }
        });
        observer.observe(button, { attributes: true, attributeFilter: ["disabled"], attributeOldValue: true });
      });
      const previousUrl = page.url();
      await page.keyboard.press("Enter");
      await expect(form.getByRole("alert")).toContainText("no puede superar");
      await expect(submit, "submit must remain focusable throughout validation").toHaveAttribute("data-focus-losses", "0");
      await expect(submit).toBeFocused();
      const announcement = form.locator(isTransfer ? "#transfer-errors" : "#sweep-errors");
      await expect(announcement).toHaveAttribute("aria-live", "polite");
      await expect(announcement).toHaveAttribute("aria-atomic", "true");
      await expect(announcement).toContainText("no puede superar");
      await expect(page).toHaveURL(previousUrl);
      await expect(page.getByTestId("allocation-result")).toBeVisible();
    });
  }
});

test("transfers a rich baseline losslessly with keyboard controls and resets after changes", async ({ page }) => {
  const input = {
    level: "pba_municipal", voteTotals: { kind: "valid_votes_only", validVotes: 10000 },
    unmodeledVotes: 1000,
    unmodeledVoteBreakdown: [{ reason: "omitted_non_qualifying_lists", votes: 1000 }],
    seatsToFill: 9, councilTotal: 18, isProjection: true, granularity: "seccion",
    lists: [
      { listId: "A", listName: "Lista A", votes: 6000 },
      { listId: "B", listName: "Lista B", votes: 3000 },
    ],
  };
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`/simulate?${new URLSearchParams({ input: JSON.stringify(input) })}`);
  const transfer = page.getByRole("form", { name: "Transferencia de votos a total fijo" });
  const result = page.getByRole("region", { name: "Resultado de la asignación" });
  await expect(transfer).toBeVisible();
  const baselineUrl = page.url();
  const baselineTrace = await result.getByText(/Huella de los datos proporcionados/).innerText();
  await expect(transfer.getByLabel("Lista donante")).toHaveValue("");
  await expect(transfer.getByLabel("Lista receptora")).toHaveValue("");
  await expect(transfer.getByLabel("Cantidad a transferir")).toHaveValue("0");
  await transfer.getByLabel("Lista donante").selectOption("A");
  await transfer.getByLabel("Lista receptora").selectOption("B");
  await transfer.getByRole("button", { name: "Transferir votos", exact: true }).click();
  await expect(page).toHaveURL(baselineUrl);
  await expect(result.getByText(/Huella de los datos proporcionados/)).toHaveText(baselineTrace);
  await expect(transfer).toHaveAttribute("aria-busy", "false");
  await expect(transfer.getByRole("button", { name: "Transferir votos", exact: true })).toBeEnabled();
  await transfer.getByLabel("Cantidad a transferir").fill("6001");
  await page.keyboard.press("Tab");
  await expect(transfer.getByRole("button", { name: "Transferir votos", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(transfer.getByRole("alert")).toContainText("no puede superar");
  await expect(page).toHaveURL(baselineUrl);
  // Retain the served baseline in same-document history before router.replace.
  await page.evaluate(() => window.history.pushState(null, "", window.location.href));
  const servedDocument = await page.evaluateHandle(() => document);
  await transfer.getByLabel("Cantidad a transferir").fill("1000");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect.poll(() => JSON.parse(new URL(page.url()).searchParams.get("input")!).lists[0].votes).toBe(5000);
  expect(JSON.parse(new URL(page.url()).searchParams.get("input")!)).toEqual({ ...input, lists: [
    { ...input.lists[0], votes: 5000 }, { ...input.lists[1], votes: 4000 },
  ] });
  await openSimulationDisclosure(page, "Cómo se asignaron las bancas");
  await expect(result).toContainText("1.000 explícitamente fuera del modelo");
  await expect(result.getByText(/Huella de los datos proporcionados/)).not.toHaveText(baselineTrace);
  await expect(result.getByRole("table", { name: "Asignación Hare por lista" })).toBeVisible();
  await expect(transfer.getByLabel("Lista donante")).toHaveValue("");
  await expect(transfer.getByLabel("Lista receptora")).toHaveValue("");
  await expect(transfer.getByLabel("Lista receptora").getByRole("option", {
    name: "Seleccione una lista", exact: true, selected: true,
  })).toHaveCount(1);
  await expect(transfer.getByLabel("Cantidad a transferir")).toHaveValue("0");
  await expectNoHorizontalOverflow(page);

  // Browser Back is external to the editor and restores a different complete baseline.
  await transfer.getByLabel("Lista donante").selectOption("A");
  await transfer.getByLabel("Lista receptora").selectOption("B");
  await transfer.getByLabel("Cantidad a transferir").fill("100");
  await expect(transfer.getByLabel("Lista donante")).toHaveValue("A");
  await expect(transfer.getByLabel("Lista receptora")).toHaveValue("B");
  await expect(transfer.getByLabel("Cantidad a transferir")).toHaveValue("100");
  await page.goBack();
  await expect(page).toHaveURL(baselineUrl);
  expect(await page.evaluate((previousDocument) => document === previousDocument, servedDocument)).toBe(true);
  await servedDocument.dispose();
  expect(JSON.parse(new URL(page.url()).searchParams.get("input")!)).toEqual(input);
  await expect(result.getByText(/Huella de los datos proporcionados/)).toHaveText(baselineTrace);
  await expect(transfer.getByLabel("Lista donante")).toHaveValue("");
  await expect(transfer.getByLabel("Lista receptora")).toHaveValue("");
  await expect(transfer.getByLabel("Cantidad a transferir")).toHaveValue("0");
  await expect(transfer.getByLabel("Lista donante").getByRole("option", {
    name: "Lista A — 6.000 votos", exact: true,
  })).toHaveText("Lista A — 6.000 votos");

  // A custom-editor baseline change must also discard a drafted operation.
  const custom = { ...input, voteTotals: undefined, totalVotes: 10000,
    blankVotes: 0, annulledVotes: 0, unmodeledVotes: 0, unmodeledVoteBreakdown: [],
    lists: [{ ...input.lists[0], votes: 6000 }, { ...input.lists[1], votes: 4000 }],
  };
  await page.goto(`/simulate?${new URLSearchParams({ input: JSON.stringify(custom),
    council: "Coronel de Marina Leonardo Rosales" })}`);
  await transfer.getByLabel("Lista donante").selectOption("A");
  await transfer.getByLabel("Lista receptora").selectOption("B");
  await transfer.getByLabel("Cantidad a transferir").fill("100");
  const editor = page.getByRole("form", { name: "Formulario de simulación de bancas" });
  await openSimulationDisclosure(page, "Editar los datos del escenario");
  await editor.getByLabel("Nombre de la lista").first().fill("Lista A editada");
  await expect.poll(() => JSON.parse(new URL(page.url()).searchParams.get("input")!).lists[0].listName).toBe("Lista A editada");
  await expect(transfer.getByLabel("Lista donante")).toHaveValue("");
  await expect(transfer.getByLabel("Lista receptora")).toHaveValue("");
  await expect(transfer.getByLabel("Cantidad a transferir")).toHaveValue("0");
});

test("samples fixed-total transfers, links exact evidence and resets on baseline changes at 320px", async ({ page }) => {
  const input = {
    level: "national", padron: 20000, totalVotes: 10000,
    unmodeledVotes: 0, unmodeledVoteBreakdown: [],
    threshold: { value: 0, basis: "padron" }, seatsToFill: 2,
    isProjection: true, granularity: "distrito",
    lists: [
      { listId: "A", listName: "Lista A", votes: 6000 },
      { listId: "B", listName: "Lista B", votes: 4000 },
      { listId: "C", listName: "Lista cero", votes: 0 },
    ],
  };
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`/simulate?${new URLSearchParams({ input: JSON.stringify(input) })}`);
  const sweep = page.getByRole("form", { name: "Muestreo de transferencias a total fijo" });
  const exact = page.getByRole("region", { name: "Resultado de la asignación" });
  await openSimulationDisclosure(page, "Sensibilidad de la transferencia");
  const trace = await exact.getByText(/Huella de los datos proporcionados/).innerText();
  const baselineUrl = page.url();
  await sweep.getByLabel("Donante del muestreo").selectOption("A");
  await sweep.getByLabel("Receptora del muestreo").selectOption("B");
  await sweep.getByLabel("Máximo a transferir").fill("21");
  await sweep.getByLabel("Paso del muestreo").fill("1");
  await sweep.getByRole("button", { name: "Evaluar muestras" }).click();
  await expect(sweep.getByRole("alert")).toContainText("21 muestras");
  await expect(page).toHaveURL(baselineUrl);
  await expect(exact.getByText(/Huella de los datos proporcionados/)).toHaveText(trace);
  await sweep.getByLabel("Máximo a transferir").fill("1000");
  await sweep.getByLabel("Paso del muestreo").fill("600");
  await sweep.getByRole("button", { name: "Evaluar muestras" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("sweepMax")).toBe("1000");
  await openSimulationDisclosure(page, "Sensibilidad de la transferencia");
  const samples = page.getByRole("region", { name: "Resultados del muestreo", exact: true });
  await expect(samples).toContainText("3 muestras evaluadas; 3 válidas; 0 rechazadas");
  await expect(samples).toContainText("Último intervalo más corto: 400 votos");
  const sampledTable = samples.getByRole("table", { name: "Muestras evaluadas", exact: true });
  await expect(sampledTable.getByRole("row")).toHaveCount(4);
  await expect(sampledTable.locator("tbody").getByRole("rowheader")).toHaveText([0, 600, 1000].map(formatCount));
  await expect(samples).toContainText("Sin probabilidades, garantías entre puntos ni umbral general para ganar bancas");
  for (const amount of [0, 600, 1000]) {
    const link = samples.getByRole("link", { name: `Ver escenario exacto: ${formatCount(amount)} votos`, exact: true });
    await expect(link).toHaveCount(1);
    const url = new URL((await link.getAttribute("href"))!, page.url());
    expect([...url.searchParams.keys()].some((key) => key.startsWith("sweep"))).toBe(false);
    expect(JSON.parse(url.searchParams.get("input")!)).toEqual({
      ...input,
      lists: input.lists.map((list, index) => ({
        ...list, votes: list.votes + (index === 0 ? -amount : index === 1 ? amount : 0),
      })),
    });
  }
  await expect(samples.getByRole("table", { name: "Mínimo y máximo de bancas en las muestras válidas" })
    .getByRole("row", { name: "Lista cero 0 0", exact: true })).toBeVisible();
  await expect(exact.getByText(/Huella de los datos proporcionados/)).toHaveText(trace);
  expect(JSON.parse(new URL(page.url()).searchParams.get("input")!)).toEqual(input);
  const endpoint = samples.getByRole("link", { name: "Ver escenario exacto: 1.000 votos", exact: true });
  const pointUrl = new URL((await endpoint.getAttribute("href"))!, page.url());
  expect(pointUrl.searchParams.has("sweepMax")).toBe(false);
  expect(JSON.parse(pointUrl.searchParams.get("input")!)).toEqual({ ...input, lists: [
    { ...input.lists[0], votes: 5000 }, { ...input.lists[1], votes: 5000 }, input.lists[2],
  ] });
  await expectNoHorizontalOverflow(page);
  await expect(sweep).toHaveAttribute("aria-busy", "false");
  await expect(sweep.getByRole("button", { name: "Evaluar muestras" })).toBeEnabled();
  await sweep.getByLabel("Máximo a transferir").fill("500");
  await endpoint.click();
  await expect.poll(() => new URL(page.url()).searchParams.get("input")).toBe(pointUrl.searchParams.get("input"));
  await expect(samples).toHaveCount(0);
  await openSimulationDisclosure(page, "Cómo se asignaron las bancas");
  await openSimulationDisclosure(page, "Sensibilidad de la transferencia");
  await expect(exact.getByRole("table", { name: "Tabla de cocientes D’Hondt" })).toBeVisible();
  await expect(exact.getByText(/Huella de los datos proporcionados/)).not.toHaveText(trace);
  await expect(sweep.getByLabel("Donante del muestreo")).toHaveValue("");
  await expect(sweep.getByLabel("Receptora del muestreo")).toHaveValue("");
  await expect(sweep.getByLabel("Máximo a transferir")).toHaveValue("0");
  await expect(sweep.getByLabel("Paso del muestreo")).toHaveValue("1");
  await expectNoHorizontalOverflow(page);
});

const sweepEvidenceInput = {
  level: "national", seatsToFill: 2, padron: 20000, totalVotes: 10000,
  isProjection: true, granularity: "mesa", unmodeledVotes: 0, unmodeledVoteBreakdown: [],
  threshold: { value: 0, basis: "padron" },
  lists: [
    { listId: "110", listName: "LA LIBERTAD AVANZA", votes: 6000 },
    { listId: "999", listName: "FUERZA PATRIA", votes: 4000 },
    { listId: "zero", listName: "Lista cero", votes: 0 },
  ],
};

function sweepEvidenceQuery(fields: Record<string, string> = {}): string {
  return new URLSearchParams({ input: JSON.stringify(sweepEvidenceInput), ...fields }).toString();
}

async function expectSweepDefaults(page: Page): Promise<void> {
  await openSimulationDisclosure(page, "Sensibilidad de la transferencia");
  const sweep = page.getByRole("form", { name: "Muestreo de transferencias a total fijo" });
  await expect(sweep.getByLabel("Donante del muestreo")).toHaveValue("");
  await expect(sweep.getByLabel("Receptora del muestreo")).toHaveValue("");
  await expect(sweep.getByLabel("Máximo a transferir")).toHaveValue("0");
  await expect(sweep.getByLabel("Paso del muestreo")).toHaveValue("1");
  await expect(sweep).toHaveAttribute("aria-busy", "false");
  await expect(sweep.getByRole("button", { name: "Evaluar muestras", exact: true })).toBeEnabled();
  await expect(page.getByRole("region", { name: "Resultados del muestreo", exact: true })).toHaveCount(0);
}

test("serves varying sample allocations and numeric extrema for every list", async ({ page }) => {
  // Same hypothetical fixture and expected extrema as page.test.tsx; not statutory certification.
  await page.goto(`/simulate?${sweepEvidenceQuery({
    sweepDonor: "110", sweepTarget: "999", sweepMax: "4000", sweepStep: "2000",
  })}`);
  const samples = page.getByRole("region", { name: "Resultados del muestreo", exact: true });
  const points = samples.getByRole("table", { name: "Muestras evaluadas", exact: true });
  await expect(points.locator("tbody").getByRole("rowheader")).toHaveText([0, 2000, 4000].map(formatCount));
  for (const [amount, seats] of [["0", ["1", "1", "0"]], ["2000", ["1", "1", "0"]], ["4000", ["0", "2", "0"]]] as const) {
    const row = points.getByRole("rowheader", { name: formatCount(Number(amount)), exact: true }).locator("..");
    await expect(row.getByRole("cell")).toHaveText([
      "Válida", ...seats, `Ver escenario exacto: ${formatCount(Number(amount))} votos`,
    ]);
  }
  const extrema = samples.getByRole("table", { name: "Mínimo y máximo de bancas en las muestras válidas" });
  await expect(extrema.getByRole("row")).toHaveCount(4);
  for (const [name, counts] of [
    ["LA LIBERTAD AVANZA", ["0", "1"]],
    ["FUERZA PATRIA", ["1", "2"]],
    ["Lista cero", ["0", "0"]],
  ] as const) {
    const row = extrema.getByRole("rowheader", { name, exact: true }).locator("..");
    await expect(row.getByRole("cell")).toHaveText([...counts]);
  }
  await expect(samples).toContainText("3 muestras evaluadas; 3 válidas; 0 rechazadas");
});

for (const invalid of [
  { fields: { sweepStep: "0" }, reason: "El paso debe ser un número entero mayor que cero." },
  { fields: { sweepMax: "21", sweepStep: "1" }, reason: "El muestreo supera el límite de 21 muestras. Reduzca el máximo o aumente el paso." },
]) {
  test(`rejects a direct sweep URL without changing baseline evidence: ${invalid.reason}`, async ({ page }) => {
    await page.goto(`/simulate?${sweepEvidenceQuery()}`);
    const result = page.getByRole("region", { name: "Resultado de la asignación" });
    await expect(result).toBeVisible();
    await openSimulationDisclosure(page, "Cómo se asignaron las bancas");
    const baselineEvidence = await result.innerText();
    const invalidFields = Object.assign({
      sweepDonor: "110", sweepTarget: "999", sweepMax: "1000", sweepStep: "600",
    }, invalid.fields);
    await page.goto(`/simulate?${sweepEvidenceQuery(invalidFields)}`);
    await openSimulationDisclosure(page, "Cómo se asignaron las bancas");
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      `Muestreo rechazado; la base se conserva. ${invalid.reason}`,
    );
    expect(JSON.parse(new URL(page.url()).searchParams.get("input")!)).toEqual(sweepEvidenceInput);
    await expect(result).toHaveText(baselineEvidence, { useInnerText: true });
    await expect(page.getByRole("region", { name: "Resultados del muestreo", exact: true })).toHaveCount(0);
    await expect(page.getByRole("table", { name: "Muestras evaluadas", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Ver escenario exacto:/ })).toHaveCount(0);
  });
}

test("resets drafted sweep controls after a custom edit and same-document Browser Back", async ({ page }) => {
  await page.goto(`/simulate?${sweepEvidenceQuery()}`);
  const result = page.getByRole("region", { name: "Resultado de la asignación" });
  const editor = page.getByRole("form", { name: "Formulario de simulación de bancas" });
  const sweep = page.getByRole("form", { name: "Muestreo de transferencias a total fijo" });
  await openSimulationDisclosure(page, "Editar los datos del escenario");
  await expect(editor).toBeVisible();
  const baselineUrl = page.url();
  await openSimulationDisclosure(page, "Cómo se asignaron las bancas");
  const baselineEvidence = await result.innerText();
  await page.evaluate(() => window.history.pushState(null, "", window.location.href));
  const servedDocument = await page.evaluateHandle(() => document);
  // #398: count /simulate React Server Component traffic after Browser Back.
  let trackRsc = false;
  const rsc = { requests: 0, responses: 0, failures: 0 };
  const isSimulateRsc = (request: Request) =>
    trackRsc && request.headers()["rsc"] === "1" && new URL(request.url()).pathname === "/simulate";
  const afterBack = new Set<Request>();
  const onRequest = (request: Request) => {
    if (!isSimulateRsc(request)) return;
    afterBack.add(request);
    rsc.requests += 1;
  };
  const onFinished = (request: Request) => { if (afterBack.has(request)) rsc.responses += 1; };
  const onFailed = (request: Request) => { if (afterBack.has(request)) rsc.failures += 1; };
  page.on("request", onRequest);
  page.on("requestfinished", onFinished);
  page.on("requestfailed", onFailed);
  async function draftSweep() {
    await openSimulationDisclosure(page, "Sensibilidad de la transferencia");
    await sweep.getByLabel("Donante del muestreo").selectOption("110");
    await sweep.getByLabel("Receptora del muestreo").selectOption("999");
    await sweep.getByLabel("Máximo a transferir").fill("1000");
    await sweep.getByLabel("Paso del muestreo").fill("600");
    await expect(sweep.getByLabel("Donante del muestreo")).toHaveValue("110");
    await expect(sweep.getByLabel("Receptora del muestreo")).toHaveValue("999");
    await expect(sweep.getByLabel("Máximo a transferir")).toHaveValue("1000");
    await expect(sweep.getByLabel("Paso del muestreo")).toHaveValue("600");
  }
  try {
    await draftSweep();
    await editor.getByLabel("Nombre de la lista").first().fill("Lista editada");
    await expect.poll(() => JSON.parse(new URL(page.url()).searchParams.get("input")!).lists[0].listName).toBe("Lista editada");
    await openSimulationDisclosure(page, "Cómo se asignaron las bancas");
    await expect(result).toContainText("Lista editada");
    await expectSweepDefaults(page);
    expect(await page.evaluate((previous) => document === previous, servedDocument)).toBe(true);
    await draftSweep();
    trackRsc = true;
    const backStartedAt = Date.now();
    await page.goBack();
    await expect(page).toHaveURL(baselineUrl);
    expect(await page.evaluate((previous) => document === previous, servedDocument)).toBe(true);
    expect(JSON.parse(new URL(page.url()).searchParams.get("input")!)).toEqual(sweepEvidenceInput);
    await openSimulationDisclosure(page, "Cómo se asignaron las bancas");
    try {
      await expect(result).toHaveText(baselineEvidence, { useInnerText: true });
    } catch (error) {
      // #395: record facts about the intermittent restore failure, then rethrow it unchanged.
      const resultText = await result.innerText({ timeout: 1_000 }).catch(() => "");
      const firstListName = await editor.getByLabel("Nombre de la lista").first().inputValue({ timeout: 1_000 }).catch(() => "");
      const statusText = await page.locator(".simulation-output__status").innerText({ timeout: 1_000 }).catch(() => null);
      let inputMatchesBaseline = false;
      try {
        inputMatchesBaseline = isDeepStrictEqual(
          JSON.parse(new URL(page.url()).searchParams.get("input") ?? "null"),
          sweepEvidenceInput,
        );
      } catch {}
      await writeSimulateBackRestore({
        version: 2,
        urlMatchesBaseline: page.url() === baselineUrl,
        inputMatchesBaseline,
        resultMatchesBaseline: resultText === baselineEvidence,
        resultShowsEditedList: resultText.includes("Lista editada"),
        resultBusy: (await page.locator('[aria-busy="true"]').count().catch(() => 0)) > 0,
        resultLength: resultText.length,
        baselineLength: baselineEvidence.length,
        editorFirstListMatchesBaseline: firstListName === sweepEvidenceInput.lists[0]?.listName,
        elapsedMs: Math.min(Date.now() - backStartedAt, 600_000),
        status: statusText === null ? "absent"
          : statusText.startsWith("Escenario actual") ? "current"
          : statusText.startsWith("Actualizando escenario") ? "updating"
          : statusText.startsWith("Complete o corrija") ? "invalid"
          : "other",
        rscRequestsAfterBack: Math.min(rsc.requests, 1_000),
        rscResponsesAfterBack: Math.min(rsc.responses, 1_000),
        rscFailuresAfterBack: Math.min(rsc.failures, 1_000),
      }, test.info());
      throw error;
    }
    for (const [index, list] of sweepEvidenceInput.lists.entries()) {
      await expect(editor.getByLabel("Nombre de la lista").nth(index)).toHaveValue(list.listName);
      await expect(editor.getByLabel("Votos de la lista").nth(index)).toHaveValue(String(list.votes));
    }
    await expectSweepDefaults(page);
  } finally {
    page.off("request", onRequest);
    page.off("requestfinished", onFinished);
    page.off("requestfailed", onFailed);
    await servedDocument.dispose();
  }
});

test("releases a real superseded sweep response without restoring stale samples", async ({ page }) => {
  await page.goto(`/simulate?${sweepEvidenceQuery()}`);
  await openSimulationDisclosure(page, "Sensibilidad de la transferencia");
  const sweep = page.getByRole("form", { name: "Muestreo de transferencias a total fijo" });
  await sweep.getByLabel("Donante del muestreo").selectOption("110");
  await sweep.getByLabel("Receptora del muestreo").selectOption("999");
  await sweep.getByLabel("Máximo a transferir").fill("4000");
  await sweep.getByLabel("Paso del muestreo").fill("2000");

  let responseReady = false;
  let responseDelivered = false;
  let releaseResponse: () => void = () => {};
  const delay = new Promise<void>((resolve) => { releaseResponse = resolve; });
  const servedDocument = await page.evaluateHandle(() => document);
  const sampleMonitor = await page.evaluateHandle(() => {
    let seen = false;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element && (
            node.matches('[aria-label="Resultados del muestreo"]') ||
            node.querySelector('[aria-label="Resultados del muestreo"]')
          )) seen = true;
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return { observer, get seen() { return seen; } };
  });
  await page.route("**/simulate?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("sweepMax") !== "4000") {
      await route.continue();
      return;
    }
    // Fetch the actual RSC navigation response and release it intact after a newer request.
    const response = await route.fetch();
    responseReady = true;
    await delay;
    await route.fulfill({ response });
    responseDelivered = true;
  });
  try {
    await sweep.getByRole("button", { name: "Evaluar muestras", exact: true }).click();
    await expect.poll(() => responseReady).toBe(true);
    // The editable baseline remains available during the sweep transition.
    // Supersede through its real debounced router request, never page.goto or abort.
    const editor = page.getByRole("form", { name: "Formulario de simulación de bancas" });
    await openSimulationDisclosure(page, "Editar los datos del escenario");
    await expect(editor).toBeVisible();
    await editor.getByLabel("Nombre de la lista").first().fill("Lista nueva A");
    await editor.getByLabel("Nombre de la lista").nth(1).fill("Lista nueva B");
    await expect.poll(() => {
      const input = new URL(page.url()).searchParams.get("input");
      return input ? JSON.parse(input).lists[0].listName : null;
    }).toBe("Lista nueva A");
    const result = page.getByRole("region", { name: "Resultado de la asignación" });
    await openSimulationDisclosure(page, "Cómo se asignaron las bancas");
    await expect(result.getByRole("table", { name: "Tabla de cocientes D’Hondt" })).toBeVisible();
    const newerUrl = page.url();
    const newerInput = JSON.parse(new URL(newerUrl).searchParams.get("input")!);
    expect(newerInput).toEqual({ ...sweepEvidenceInput, lists: [
      { ...sweepEvidenceInput.lists[0], listName: "Lista nueva A" },
      { ...sweepEvidenceInput.lists[1], listName: "Lista nueva B" },
      sweepEvidenceInput.lists[2],
    ] });
    const newerEvidence = await result.innerText();
    releaseResponse();
    await expect.poll(() => responseDelivered).toBe(true);
    // Drain route handlers and browser rendering before checking the final state.
    await page.unrouteAll({ behavior: "wait" });
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    await expect(page).toHaveURL(newerUrl);
    expect(JSON.parse(new URL(page.url()).searchParams.get("input")!)).toEqual(newerInput);
    await openSimulationDisclosure(page, "Cómo se asignaron las bancas");
    await expect(result).toHaveText(newerEvidence, { useInnerText: true });
    await expect(editor.getByLabel("Nombre de la lista").first()).toHaveValue("Lista nueva A");
    await expect(editor.getByLabel("Votos de la lista").first()).toHaveValue("6000");
    expect(await page.evaluate((previous) => document === previous, servedDocument)).toBe(true);
    await expectSweepDefaults(page);
    const transfer = page.getByRole("form", { name: "Transferencia de votos a total fijo" });
    await expect(transfer).toHaveAttribute("aria-busy", "false");
    await expect(transfer.getByRole("button", { name: "Transferir votos", exact: true })).toBeEnabled();
    expect(await sampleMonitor.evaluate((monitor) => monitor.seen)).toBe(false);
  } finally {
    releaseResponse();
    await page.unrouteAll({ behavior: "wait" });
    await sampleMonitor.evaluate((monitor) => monitor.observer.disconnect());
    await sampleMonitor.dispose();
    await servedDocument.dispose();
  }
});

test("keeps zero-seat lists countable at desktop and mobile widths", async ({ page }) => {
  const longName = "Lista con denominación extensa".repeat(8);
  const input = {
    level: "national", padron: 100000, totalVotes: 16000,
    unmodeledVotes: 0, unmodeledVoteBreakdown: [],
    threshold: { value: 3, basis: "padron" }, seatsToFill: 2,
    isProjection: true, granularity: "distrito",
    lists: [
      { listId: "A", listName: longName, votes: 10000 },
      { listId: "B", listName: "Lista B", votes: 4000 },
      { listId: "C", listName: "Lista C", votes: 2000 },
    ],
  };
  await page.goto(`/simulate?${new URLSearchParams({ input: JSON.stringify(input) })}`);
  const result = page.getByRole("region", { name: "Resultado de la asignación" });
  const chart = page.getByRole("complementary", { name: "Construir el supuesto" }).getByRole("region", { name: "Distribución de bancas", exact: true });
  const trace = result.getByText(/Huella de los datos proporcionados/);
  await expect(chart).toBeVisible();
  const servedTrace = await trace.innerText();
  await chart.getByText("Listas sin bancas (2)", { exact: true }).click();
  await chart.getByText("Cómo leer la distribución", { exact: true }).click();
  const transfer = page.getByRole("form", { name: "Transferencia de votos a total fijo" });
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 800 });
    for (const label of ["Lista donante", "Lista receptora"]) {
      await expect(transfer.getByLabel(label).getByRole("option", {
        name: `${longName} — 10.000 votos`, exact: true,
      })).toHaveText(`${longName} — 10.000 votos`);
    }
    await expect(chart.locator('[data-seat-state="awarded"]')).toHaveCount(2);
    await expect(chart.locator('[data-seat-state="empty"]')).toHaveCount(4);
    await expect(chart.getByRole("img", { name: "Lista C: 0 de 2 bancas", exact: true })).toBeVisible();
    await openSimulationDisclosure(page, "Cómo se asignaron las bancas");
    await expect(result.getByRole("table", { name: "Cocientes ganadores ordenados" }).getByRole("row")).toHaveCount(3);
    await expect(trace).toHaveText(servedTrace);
    await expectNoHorizontalOverflow(page);
  }
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
  await openSimulationDisclosure(page, "Cómo se asignaron las bancas");
  await expect(result).toContainText("1.000 explícitamente fuera del modelo");
  await expect(page.getByRole("complementary", { name: "Construir el supuesto" }).getByRole("region", { name: "Distribución de bancas", exact: true })).toBeVisible();
  await expect(page.getByRole("form", { name: "Formulario de simulación de bancas" })).toHaveCount(0);
  await page.reload();
  await expect(page).toHaveURL(suppliedUrl);
  await openSimulationDisclosure(page, "Cómo se asignaron las bancas");
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
  const chart = page.getByRole("complementary", { name: "Construir el supuesto" }).getByRole("region", { name: "Distribución de bancas", exact: true });
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
    await openSimulationDisclosure(page, "Cómo se asignaron las bancas");
    const allocation = result.getByRole("table", { name: "Asignación Hare por lista" });
    await expect(allocation.getByRole("rowheader", { name: "Lista A", exact: true }).locator("..").getByRole("cell").last()).toHaveText("5");
    await expect(allocation.getByRole("rowheader", { name: "Lista B", exact: true }).locator("..").getByRole("cell").last()).toHaveText("4");
  } finally {
    releaseResponse();
    await page.clock.resume();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("reaches unvalidated 2027 scenarios from shared navigation at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/");
  const drawerTrigger = page.getByRole("button", { name: "Abrir navegación" });
  await drawerTrigger.click();
  const drawer = page.getByRole("dialog", { name: "Navegación principal" });
  await drawer.getByRole("link", { name: "Escenarios Rosales 2027", exact: true }).click();
  await expect(page).toHaveURL(/\/scenarios$/);
  await expect(drawer).toBeHidden();

  await expect(page.getByRole("heading", { level: 1, name: "Escenarios Rosales 2027" })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.getByRole("status")).toContainText("supuestos sin validar");
  const persistence = page.getByRole("heading", { level: 2, name: "Persistencia (por defecto)" });
  const transfers = page.getByRole("heading", {
    level: 2,
    name: "Transferencias estimadas por inferencia ecológica",
  });
  expect((await elementRectangle(persistence)).top).toBeLessThan((await elementRectangle(transfers)).top);
  const persistenceRow = page
    .getByRole("region", { name: "Listas del escenario Persistencia", exact: true })
    .getByRole("row", { name: /ALIANZA LA LIBERTAD AVANZA/ });
  await expect(persistenceRow.getByRole("cell")).toHaveText(["45,06", "5", "0"]);
  await expect(main.getByText(/21,074 pp frente a 17,245 pp/)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const regions = page.getByRole("region", { name: /^Listas del escenario / });
  await expect(regions).toHaveCount(2);
  await regions.first().focus();
  await expect(regions.first()).toBeFocused();
  await page.keyboard.press("Tab");
  const editTransfers = page.getByTestId("scenario-transferencias_ei")
    .getByRole("link", { name: "Editar este escenario" });
  await expect(editTransfers).toBeFocused();
  await expect(editTransfers).toHaveAttribute("href", "/simulate?scenario=transferencias_ei");
  await page.keyboard.press("Tab");
  await expect(regions.nth(1)).toBeFocused();

  await page.setViewportSize({ width: 320, height: 720 });
  await expectNoHorizontalOverflow(page);
});
