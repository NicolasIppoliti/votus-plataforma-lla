import { REVIEW_ITEM, withReviewItem } from "./authorized-review-fixture";
import { writeFile } from "node:fs/promises";
import { type Locator, type Page } from "@playwright/test";

import { assertE2eEnvironment } from "./gate-contract";
import { durationInMilliseconds } from "./css-duration";
import { createReviewStateHandler, reviewPagePayload, REVIEW_SAFE_STATE_PAYLOADS } from "./review-state-control";
import { expect, test } from "./review-test-fixture";
import { zoomTest } from "./review-zoom-test-fixture";
import { writeReviewFocusGeometry, type ReviewFocusControl } from "./review-focus-geometry";

const READ_ONLY_NOTICE =
  "Esta pantalla es solo de consulta. Puede inspeccionar los elementos pendientes, pero no modificarlos ni resolverlos aquí.";
const REVIEW_REGION_LABEL = "Elementos de revisión pendientes";
async function expectReducedMotion(page: Page, target: Locator): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const durations = await target.evaluate((element) => {
    const styles = getComputedStyle(element);
    return [...styles.animationDuration.split(","), ...styles.transitionDuration.split(",")];
  });
  expect(durations.map(durationInMilliseconds).every((duration) => duration <= 0.01)).toBe(true);
}

async function expectDocumentNotToOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function expectCellTextContained(row: Locator): Promise<void> {
  const violations = await row.getByRole("cell").evaluateAll((cells) =>
    cells.flatMap((cell, cellIndex) => {
      const cellRect = cell.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(cell);
      return Array.from(range.getClientRects()).flatMap(
        (textRect, lineIndex) => {
          const tolerance = 1;
          const contained =
            textRect.left >= cellRect.left - tolerance &&
            textRect.right <= cellRect.right + tolerance &&
            textRect.top >= cellRect.top - tolerance &&
            textRect.bottom <= cellRect.bottom + tolerance;
          return contained
            ? []
            : [
                {
                  cellIndex,
                  lineIndex,
                  cellLeft: cellRect.left,
                  cellRight: cellRect.right,
                  textLeft: textRect.left,
                  textRight: textRect.right,
                },
              ];
        },
      );
    }),
  );
  expect(
    violations,
    "every text range must remain inside its own cell",
  ).toEqual([]);
}

async function expectPopulatedReviewLayout(
  page: Page,
  viewport: { width: number; height: number },
  expectTableOverflow: boolean,
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const main = page.getByRole("main");
  await expect(main.getByText("Operaciones · revisión", { exact: true })).toBeVisible();
  const attention = main.getByRole("status");
  await expect(attention).toContainText("Atención operativa");
  await expect(attention).toContainText("Esta pantalla es solo de consulta.");
  const results = main.locator('section[aria-labelledby="review-results-heading"]');
  await expect(results.getByRole("heading", { name: "Elementos pendientes" })).toBeVisible();

  const region = page.getByRole("region", { name: REVIEW_REGION_LABEL });
  await expect(region).toBeVisible();
  await expect(region).toHaveAttribute("tabindex", "0");
  const regionBox = await region.boundingBox();
  if (!regionBox) throw new Error("review table scroll region has no box");
  expect(regionBox.height).toBeGreaterThanOrEqual(44);
  await page.touchscreen.tap(regionBox.x + 22, regionBox.y + 22);
  await region.focus();
  await expect(region).toBeFocused();
  await expectReducedMotion(page, region);
  await expectDocumentNotToOverflow(page);

  const scrollDimensions = await region.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollLeft: element.scrollLeft,
    scrollWidth: element.scrollWidth,
  }));
  if (expectTableOverflow) {
    expect(scrollDimensions.scrollWidth).toBeGreaterThan(
      scrollDimensions.clientWidth,
    );
    await page.keyboard.press("Shift+Tab");
    await expect(region).not.toBeFocused();
    await page.keyboard.press("Tab");
    await expect(region).toBeFocused();
    // Viewport/focus traversal may retain an earlier horizontal position.
    // Start this directional check at the left edge, never at its end stop.
    // Registration is acknowledged before the existing reset and keyboard input.
    const completion = await region.evaluateHandle((element) => {
      let armed = false, moved = false, released = false, complete = false;
      let resetPending = false;
      let resetComplete = false;
      const completeInteraction = () => {
        complete = armed && moved && released && element.scrollLeft > 0;
      };
      const key = (event: Event) => {
        if (!resetComplete || !(event instanceof KeyboardEvent) || event.target !== element || !event.isTrusted || event.key !== "ArrowRight"
          || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.type === "keydown") { armed = true; moved = released = complete = false; }
        else if (armed) { released = true; completeInteraction(); }
      };
      const scroll = () => {
        complete = false;
        if (armed && element.scrollLeft > 0) { moved = true; completeInteraction(); }
      };
      const end = () => {
        if (resetPending) {
          if (element.scrollLeft === 0) {
            resetPending = false;
            resetComplete = true;
          }
        }
      };
      element.addEventListener("keydown", key);
      element.addEventListener("keyup", key);
      element.addEventListener("scroll", scroll);
      element.addEventListener("scrollend", end);
      return {
        reset: () => {
          resetPending = element.scrollLeft !== 0;
          resetComplete = !resetPending;
          element.scrollLeft = 0;
          // An immediate reset need not dispatch a later scrollend event.
          if (element.scrollLeft === 0) {
            resetPending = false;
            resetComplete = true;
          }
        },
        resetCompleted: () => resetComplete,
        completed: () => complete,
        dispose: () => {
          element.removeEventListener("keydown", key);
          element.removeEventListener("keyup", key);
          element.removeEventListener("scroll", scroll);
          element.removeEventListener("scrollend", end);
        },
      };
    });
    try {
      await completion.evaluate(state => state.reset());
      await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBe(0);
      await expect.poll(() => completion.evaluate(state => state.resetCompleted())).toBe(true);
      await region.press("ArrowRight");
      await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      await expect.poll(() => completion.evaluate(state => state.completed())).toBe(true);
    } finally {
      try { await completion.evaluate(state => state.dispose()); }
      finally { await completion.dispose(); }
    }
  } else {
    expect(scrollDimensions.scrollWidth).toBeLessThanOrEqual(
      scrollDimensions.clientWidth,
    );
  }

  const table = page.getByRole("table", { name: REVIEW_REGION_LABEL });
  const row = table.locator("tbody").getByRole("row");
  await expect(row).toHaveCount(1);
  const cells = row.getByRole("cell");
  await expect(table.getByRole("columnheader")).toHaveText(["Tipo", "Severidad", "Detectado"]);
  await expect(table.getByRole("columnheader", { name: /Asunto|Nota|Subject|Note/i })).toHaveCount(0);
  await expect(cells).toHaveCount(3);
  await expect(cells.nth(0)).toHaveText(REVIEW_ITEM.kind);
  await expect(cells.nth(1)).toHaveText(REVIEW_ITEM.severity);
  await expect(cells.nth(2)).toContainText("2026-08-13T12:34:56.789");
  await expect(table).not.toContainText("Oculto por alcance");
  await expect(page.locator("body")).not.toContainText(REVIEW_ITEM.subject_ref);
  await expect(page.locator("body")).not.toContainText(REVIEW_ITEM.note);
  await expectCellTextContained(row);
}

const PREVIOUS_PAGE = "Página anterior de la cola de revisión";
const NEXT_PAGE = "Página siguiente de la cola de revisión";
const NAVIGATION_NAMES = ["Resumen operativo", "Explorar", "Comparar", "Municipal", "Fiscalización (no oficial)", "Simulación 2027", "Revisión de datos"];

async function expectKeyboardFocus(target: Locator, region = false, control: ReviewFocusControl = "unlabelled"): Promise<void> {
  const capture = () => target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const color = getComputedStyle(element).outlineColor;
    let effectiveOpacity = 1;
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      effectiveOpacity *= Number(getComputedStyle(ancestor).opacity);
    }
    const rect = (value: DOMRect) => ({
      left: value.left, top: value.top, right: value.right, bottom: value.bottom,
      width: value.width, height: value.height,
    });
    const dialog = element.closest('[data-slot="sheet-content"][role="dialog"][data-state="open"]');
    return {
      appearance: {
        active: document.activeElement === element, focusVisible: element.matches(":focus-visible"),
        outlineWidthPx: Number.parseFloat(getComputedStyle(element).outlineWidth),
        outlineOffsetPx: Number.parseFloat(getComputedStyle(element).outlineOffset),
        outlineStyle: getComputedStyle(element).outlineStyle,
      },
      focus: {
        activeTarget: document.activeElement === element ? "target"
          : document.activeElement?.matches(".mobile-navigation__trigger") ? "drawer-trigger"
          : document.activeElement === document.body ? "body"
          : `other-${document.activeElement?.tagName.toLowerCase() ?? "none"}`,
        documentFocused: document.hasFocus(), targetConnected: element.isConnected,
      },
      effectiveOpacity,
      opaque: color !== "transparent" && !/[,/]\s*0\s*\)$/.test(color),
      intersects: box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth,
      contained: box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth,
      target: rect(box),
      viewport: { innerWidth, innerHeight, outerWidth, outerHeight, scrollX, scrollY },
      dialog: dialog ? {
        rect: rect(dialog.getBoundingClientRect()), clientHeight: dialog.clientHeight,
        scrollHeight: dialog.scrollHeight, scrollTop: dialog.scrollTop,
      } : null,
    };
  });
  const writeDiagnostics = async (canonical: unknown, focus: Awaited<ReturnType<typeof capture>>["focus"]) => {
    const failures: unknown[] = [];
    if (!await writeReviewFocusGeometry(canonical, test.info())) {
      failures.push(new Error("Canonical focus geometry was rejected or could not be written"));
    }
    try {
      await writeFile(test.info().outputPath("review-focus-state.json"),
        JSON.stringify({ version: 1, control, ...focus }), { mode: 0o600, flag: "wx" });
    } catch (error) {
      failures.push(error);
    }
    if (failures.length) throw new AggregateError(failures, "Focus diagnostics failed");
  };
  try {
    await expect(target).toBeFocused();
    await expect(target).toHaveCSS("outline-width", "3px");
    await expect(target).toHaveCSS("outline-style", "solid");
    await expect(target).toHaveCSS("outline-offset", "3px");
    await expect.poll(() => target.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  } catch (error) {
    try {
      const { appearance, focus, ...snapshot } = await capture();
      await writeDiagnostics({ version: 2, reason: "appearance", control, appearance, snapshot }, focus);
    } catch (diagnosticError) {
      throw new AggregateError([error, diagnosticError], "Focus assertion and diagnostic capture failed");
    }
    throw error;
  }
  const { appearance, focus, ...visibility } = await capture();
  try {
    expect(visibility.effectiveOpacity).toBeGreaterThan(0);
    expect(visibility.opaque).toBe(true);
    expect(visibility.intersects).toBe(true);
    if (!region) expect(visibility.contained, JSON.stringify({ control, target: visibility.target, viewport: visibility.viewport, dialog: visibility.dialog })).toBe(true);
  } catch (error) {
    try {
      await writeDiagnostics({ version: 2, reason: visibility.intersects ? "appearance" : "off-viewport",
        control, appearance, snapshot: visibility }, focus);
    } catch (diagnosticError) {
      throw new AggregateError([error, diagnosticError], "Focus visibility assertion and diagnostic capture failed");
    }
    throw error;
  }
}

async function tabTo(page: Page, target: Locator, reverse = false, region = false, control: ReviewFocusControl = "unlabelled"): Promise<void> {
  await page.keyboard.press(reverse ? "Shift+Tab" : "Tab");
  await expectKeyboardFocus(target, region, control);
}

async function expectReviewWindow(page: Page, count: number, firstDetected: string): Promise<void> {
  const main = page.getByRole("main");
  await expect(main).toContainText(`Mostrando ${count} de 101.`);
  const rows = main.getByRole("table").locator("tbody").getByRole("row");
  await expect(rows).toHaveCount(count);
  await expect(main.getByRole("columnheader")).toHaveText(["Tipo", "Severidad", "Detectado"]);
  await expect(rows.getByRole("cell")).toHaveCount(count * 3);
  await expect(rows.first().getByRole("cell").nth(2)).toHaveText(firstDetected);
  await expect(rows.getByRole("cell", { name: "Oculto por alcance", exact: true })).toHaveCount(0);
  await expect(rows.getByRole("cell", { name: "content_drift", exact: true })).toHaveCount(count);
  await expect(rows.getByRole("cell", { name: "warning", exact: true })).toHaveCount(count);
  await expect(main).not.toContainText("00000000-0000-4000-8000-");
}

zoomTest("test_authorized_review_uses_native_200_percent_zoom", async ({ page, next, zoom }) => {
  let matched = 0;
  next.onFetch(createReviewStateHandler(
    assertE2eEnvironment(process.env).NEXT_PUBLIC_SUPABASE_URL,
    () => { matched += 1; },
    (offset) => Response.json(reviewPagePayload(offset)),
  ));
  await withReviewItem(page, async () => {
    await page.goto("/review");
    await expect(page).toHaveURL(/\/review$/);
    await expect(page.getByRole("heading", { level: 1, name: "Cola de revisión" })).toBeVisible();
    await expect(page.getByRole("region", { name: REVIEW_REGION_LABEL })).toBeVisible();
    await expect(page.getByRole("table").getByRole("row")).toHaveCount(51);
    expect(matched).toBeGreaterThan(0);
    const dimensions = () => page.evaluate(() => ({
      inner: window.innerWidth,
      client: document.documentElement.clientWidth,
      outer: window.outerWidth,
    }));
    expect(await zoom.set(1)).toBe(1);
    const baseline = await dimensions();
    expect(baseline.inner).toBeGreaterThan(0);
    expect(await zoom.set(2)).toBe(2);
    await expect.poll(async () => Math.abs((await dimensions()).inner - baseline.inner / 2)).toBeLessThanOrEqual(2);
    const enlarged = await dimensions();
    expect(Math.abs(enlarged.client - baseline.client / 2)).toBeLessThanOrEqual(20);
    expect(enlarged.outer).toBe(baseline.outer);
    // The zoom fixture resets explicitly while this page is alive, before context disposal.
  });
});

for (const windowWidth of [1280, 640]) {
  zoomTest.describe(`native 200% review at fixed ${windowWidth}px window`, () => {
    zoomTest.use({ zoomWindowWidth: windowWidth });
    zoomTest("review remains keyboard usable with local table overflow and real paging", async ({ page, next, zoom }) => {
      const offsets: number[] = [];
      next.onFetch(createReviewStateHandler(assertE2eEnvironment(process.env).NEXT_PUBLIC_SUPABASE_URL,
        undefined, (offset) => { offsets.push(offset); return Response.json(reviewPagePayload(offset)); }));
      await withReviewItem(page, async () => {
        // Fresh document for natural keyboard entry; never resize this window or viewport.
        await page.goto("/review");
        await expectReviewWindow(page, 50, "2026-01-01T00:00:00.000Z");
        await page.evaluate(async () => { await document.fonts.ready; });
        const dimensions = () => page.evaluate(() => ({
          inner: innerWidth, client: document.documentElement.clientWidth,
          outer: outerWidth, height: outerHeight,
        }));
        expect(await zoom.set(1)).toBe(1);
        const baseline = await dimensions();
        expect(baseline.outer).toBe(windowWidth);
        expect(Math.abs(baseline.inner - windowWidth)).toBeLessThanOrEqual(2);
        const region = page.getByRole("region", { name: REVIEW_REGION_LABEL });
        const originalRegionWidth = await region.evaluate((element) => element.clientWidth);
        const checkZoom = async (factor: 1 | 2) => {
          // Chrome resets automatic per-tab settings on navigation; always reapply/read back.
          expect(await zoom.set(factor)).toBe(factor);
          await expect.poll(async () => Math.abs((await dimensions()).inner - baseline.inner / factor)).toBeLessThanOrEqual(2);
          await expect.poll(async () => Math.abs((await dimensions()).client - baseline.client / factor)).toBeLessThanOrEqual(20);
          expect(await dimensions()).toMatchObject({ outer: baseline.outer, height: baseline.height });
          await expectDocumentNotToOverflow(page);
        };
        const expectControlSize = async (control: Locator) => {
          const box = await control.boundingBox();
          if (!box) throw new Error("zoom control has no layout box");
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(44);
        };
        await checkZoom(2);
        await expect(page.getByRole("main")).toContainText(READ_ONLY_NOTICE);
        await expectReviewWindow(page, 50, "2026-01-01T00:00:00.000Z");
        await expectCellTextContained(page.getByRole("table").locator("tbody").getByRole("row").first());
        await tabTo(page, page.getByRole("link", { name: "Ir al contenido principal" }), false, false, "skip-link");
        // Both zoomed CSS widths use the responsive drawer, not desktop sidebar order.
        const trigger = page.getByRole("button", { name: "Abrir navegación" });
        await tabTo(page, trigger, false, false, "nav-trigger");
        await expectControlSize(trigger);
        await page.keyboard.press("Enter");
        const drawer = page.getByRole("dialog", { name: "Navegación principal" });
        const close = drawer.getByRole("button", { name: "Cerrar navegación" });
        await expectKeyboardFocus(close, false, "nav-close");
        await expectControlSize(close);
        const account = drawer.locator("summary", { hasText: "Cuenta" });
        const organization = drawer.getByRole("combobox", { name: "Organización" });
        const submit = drawer.getByRole("button", { name: "Cambiar organización" });
        await tabTo(page, account, true);
        await tabTo(page, submit, true, false, "org-submit");
        await tabTo(page, organization, true, false, "org-select");
        await tabTo(page, drawer.getByRole("link", { name: "Revisión de datos", exact: true }), true, false, "last-drawer-link");
        await tabTo(page, organization, false, false, "org-select");
        await expectControlSize(organization);
        await tabTo(page, submit, false, false, "org-submit");
        await expectControlSize(submit);
        await tabTo(page, account);
        await page.keyboard.press("Enter");
        await tabTo(page, drawer.getByRole("button", { name: "Cerrar sesión" }), false, false, "sign-out");
        await page.keyboard.press("Escape");
        await expectKeyboardFocus(account);
        await expect(drawer).toBeVisible();
        await tabTo(page, close, false, false, "nav-close");
        await page.keyboard.press("Escape");
        await expect(drawer).not.toBeVisible();
        await expectKeyboardFocus(trigger, false, "nav-trigger");
        const realCount = page.getByRole("banner").getByRole("link", { name: "1 elemento(s) de revisión pendiente(s)", exact: true });
        await tabTo(page, realCount, false, false, "header-count");
        await tabTo(page, region, false, true, "review-table-region");
        await expect(region).toHaveAttribute("tabindex", "0");
        const scroll = await region.evaluate((element) => ({ left: element.scrollLeft, width: element.clientWidth, total: element.scrollWidth }));
        expect(scroll.total).toBeGreaterThan(scroll.width);
        await page.keyboard.press("ArrowRight");
        await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(scroll.left);
        await expect(page.getByRole("link", { name: PREVIOUS_PAGE })).toHaveCount(0);
        await tabTo(page, page.getByRole("link", { name: NEXT_PAGE }), false, false, "pager-next-entry");
        for (const step of [
          { control: "pager-next-50", name: NEXT_PAGE, offset: 50, count: 50, date: "2026-01-01T00:00:50.000Z" },
          { control: "pager-next-100", name: NEXT_PAGE, offset: 100, count: 1, date: "2026-01-01T00:01:40.000Z" },
          { control: "pager-previous-50", name: PREVIOUS_PAGE, offset: 50, count: 50, date: "2026-01-01T00:00:50.000Z" },
        ] as const) {
          const pager = page.getByRole("link", { name: step.name });
          await expect(pager).toHaveAttribute("href", `/review?offset=${step.offset}`);
          await pager.scrollIntoViewIfNeeded();
          await expectControlSize(pager);
          // First activation follows natural Tab entry; later pages explicitly refocus their pager.
          if (step.offset !== 50 || step.name === PREVIOUS_PAGE) await pager.focus();
          await expectKeyboardFocus(pager, false, step.control);
          await page.keyboard.press("Enter");
          await expect(page).toHaveURL(new RegExp(`/review\\?offset=${step.offset}$`));
          await checkZoom(2);
          await expectReviewWindow(page, step.count, step.date);
          await expect(page.getByRole("link", { name: NEXT_PAGE })).toHaveCount(step.offset === 100 ? 0 : 1);
        }
        expect(offsets).toEqual(expect.arrayContaining([0, 50, 100]));
        expect(offsets.every((offset) => [0, 50, 100].includes(offset))).toBe(true);
        await page.goto("/review");
        await checkZoom(2);
        await checkZoom(1);
        await expectReviewWindow(page, 50, "2026-01-01T00:00:00.000Z");
        await expect.poll(() => region.evaluate((element) => element.clientWidth)).toBe(originalRegionWidth);
      });
    });
  });
}

test.describe("the review route reflects the disposable database", () => {
  test.use({ hasTouch: true });

  for (const width of [1440, 320]) {
    test(`test_review_pagination_visits_real_urls_and_three_column_windows_at_${width}px`, async ({ page, next }) => {
      const offsets: number[] = [];
      next.onFetch(createReviewStateHandler(assertE2eEnvironment(process.env).NEXT_PUBLIC_SUPABASE_URL,
        undefined, (offset) => { offsets.push(offset); return Response.json(reviewPagePayload(offset)); }));
      await withReviewItem(page, async () => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/review");
        await expect(page).toHaveURL(/\/review$/);
        await expectReviewWindow(page, 50, "2026-01-01T00:00:00.000Z");
        await expect(page.getByRole("link", { name: PREVIOUS_PAGE })).toHaveCount(0);
        for (const step of [
          { name: NEXT_PAGE, offset: 50, count: 50, date: "2026-01-01T00:00:50.000Z" },
          { name: NEXT_PAGE, offset: 100, count: 1, date: "2026-01-01T00:01:40.000Z" },
          { name: PREVIOUS_PAGE, offset: 50, count: 50, date: "2026-01-01T00:00:50.000Z" },
        ]) {
          const pager = page.getByRole("link", { name: step.name });
          if (width === 320) {
            await pager.scrollIntoViewIfNeeded();
            const box = await pager.boundingBox();
            if (!box) throw new Error("pager has no touch target");
            expect(box.width).toBeGreaterThanOrEqual(44);
            expect(box.height).toBeGreaterThanOrEqual(44);
            await pager.tap();
          } else await pager.click();
          await expect(page).toHaveURL(new RegExp(`/review\\?offset=${step.offset}$`));
          await expectReviewWindow(page, step.count, step.date);
          await expect(page.getByRole("link", { name: PREVIOUS_PAGE })).toHaveCount(1);
          await expect(page.getByRole("link", { name: NEXT_PAGE })).toHaveCount(step.offset === 100 ? 0 : 1);
          await expectDocumentNotToOverflow(page);
        }
        // Next can reuse a prefetched/cached page when navigating back.
        expect(offsets).toEqual(expect.arrayContaining([0, 50, 100]));
        expect(offsets.every((offset) => [0, 50, 100].includes(offset))).toBe(true);
      });
    });
  }

  test("test_review_offset_fallbacks_empty_window_and_ceiling", async ({ page, next }) => {
    const offsets: number[] = [];
    next.onFetch(createReviewStateHandler(assertE2eEnvironment(process.env).NEXT_PUBLIC_SUPABASE_URL,
      undefined, (offset) => {
        offsets.push(offset);
        return Response.json(reviewPagePayload(offset, offset >= 1_999_999_950 ? 2_000_000_051 : 101));
      }));
    await withReviewItem(page, async () => {
      for (const query of ["-1", "1.5", "nope", "2000000001", "00000000000"]) {
        const before = offsets.length;
        await page.goto(`/review?offset=${query}`);
        await expectReviewWindow(page, 50, "2026-01-01T00:00:00.000Z");
        expect(offsets.slice(before)).toContain(0);
      }
      await page.goto("/review?offset=1");
      await expectReviewWindow(page, 50, "2026-01-01T00:00:01.000Z");
      await page.getByRole("link", { name: PREVIOUS_PAGE }).click();
      await expect(page).toHaveURL(/\/review\?offset=0$/);
      await expectReviewWindow(page, 50, "2026-01-01T00:00:00.000Z");
      await page.goto("/review?offset=150");
      await expect(page.getByRole("main")).toContainText("No hay elementos de revisión en esta página.");
      await expect(page.getByRole("table")).toHaveCount(0);
      await expect(page.getByRole("link", { name: NEXT_PAGE })).toHaveCount(0);
      await expect(page.getByRole("link", { name: PREVIOUS_PAGE })).toHaveAttribute("href", "/review?offset=100");
      await page.goto("/review?offset=1999999950");
      await expect(page.getByRole("main")).toContainText("Mostrando 50 de 2000000051.");
      await expect(page.getByRole("table").locator("tbody").getByRole("row")).toHaveCount(50);
      await page.getByRole("link", { name: NEXT_PAGE }).click();
      await expect(page).toHaveURL(/\/review\?offset=2000000000$/);
      await expect(page.getByRole("main")).toContainText("Mostrando 50 de 2000000051.");
      await expect(page.getByRole("table").locator("tbody").getByRole("row")).toHaveCount(50);
      await expect(page.getByRole("link", { name: NEXT_PAGE })).toHaveCount(0);
      await expect(page.getByRole("link", { name: PREVIOUS_PAGE })).toHaveAttribute("href", "/review?offset=1999999950");
      expect(offsets).toEqual(expect.arrayContaining([0, 1, 150, 1_999_999_950, 2_000_000_000]));
    });
  });

  test("test_review_natural_keyboard_order_drawer_trap_and_pager_activation", async ({ page, next }) => {
    next.onFetch(createReviewStateHandler(assertE2eEnvironment(process.env).NEXT_PUBLIC_SUPABASE_URL,
      undefined, (offset) => Response.json(reviewPagePayload(offset))));
    await withReviewItem(page, async () => {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        // Full navigation resets sequential focus; viewport changes alone do not.
        await page.goto("/review?offset=50");
        await expectReviewWindow(page, 50, "2026-01-01T00:00:50.000Z");
        await tabTo(page, page.getByRole("link", { name: "Ir al contenido principal" }), false, false, "skip-link");
        if (width === 1440) {
          await tabTo(page, page.getByRole("link", { name: "Panel de Votus" }));
          for (const name of NAVIGATION_NAMES) await tabTo(page, page.getByRole("navigation", { name: "principal", exact: true }).getByRole("link", { name, exact: true }));
        } else {
          const trigger = page.getByRole("button", { name: "Abrir navegación" });
          await tabTo(page, trigger, false, false, "nav-trigger");
          await page.keyboard.press("Enter");
          const drawer = page.getByRole("dialog", { name: "Navegación principal" });
          const close = drawer.getByRole("button", { name: "Cerrar navegación" });
          await expectKeyboardFocus(close, false, "nav-close");
          await tabTo(page, drawer.locator("summary", { hasText: "Cuenta" }), true);
          await tabTo(page, close, false, false, "nav-close");
          await tabTo(page, drawer.getByRole("link", { name: "Panel de Votus" }));
          for (const name of NAVIGATION_NAMES) await tabTo(page, drawer.getByRole("link", { name, exact: true }));
        }
        const organization = page.getByRole("combobox", { name: "Organización" });
        const submit = page.getByRole("button", { name: "Cambiar organización" });
        await expect(organization).toBeEnabled();
        await expect(submit).toBeEnabled();
        await tabTo(page, organization, false, false, "org-select");
        await tabTo(page, submit, false, false, "org-submit");
        const account = page.getByRole("contentinfo", { name: "Organización y cuenta" }).locator("summary");
        await tabTo(page, account);
        await page.keyboard.press("Enter");
        await tabTo(page, page.getByRole("button", { name: "Cerrar sesión" }), false, false, "sign-out");
        await page.keyboard.press("Escape");
        await expectKeyboardFocus(account);
        if (width < 1024) {
          const drawer = page.getByRole("dialog", { name: "Navegación principal" });
          await tabTo(page, drawer.getByRole("button", { name: "Cerrar navegación" }), false, false, "nav-close");
          await page.keyboard.press("Escape");
          await expect(drawer).not.toBeVisible();
          await expectKeyboardFocus(page.getByRole("button", { name: "Abrir navegación" }), false, "nav-trigger");
        }
        const realCount = page.getByRole("banner").getByRole("link", { name: /^\d+ elemento\(s\) de revisión pendiente\(s\)$/ });
        await expect(realCount).toHaveText("1 elemento(s) de revisión pendiente(s)");
        await tabTo(page, realCount, false, false, "header-count");
        const region = page.getByRole("region", { name: REVIEW_REGION_LABEL });
        await tabTo(page, region, false, true, "review-table-region");
        if (width < 1024) {
          const before = await region.evaluate((element) => element.scrollLeft);
          await page.keyboard.press("ArrowRight");
          await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(before);
        }
        const previous = page.getByRole("link", { name: PREVIOUS_PAGE });
        const nextPage = page.getByRole("link", { name: NEXT_PAGE });
        await tabTo(page, previous, false, false, "pager-previous-50");
        await tabTo(page, nextPage, false, false, "pager-next-50");
        await tabTo(page, previous, true, false, "pager-previous-50");
        if (width === 1440) {
          await page.keyboard.press("Enter");
          await expect(page).toHaveURL(/\/review\?offset=0$/);
          await expectReviewWindow(page, 50, "2026-01-01T00:00:00.000Z");
        } else {
          await tabTo(page, nextPage, false, false, "pager-next-50");
          await page.keyboard.press("Enter");
          await expect(page).toHaveURL(/\/review\?offset=100$/);
          await expectReviewWindow(page, 1, "2026-01-01T00:01:40.000Z");
          await expect(nextPage).toHaveCount(0);
        }
      }
    });
  });

  test("test_controlled_review_denial_is_presentation_evidence_only", async ({ page, next }) => {
    let matched = 0;
    next.onFetch(createReviewStateHandler(assertE2eEnvironment(process.env).NEXT_PUBLIC_SUPABASE_URL, () => { matched += 1; }));
    await withReviewItem(page, async () => {
      await page.goto("/review");
      await expect(page.getByRole("main")).toContainText("No se pudo autorizar la cola de revisión.");
      await expect(page.getByRole("table")).toHaveCount(0);
      expect(matched).toBe(1);
    });
  });

  test("test_review_loading_holds_static_geometry_until_the_validated_fetch_settles", async ({ page, next }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let matched = 0;
    next.onFetch(createReviewStateHandler(
      assertE2eEnvironment(process.env).NEXT_PUBLIC_SUPABASE_URL,
      () => { matched += 1; },
      async () => {
        await held;
        return Response.json(REVIEW_SAFE_STATE_PAYLOADS.authorized_empty);
      },
    ));
    try {
      await withReviewItem(page, async () => {
        // Do not wait for load/network completion while the server response is held.
        await page.goto("/review", { waitUntil: "commit" });
        const main = page.getByRole("main");
        await expect(main.getByRole("status")).toHaveText("Cargando cola de revisión…");
        await expect.poll(() => matched).toBeGreaterThan(0);
        for (const width of [320, 390, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          const header = main.getByRole("heading", { level: 1, name: "Cola de revisión" });
          await expect(header).toBeVisible();
          const titleBox = await header.boundingBox();
          const panels = main.locator('[aria-hidden="true"]');
          await expect(panels).toHaveCount(2);
          const attentionBox = await panels.nth(0).boundingBox();
          const resultsBox = await panels.nth(1).boundingBox();
          if (!titleBox || !attentionBox || !resultsBox) throw new Error("loading geometry missing");
          expect(attentionBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
          expect(resultsBox.y).toBeGreaterThanOrEqual(attentionBox.y + attentionBox.height);
          expect(resultsBox.height).toBeGreaterThanOrEqual(192);
          await expectDocumentNotToOverflow(page);
        }
        const placeholders = main.locator(".review-queue__placeholder");
        for (const motion of ["no-preference", "reduce"] as const) {
          await page.emulateMedia({ reducedMotion: motion });
          const animations = await placeholders.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).animationName));
          expect(animations).toEqual(Array(5).fill("none"));
        }
        await expect(main).not.toContainText(/\d|Mostrando|elementos requieren revisión|Oculto por alcance/);
        await expect(main.getByRole("table")).toHaveCount(0);
        for (const value of Object.values(REVIEW_ITEM)) await expect(main).not.toContainText(value);
        release();
        await expect(main.getByRole("status", { name: "Sin elementos pendientes" })).toBeVisible();
        await expect(main).not.toContainText("Cargando cola de revisión");
        await expect(placeholders).toHaveCount(0);
      });
    } finally {
      release();
    }
  });

  test("test_review_technical_failure_recovers_by_keyboard_with_a_new_server_fetch", async ({ page, next }) => {
    let matched = 0;
    let recover = false;
    const sentinel = "PRIVATE_REVIEW_FAILURE_SENTINEL";
    next.onFetch(createReviewStateHandler(
      assertE2eEnvironment(process.env).NEXT_PUBLIC_SUPABASE_URL,
      () => { matched += 1; },
      () => recover
        ? Response.json(REVIEW_SAFE_STATE_PAYLOADS.authorized_empty)
        : Response.json({ message: sentinel, details: sentinel, hint: sentinel }, { status: 503 }),
    ));
    await withReviewItem(page, async () => {
      await page.goto("/review");
      const main = page.getByRole("main");
      const alert = main.getByRole("alert", { name: "No se pudo cargar la revisión" });
      await expect(alert).toBeVisible();
      expect(matched).toBeGreaterThan(0);
      await expect(main).not.toContainText(/\d|Mostrando|elementos requieren revisión|Oculto por alcance/);
      await expect(page.locator("body")).not.toContainText(sentinel);
      await expect(main.getByRole("table")).toHaveCount(0);
      for (const value of Object.values(REVIEW_ITEM)) await expect(main).not.toContainText(value);
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(alert).toBeVisible();
        await expectDocumentNotToOverflow(page);
      }
      const retry = alert.getByRole("button", { name: "Reintentar carga" });
      await retry.focus();
      await expect(retry).toBeFocused();
      const failures = matched;
      recover = true;
      await retry.press("Enter");
      await expect(main.getByRole("status", { name: "Sin elementos pendientes" })).toBeVisible();
      expect(matched).toBeGreaterThan(failures);
      await expect(alert).toHaveCount(0);
      await expect(retry).toHaveCount(0);
      await expect(page).toHaveURL(/\/review$/);
      await expect(main.getByRole("table")).toHaveCount(0);
    });
  });

  const safeStates = [
    { status: "authorized_empty", role: "status", title: "Sin elementos pendientes", copy: "No hay elementos de revisión pendientes." },
    { status: "authorization_denied", role: "alert", title: "Acceso no autorizado", copy: "No se pudo autorizar la cola de revisión." },
    { status: "payload_too_large", role: "alert", title: "Respuesta fuera del límite seguro", copy: "La respuesta de la cola de revisión supera el límite seguro." },
    { status: "unavailable", role: "alert", title: "Cola no disponible", copy: "La cola de revisión no está disponible por el momento." },
  ] as const;

  for (const state of safeStates) {
    test(`test_controlled_review_${state.status}_has_safe_responsive_attention`, async ({ page, next }) => {
      let matched = 0;
      next.onFetch(createReviewStateHandler(
        assertE2eEnvironment(process.env).NEXT_PUBLIC_SUPABASE_URL,
        () => { matched += 1; },
        () => Response.json(REVIEW_SAFE_STATE_PAYLOADS[state.status]),
      ));
      await withReviewItem(page, async () => {
        await page.goto("/review");
        const main = page.getByRole("main");
        const title = main.getByRole("heading", { level: 1, name: "Cola de revisión" });
        const attention = main.getByRole(state.role, { name: state.title });
        for (const width of [320, 390, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          await page.evaluate(async () => { await document.fonts.ready; });
          await expect(title).toBeVisible();
          await expect(main.getByText("Operaciones · revisión", { exact: true })).toBeVisible();
          await expect(attention.getByRole("heading", { level: 2, name: state.title })).toBeVisible();
          await expect(attention.getByText("Atención operativa", { exact: true })).toBeVisible();
          await expect(attention.getByText(state.copy, { exact: true })).toBeVisible();
          const titleBox = await title.boundingBox();
          const panelBox = await attention.boundingBox();
          if (!titleBox || !panelBox) throw new Error("safe review hierarchy has no layout box");
          expect(panelBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
          const panelStyle = await attention.evaluate((element) => {
            const style = getComputedStyle(element);
            return { rail: style.borderBlockStartWidth, background: style.backgroundColor };
          });
          expect(panelStyle.rail).toBe("3px");
          expect(panelStyle.background).toBe(state.role === "alert" ? "rgb(255, 244, 219)" : "rgb(233, 236, 232)");
          await expectDocumentNotToOverflow(page);
          await expectReducedMotion(page, attention);
        }
        // Presentation evidence only: layout count requests still reach the DB.
        expect(matched).toBe(1);
        await expect(main.getByRole("table")).toHaveCount(0);
        await expect(main.getByRole("navigation")).toHaveCount(0);
        await expect(main.getByRole("region", { name: REVIEW_REGION_LABEL })).toHaveCount(0);
        await expect(main).not.toContainText(/\d|Mostrando|elementos requieren revisión|Oculto por alcance/);
        for (const value of Object.values(REVIEW_ITEM)) await expect(main).not.toContainText(value);
        for (const other of safeStates) {
          if (other.status !== state.status) await expect(main).not.toContainText(other.copy);
        }
      });
    });
  }

  test("test_authenticated_route_projects_review_summary_without_page_overflow", async ({
    page,
  }) => {
    await withReviewItem(page, async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");
      await expect(page).toHaveURL(/\/$/);

      const dashboardMain = page.getByRole("main");
      await dashboardMain
        .getByRole("link", { name: "Consultar revisión", exact: true })
        .click();

      await expect(page).toHaveURL(/\/review/);
      const main = page.getByRole("main");
      await expect(
        main.getByRole("heading", { name: "Cola de revisión" }),
      ).toBeVisible();
      await expect(main).toContainText(READ_ONLY_NOTICE);
      await expect(
        main.getByText("Resolver elementos de revisión", { exact: true }),
      ).toHaveCount(0);
      await expectPopulatedReviewLayout(
        page,
        { width: 390, height: 844 },
        true,
      );
      await expectPopulatedReviewLayout(
        page,
        { width: 320, height: 844 },
        true,
      );
      // Three authorized fields fit a tablet without a five-column scroll budget.
      await expectPopulatedReviewLayout(
        page,
        { width: 900, height: 900 },
        false,
      );
      await expectPopulatedReviewLayout(
        page,
        { width: 1440, height: 900 },
        false,
      );
    });

    await page.reload();
    const main = page.getByRole("main");
    await expect(main).toContainText("No se pudo autorizar la cola de revisión.");
    await expect(main).toContainText(
      "No se pudo autorizar la cola de revisión.",
    );
    await expect(main.getByRole("table")).toHaveCount(0);
    await expectDocumentNotToOverflow(page);
  });
});
