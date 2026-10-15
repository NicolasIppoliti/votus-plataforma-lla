import { expect, type Locator, type Page } from "@playwright/test";

/** Geometry only: no screenshots, control values, credentials or electoral rows
 * are attached to diagnostics. Call after opening each route-owned disclosure. */
export async function expectMobileFormGeometry(page: Page, root: Locator): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), "page-level horizontal overflow").toBe(true);
  const fields = root.locator('input:not([type="hidden"]):visible, select:visible, textarea:visible');
  for (let index = 0; index < await fields.count(); index++) {
    const field = fields.nth(index);
    await field.scrollIntoViewIfNeeded();
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
        target: box.width >= 44 - 0.5 && box.height >= 44 - 0.5,
        bounded: bounded(control),
        visibleLabels,
        fullSelection,
      };
    });
    expect(geometry, `field ${index}: 44px target, visible label, bounded control and full selected text`).toEqual({ target: true, bounded: true, visibleLabels: true, fullSelection: true });
  }
  const actions = root.locator('form button:visible, form summary:visible');
  for (let index = 0; index < await actions.count(); index++) {
    const action = actions.nth(index);
    await action.scrollIntoViewIfNeeded();
    expect(await action.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.width >= 43.5 && rect.height >= 43.5 && rect.left >= -1 && rect.right <= innerWidth + 1 && element.scrollWidth <= rect.width + 1 && element.scrollHeight <= rect.height + 1;
    }), `form action ${index}: 44px and no clipped copy`).toBe(true);
  }
}
