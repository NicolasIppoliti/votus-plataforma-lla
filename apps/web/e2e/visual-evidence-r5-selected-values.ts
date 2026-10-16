import { expect, type Page } from "@playwright/test";

/** #501 S6b: native selects truncate long values on phones. Every visible
 * select must repeat its full selected option in the shared mirror, unclipped. */
export async function expectFullSelectedValues(page: Page): Promise<void> {
  const facts = await page.locator("select").evaluateAll(selects => selects
    .filter(select => select.getClientRects().length > 0)
    .map(select => {
      const element = select as HTMLSelectElement;
      const mirror = element.parentElement?.querySelector<HTMLElement>(":scope > [data-mobile-select-value]") ?? null;
      return {
        label: element.getAttribute("aria-label") ?? element.labels?.[0]?.textContent?.trim() ?? element.name,
        selected: element.selectedOptions[0]?.textContent?.trim() ?? "",
        mirror: mirror?.textContent?.trim() ?? null,
        mirrorVisible: mirror ? mirror.getClientRects().length > 0 && getComputedStyle(mirror).visibility !== "hidden" : false,
        mirrorClipped: mirror ? mirror.scrollWidth > mirror.clientWidth : true,
      };
    }));
  expect(facts.length, "visible selects at phone width").toBeGreaterThan(0);
  for (const fact of facts) {
    expect(fact, `${fact.label}: full selected value`).toEqual({ ...fact, mirror: fact.selected, mirrorVisible: true, mirrorClipped: false });
  }
}
