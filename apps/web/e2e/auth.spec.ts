import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * specs/access-control/spec.md, "No anonymous read path exists": no route
 * or query serving electoral data may return it without authentication,
 * including through cached or pre-rendered content.
 *
 * The release gate provides an isolated Supabase stack and fixture user.
 * Missing inputs fail globally before this scenario can run.
 */

import {
  assertE2eEnvironment,
  assertLoopbackSessionCookieDelta,
  sameCookieIdentity,
  storageStateForSpec,
} from "./gate-contract";

const environment = assertE2eEnvironment(process.env);
const TEST_USER_EMAIL = environment.VOTUS_E2E_TEST_USER_EMAIL;
const TEST_USER_PASSWORD = environment.VOTUS_E2E_TEST_USER_PASSWORD;
test.use({ storageState: storageStateForSpec("e2e/auth.spec.ts", environment.VOTUS_E2E_STORAGE_STATE) });

// The in-scope content marker rendered only inside `(authenticated)/`
// routes (see `src/app/(authenticated)/page.tsx`). No anonymous
// response, cached or otherwise, may ever contain it.
const IN_SCOPE_MARKER = "Panel operativo";
const PROTECTED_ROUTES = [
  "/",
  "/dashboard",
  "/compare",
  "/drilldown",
  "/fiscalizacion",
  "/municipal",
  "/review",
  "/simulate",
] as const;

async function signInToMonitoredPage(page: Page): Promise<void> {
  await page.clock.install();
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(TEST_USER_EMAIL);
  await page.getByLabel("Contraseña").fill(TEST_USER_PASSWORD);
  const initialProbe = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/session");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect((await initialProbe).status()).toBe(200);
}

const isSessionProbe = (request: { url(): string }): boolean => new URL(request.url()).pathname === "/api/session";

test.describe("no anonymous read path", () => {
  test("an already-open protected page returns to login when its session disappears", async ({ page, context }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.clock.install();
    await page.goto("/login");
    const beforeLogin = await context.cookies();
    await page.getByLabel("Correo electrónico").fill(TEST_USER_EMAIL);
    await page.getByLabel("Contraseña").fill(TEST_USER_PASSWORD);
    const initialProbe = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/session");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: IN_SCOPE_MARKER, exact: true })).toBeVisible();

    // A real hydrated control establishes that the protected shell is running.
    await page.getByRole("combobox", { name: "Tema", exact: true }).selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const healthy = await initialProbe;
    expect(healthy.status()).toBe(200);
    expect(healthy.headers()["cache-control"]).toBe("private, no-store, max-age=0");
    const healthyBody = await healthy.json();
    expect(Object.keys(healthyBody)).toEqual(["status"]);
    expect(["active", "selection_required"]).toContain(healthyBody.status);
    const sessionCookies = assertLoopbackSessionCookieDelta(beforeLogin, await context.cookies(), environment.VOTUS_E2E_BASE_URL);
    for (const cookie of sessionCookies) {
      await context.clearCookies({ name: cookie.name, domain: cookie.domain, path: cookie.path });
    }

    // No click or page navigation: only the bounded lifecycle timer advances.
    await page.clock.fastForward(60_000);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: IN_SCOPE_MARKER, exact: true })).toHaveCount(0);
  });

  test("temporary failures and changed membership do not end an idle session; fixed expiry does", async ({ page }) => {
    await signInToMonitoredPage(page);
    let state = "active";
    await page.route("**/api/session", async (route) => {
      if (state === "network") return route.abort("failed");
      await route.fulfill({ status: state === "unavailable" ? 503 : 200, json: { status: state } });
    });

    for (state of ["network", "unavailable", "stale", "denied", "mismatch", "selection_required", "unknown", "active"]) {
      const settled = state === "network"
        ? page.waitForEvent("requestfailed", isSessionProbe)
        : page.waitForResponse(isSessionProbe).then((response) => response.finished());
      await page.clock.fastForward(60_000);
      await settled;
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole("heading", { name: IN_SCOPE_MARKER, exact: true })).toBeVisible();
    }

    state = "expired";
    await page.clock.fastForward(60_000);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: IN_SCOPE_MARKER, exact: true })).toHaveCount(0);
  });

  test("a focus check detects workspace revocation without waiting for the interval", async ({ page }) => {
    await signInToMonitoredPage(page);
    await page.route("**/api/session", (route) => route.fulfill({ status: 200, json: { status: "revoked" } }));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page).toHaveURL(/\/login$/);
  });

  test("session checks are single-flight, time out safely, and pause while hidden", async ({ page }) => {
    await signInToMonitoredPage(page);
    let requests = 0;
    let delayed: Route | undefined;
    let delay = true;
    await page.route("**/api/session", async (route) => {
      requests += 1;
      if (delay) { delayed = route; return; }
      await route.fulfill({ status: 200, json: { status: "active" } });
    });

    await page.clock.fastForward(60_000);
    await expect.poll(() => requests).toBe(1);
    await page.evaluate(() => {
      for (let index = 0; index < 3; index += 1) window.dispatchEvent(new Event("focus"));
    });
    expect(requests).toBe(1);
    const timedOut = page.waitForEvent("requestfailed", isSessionProbe);
    await page.clock.fastForward(10_000);
    await timedOut;
    await expect(page).toHaveURL(/\/$/);

    // The browser visibility API is controlled at its environmental boundary;
    // no production monitor state, tokens or private counters are accessed.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.fastForward(60_000);
    expect(requests).toBe(1);
    delay = false;
    const recovered = page.waitForResponse(isSessionProbe);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect((await recovered).status()).toBe(200);
    expect(requests).toBe(2);
    // A response arriving after its request was aborted cannot end the page.
    await delayed!.fulfill({ status: 401, json: { status: "unauthenticated" } });
    await expect(page).toHaveURL(/\/$/);
    await page.evaluate(() => { Reflect.deleteProperty(document, "hidden"); });
  });

  test("test_no_anonymous_read_path_including_cached_content", async ({
    page,
    context,
  }) => {
    // 1. A plain anonymous request never reaches in-scope content: it is
    //    redirected to /login and the response contains no data marker.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    expect(await page.content()).not.toContain(IN_SCOPE_MARKER);

    // 2. Same assertion at the raw HTTP layer (no JS/browser rendering
    //    involved), so a server-rendered or statically-served copy cannot
    //    hide behind client-side navigation.
    const anonymousResponse = await context.request.get("/dashboard", {
      maxRedirects: 0,
    });
    expect([301, 302, 307, 308]).toContain(anonymousResponse.status());
    const anonymousBody = await anonymousResponse.text();
    expect(anonymousBody).not.toContain(IN_SCOPE_MARKER);

    // 3. The branded login composition remains centered, stacked, touch-sized, and
    //    overflow-free at the two release viewports. Its persistent feedback
    //    row keeps an invalid sign-in from shifting or overlapping controls.
    const viewports = [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ] as const;

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto("/login");

      const loginCard = page.getByRole("region", { name: "Iniciar sesión" });
      const loginForm = page.getByRole("form", { name: "Iniciar sesión" });
      const brand = page.locator(".login-brand");
      await expect(brand).toContainText("Votus");
      await expect(brand).toContainText("Análisis electoral, con evidencia.");
      const emailInput = page.getByLabel("Correo electrónico");
      const passwordInput = page.getByLabel("Contraseña");
      const submitButton = page.getByRole("button", {
        name: "Iniciar sesión",
      });

      await expect(loginCard).toBeVisible();
      await expect(loginForm).toBeVisible();

      const [cardBox, formBox, emailBox, passwordBox, submitBox] =
        await Promise.all([
          loginCard.boundingBox(),
          loginForm.boundingBox(),
          emailInput.boundingBox(),
          passwordInput.boundingBox(),
          submitButton.boundingBox(),
        ]);

      expect(cardBox).not.toBeNull();
      expect(formBox).not.toBeNull();
      expect(emailBox).not.toBeNull();
      expect(passwordBox).not.toBeNull();
      expect(submitBox).not.toBeNull();

      const card = cardBox!;
      const form = formBox!;
      const email = emailBox!;
      const password = passwordBox!;
      const submit = submitBox!;
      const cardRightGap = viewport.width - card.x - card.width;
      const brandBox = await brand.boundingBox();
      const pageBox = await page.getByRole("main").boundingBox();
      expect(brandBox).not.toBeNull();
      expect(pageBox).not.toBeNull();
      const compositionTopGap = brandBox!.y - pageBox!.y;
      const compositionBottomGap = pageBox!.y + pageBox!.height - card.y - card.height;

      expect(Math.abs(card.x - cardRightGap)).toBeLessThanOrEqual(2);
      expect(Math.abs(compositionTopGap - compositionBottomGap)).toBeLessThanOrEqual(2);
      expect(compositionTopGap).toBeGreaterThanOrEqual(32);
      expect(brandBox!.y + brandBox!.height).toBeLessThan(card.y);
      expect(card.y).toBeGreaterThanOrEqual(0);
      expect(card.width).toBeLessThanOrEqual(
        Math.min(512, viewport.width - 32) + 1,
      );
      expect(email.height).toBeGreaterThanOrEqual(48);
      expect(password.height).toBeGreaterThanOrEqual(48);
      expect(submit.height).toBeGreaterThanOrEqual(48);
      expect(Math.abs(email.x - form.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(email.width - form.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(email.x - password.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(email.x - submit.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(email.width - password.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(email.width - submit.width)).toBeLessThanOrEqual(1);
      expect(email.y + email.height).toBeLessThan(password.y);
      expect(password.y + password.height).toBeLessThan(submit.y);
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);

      if (viewport.width === 390) {
        expect(
          Math.abs(card.width - (viewport.width - 32)),
        ).toBeLessThanOrEqual(2);

        await emailInput.fill("invalid@example.com");
        await passwordInput.fill("invalid-password");
        await submitButton.click();

        const errorMessage = page.locator("#login-error");
        await expect(errorMessage).toHaveText("Las credenciales no son válidas.");
        await expect(emailInput).toHaveAttribute("aria-invalid", "true");
        await expect(passwordInput).toHaveAttribute("aria-invalid", "true");
        await expect(emailInput).toHaveAttribute(
          "aria-describedby",
          "login-error",
        );
        await expect(passwordInput).toHaveAttribute(
          "aria-describedby",
          "login-error",
        );

        const dangerColor = await loginForm.evaluate((form) => {
          const token = getComputedStyle(form).getPropertyValue("--danger").trim();
          if (!token) throw new Error("The Votus --danger token must be defined");
          const probe = document.createElement("span");
          probe.style.color = "var(--danger)";
          probe.hidden = true;
          form.append(probe);
          const resolvedColor = getComputedStyle(probe).color;
          probe.remove();
          return resolvedColor;
        });
        for (const input of [emailInput, passwordInput]) {
          await expect(input).toBeVisible();
          await expect.soft(input).toHaveCSS("border-color", dangerColor);
        }
        await expect(errorMessage).toBeVisible();
        await expect.soft(errorMessage).toHaveCSS("color", dangerColor);

        const [formAfterErrorBox, errorBox] = await Promise.all([
          loginForm.boundingBox(),
          errorMessage.boundingBox(),
        ]);
        expect(formAfterErrorBox).not.toBeNull();
        expect(errorBox).not.toBeNull();
        expect(
          Math.abs(formAfterErrorBox!.height - form.height),
        ).toBeLessThanOrEqual(1);
        expect(errorBox!.y).toBeGreaterThanOrEqual(submit.y + submit.height);
      }
    }

    // 4. Authenticate as the seeded fixture user and confirm the in-scope
    //    route now genuinely serves data — proves step 1/2 were a real
    //    gate, not a route that is simply broken for everyone.
    await page.goto("/login");
    const cookiesBeforeLogin = await context.cookies();
    await page.getByLabel("Correo electrónico").fill(TEST_USER_EMAIL);
    await page.getByLabel("Contraseña").fill(TEST_USER_PASSWORD);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(await page.content()).toContain(IN_SCOPE_MARKER);

    const sessionCookies = assertLoopbackSessionCookieDelta(
      cookiesBeforeLogin,
      await context.cookies(),
      environment.VOTUS_E2E_BASE_URL,
    );
    const scriptVisibleCookieNames = await page.evaluate(() =>
      document.cookie
        .split(";")
        .map((entry) => entry.trim().split("=", 1)[0])
        .filter((name): name is string => Boolean(name)),
    );
    for (const sessionCookie of sessionCookies)
      expect(scriptVisibleCookieNames).not.toContain(sessionCookie.name);

    // 5. Every protected page, including the canonical root briefing, exposes
    //    the same native submit control.
    for (const route of PROTECTED_ROUTES) {
      await page.goto(route);
      const trigger = page.getByRole("button", { name: "Abrir navegación" });
      if (await trigger.isVisible()) await trigger.click();
      await page.getByRole("group", { name: "Organización y cuenta", exact: true }).locator("summary").press("Enter");
      const signOutControl = page.getByRole("button", {
        name: "Cerrar sesión",
        exact: true,
      });
      await expect(signOutControl).toHaveCount(1);
      await expect(signOutControl).toBeVisible();
      await expect(signOutControl).toHaveAttribute("type", "submit");
    }

    // 6. Keyboard submission performs the real local server-side sign-out and
    //    redirects only after Supabase confirms success.
    const signOutControl = page.getByRole("button", {
      name: "Cerrar sesión",
      exact: true,
    });
    await signOutControl.focus();
    await expect(signOutControl).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/login/);

    const cookiesAfterSignOut = await context.cookies();
    const cookieNamesAfterSignOut = new Set(
      cookiesAfterSignOut.map(({ name }) => name),
    );
    for (const sessionCookie of sessionCookies) {
      expect(cookieNamesAfterSignOut.has(sessionCookie.name)).toBe(false);
      expect(
        cookiesAfterSignOut.some((cookie) =>
          sameCookieIdentity(cookie, sessionCookie),
        ),
      ).toBe(false);
    }

    // 7. A hard navigation to protected content stays anonymous after logout:
    //    no cached authenticated render may be served.
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/login/);
    expect(await page.content()).not.toContain(IN_SCOPE_MARKER);

    // 8. And the raw HTTP layer again, now with no session cookie at all —
    //    covers any cache keyed purely on the URL rather than on identity.
    const postLogoutResponse = await context.request.get("/dashboard", {
      maxRedirects: 0,
    });
    expect([301, 302, 307, 308]).toContain(postLogoutResponse.status());
    expect(await postLogoutResponse.text()).not.toContain(IN_SCOPE_MARKER);
  });
});
