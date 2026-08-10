import { expect, request, test } from "@playwright/test";

import { assertE2eEnvironment, emptyStorageState } from "./gate-contract";

const environment = assertE2eEnvironment(process.env);
const ROOT_CONTENT = "Votus scaffold — content added starting in Phase 9–11.";

test.describe("the production root preserves its authentication boundary", () => {
  test("test_root_redirects_anonymous_and_renders_landing_when_authenticated", async ({ page }) => {
    const anonymousContext = await request.newContext({ baseURL: environment.VOTUS_E2E_BASE_URL,
      storageState: emptyStorageState() });
    try {
      const anonymous = await anonymousContext.get("/", { maxRedirects: 0 });
      expect([301, 302, 307, 308]).toContain(anonymous.status());
      expect(anonymous.headers()["location"]).toMatch(/\/login$/);
      expect(await anonymous.text()).not.toContain(ROOT_CONTENT);
    } finally {
      await anonymousContext.dispose();
    }

    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("main")).toHaveText(ROOT_CONTENT);
  });
});
