import { expect, type Page } from "@playwright/test";

/** Prepare an owned fixture through the production session-bound forms. */
export async function prepareOrganization(page: Page, organizationId: string, destination: string): Promise<void> {
  const target = new URL(destination, page.url());
  await page.goto(new URL(`/onboarding?${new URLSearchParams({ paso: "organizacion", returnTo: target.pathname + target.search })}`, target.origin).toString());
  const organization = page.getByRole("region", { name: "Elegí tu organización", exact: true });
  await organization.getByRole("combobox", { name: "Organización", exact: true }).selectOption(organizationId);
  await organization.getByRole("button", { name: "Continuar con esta organización", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tu alcance de trabajo", exact: true })).toBeVisible();
  const selected = await page.request.get(new URL("/api/workspace", target.origin).toString());
  expect(selected.ok()).toBe(true);
  expect(await selected.json()).toMatchObject({ status: "active", activeOrganizationId: organizationId });
  await finishFixtureOnboarding(page, target.toString());
}

export async function finishFixtureOnboarding(page: Page, destination: string): Promise<void> {
  const target = new URL(destination, page.url());
  await page.goto(new URL(`/onboarding?${new URLSearchParams({ paso: "ingreso", returnTo: target.pathname + target.search })}`, target.origin).toString());
  await page.getByRole("button", { name: "Ingresar a Votus", exact: true }).click();
  await expect(page).toHaveURL(target.toString());
  const completed = await page.request.get(new URL("/api/workspace", target.origin).toString());
  expect(completed.ok()).toBe(true);
  expect(await completed.json()).toMatchObject({ status: "active", onboardingCompleted: true });
}
