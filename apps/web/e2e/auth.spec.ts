import { expect, test } from "@playwright/test";

/**
 * specs/access-control/spec.md, "No anonymous read path exists": no route
 * or query serving electoral data may return it without authentication,
 * including through cached or pre-rendered content.
 *
 * Requires a running Supabase stack (Auth + Postgres) and a seeded fixture
 * user, none of which are committed to the repo. If any required
 * environment variable is absent, this test skips explicitly with a clear
 * reason rather than failing or silently passing — see
 * apps/web/environment-variables.example.txt.
 */

const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"];
const SUPABASE_ANON_KEY = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
const TEST_USER_EMAIL = process.env["VOTUS_E2E_TEST_USER_EMAIL"];
const TEST_USER_PASSWORD = process.env["VOTUS_E2E_TEST_USER_PASSWORD"];

const hasE2eCredentials = Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY && TEST_USER_EMAIL && TEST_USER_PASSWORD,
);

// The in-scope content marker rendered only inside `(authenticated)/`
// routes (see `src/app/(authenticated)/dashboard/page.tsx`). No anonymous
// response, cached or otherwise, may ever contain it.
const IN_SCOPE_MARKER = "Votus dashboard";

test.describe("no anonymous read path", () => {
  test.skip(
    !hasE2eCredentials,
    "Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, " +
      "VOTUS_E2E_TEST_USER_EMAIL and VOTUS_E2E_TEST_USER_PASSWORD in the " +
      "environment (a running local Supabase stack plus a seeded fixture " +
      "user). None are committed to the repo — see " +
      "apps/web/environment-variables.example.txt. Skipping explicitly " +
      "rather than failing or silently passing.",
  );

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

    // 3. Authenticate as the seeded fixture user and confirm the in-scope
    //    route now genuinely serves data — proves step 1/2 were a real
    //    gate, not a route that is simply broken for everyone.
    await page.goto("/login");
    await page.getByLabel("Email").fill(TEST_USER_EMAIL as string);
    await page.getByLabel("Password").fill(TEST_USER_PASSWORD as string);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    expect(await page.content()).toContain(IN_SCOPE_MARKER);

    // 4. Drop the session (simulating logout) and reload the SAME page via
    //    a hard navigation, which is exactly the path a stale
    //    revalidated/prerendered/back-forward-cached copy would take. The
    //    now-anonymous browser must be redirected again — no cached
    //    authenticated render may be served.
    await context.clearCookies();
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/login/);
    expect(await page.content()).not.toContain(IN_SCOPE_MARKER);

    // 5. And the raw HTTP layer again, now with no session cookie at all —
    //    covers any cache keyed purely on the URL rather than on identity.
    const postLogoutResponse = await context.request.get("/dashboard", {
      maxRedirects: 0,
    });
    expect([301, 302, 307, 308]).toContain(postLogoutResponse.status());
    expect(await postLogoutResponse.text()).not.toContain(IN_SCOPE_MARKER);
  });
});
