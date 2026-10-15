import { expect, test, type Locator, type Page } from "@playwright/test";
import { MOBILE_FORM_ATTACHMENT, MOBILE_FORM_CONTENT_TYPE, MOBILE_FORM_FACTS_LIMIT, mobileFormFactsSchema, type MobileFormFacts } from "./mobile-form-facts";

/** Geometry only: no screenshots, control values, credentials or electoral rows.
 * The same assertions stay blocking; only failures emit bounded inline facts. */
export async function expectMobileFormGeometry(page: Page, root: Locator): Promise<void> {
  let facts: MobileFormFacts = { version: 1, phase: "fonts", index: null, viewportWidth: page.viewportSize()?.width ?? 0 };
  try {
    await page.evaluate(() => document.fonts.ready);
    facts = { ...facts, phase: "page" };
    const pageGeometry = await page.evaluate(() => ({ kind: "page" as const, documentWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    facts = { ...facts, sample: pageGeometry };
    expect(pageGeometry.documentWidth <= pageGeometry.clientWidth + 1, "page-level horizontal overflow").toBe(true);
    const fields = root.locator('input:not([type="hidden"]):visible, select:visible, textarea:visible');
    for (let index = 0; index < await fields.count(); index++) {
      const field = fields.nth(index);
      facts = { version: 1, phase: "field-scroll", index, viewportWidth: facts.viewportWidth };
      await field.scrollIntoViewIfNeeded();
      facts = { ...facts, phase: "field-geometry" };
      const geometry = await field.evaluate(element => {
        const control = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        const box = control.getBoundingClientRect();
        const labels = Array.from(control.labels ?? []);
        const bounded = (node: Element) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.right <= innerWidth + 1 && node.scrollWidth <= rect.width + 1;
        };
        const visibleLabels = labels.length > 0 && labels.every(label => {
          // Inline labels have zero clientWidth; ranges measure their rendered text.
          const range = document.createRange();
          range.selectNodeContents(label);
          return Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0).every(rect => rect.left >= -1 && rect.right <= innerWidth + 1)
            && getComputedStyle(label).visibility === "visible" && getComputedStyle(label).display !== "none";
        });
        const mirror = control.parentElement?.querySelector<HTMLElement>("[data-mobile-select-value]");
        const fullSelection = !(control instanceof HTMLSelectElement) || Boolean(mirror && bounded(mirror)
          && mirror.textContent?.trim() === control.selectedOptions[0]?.textContent?.trim()
          && getComputedStyle(mirror).whiteSpace === "normal");
        return {
          kind: "field" as const, tag: control.tagName.toLowerCase() as "input" | "select" | "textarea",
          width: box.width, height: box.height, left: box.left, right: box.right, scrollWidth: control.scrollWidth,
          labelCount: labels.length, mirrorPresent: Boolean(mirror), mirrorWidth: mirror?.getBoundingClientRect().width ?? 0, mirrorScrollWidth: mirror?.scrollWidth ?? 0,
          checks: { target: box.width >= 44 - 0.5 && box.height >= 44 - 0.5, bounded: bounded(control), visibleLabels, fullSelection },
        };
      });
      facts = { ...facts, sample: geometry };
      expect(geometry.checks, `field ${index}: 44px target, visible label, bounded control and full selected text`).toEqual({ target: true, bounded: true, visibleLabels: true, fullSelection: true });
    }
    const actions = root.locator('form button:visible, form summary:visible');
    for (let index = 0; index < await actions.count(); index++) {
      const action = actions.nth(index);
      facts = { version: 1, phase: "action-scroll", index, viewportWidth: facts.viewportWidth };
      await action.scrollIntoViewIfNeeded();
      facts = { ...facts, phase: "action-geometry" };
      const geometry = await action.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return {
          kind: "action" as const, width: rect.width, height: rect.height, left: rect.left, right: rect.right, scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight,
          valid: rect.width >= 43.5 && rect.height >= 43.5 && rect.left >= -1 && rect.right <= innerWidth + 1 && element.scrollWidth <= rect.width + 1 && element.scrollHeight <= rect.height + 1,
        };
      });
      facts = { ...facts, sample: geometry };
      expect(geometry.valid, `form action ${index}: 44px and no clipped copy`).toBe(true);
    }
  } catch (error) {
    try {
      const parsed = mobileFormFactsSchema.safeParse(facts);
      if (parsed.success) {
        const body = Buffer.from(JSON.stringify(parsed.data));
        if (body.byteLength <= MOBILE_FORM_FACTS_LIMIT) await test.info().attach(MOBILE_FORM_ATTACHMENT, { body, contentType: MOBILE_FORM_CONTENT_TYPE });
      }
    } catch { /* Diagnostics must never swallow or replace the assertion/timeout. */ }
    throw error;
  }
}
