import { expect, test } from "@playwright/test";

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
// routes (see `src/app/(authenticated)/dashboard/page.tsx`). No anonymous
// response, cached or otherwise, may ever contain it.
const IN_SCOPE_MARKER = "Panel de Votus";
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

test.describe("no anonymous read path", () => {
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

    // 3. The real login form remains centered, stacked, touch-sized, and
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
      const cardBottomGap = viewport.height - card.y - card.height;

      expect(Math.abs(card.x - cardRightGap)).toBeLessThanOrEqual(2);
      expect(Math.abs(card.y - cardBottomGap)).toBeLessThanOrEqual(2);
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
    await expect(page).toHaveURL(/\/dashboard/);
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

    // 5. Every protected page exposes the same native submit control. Root
    //    lives outside the authenticated route-group layout, so it is checked
    //    explicitly alongside every grouped route.
    for (const route of PROTECTED_ROUTES) {
      await page.goto(route);
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
