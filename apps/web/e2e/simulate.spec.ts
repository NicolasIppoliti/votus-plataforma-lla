import { expect, test } from "@playwright/test";

const PROJECTION = {
  level: "pba_municipal",
  totalVotes: 10_000,
  blankVotes: 0,
  annulledVotes: 0,
  unmodeledVotes: 0,
  unmodeledVoteBreakdown: [],
  seatsToFill: 9,
  isProjection: true,
  granularity: "seccion",
  lists: [
    { listId: "A", listName: "Projection list A", votes: 6_000 },
    { listId: "B", listName: "Projection list B", votes: 4_000 },
  ],
};

test.describe("the simulation route labels caller-supplied projections", () => {
  test("test_projection_discloses_input_method_and_non_provenance", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole("navigation", { name: "principal" }).getByRole("link", { name: "Simulación de bancas", exact: true }).click();
    await expect(page).toHaveURL(/\/simulate/);
    await page.goto(`/simulate?input=${encodeURIComponent(JSON.stringify(PROJECTION))}`);

    const result = page.getByRole("region", { name: "Resultado de la asignación" });
    await expect(result.getByRole("heading", { name: "Resultado (municipal de PBA)" })).toBeVisible();
    await expect(result).toContainText("Proyección hipotética aportada por quien realiza la consulta");
    await expect(result.getByRole("status", { name: "granularidad: seccion" })).toBeVisible();
    await expect(result).toContainText(/Huella de los datos proporcionados \(no es procedencia de archivo\): sha256 [a-f0-9]{64}/);
    await expect(
      result.getByRole("heading", { name: "Cociente Hare con mayor residuo" }),
    ).toBeVisible();
    await expect(result).toContainText("Método legal: Ley 5109, arts. 109–110");
    await expect(result.getByRole("link", { name: /archivo|fuente/i })).toHaveCount(0);
    await expect(result).not.toContainText("Resultado histórico oficial");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      )
      .toBe(true);

    const evidenceScroll = page.getByRole("region", {
      name: "Asignación Hare por lista",
    });
    await expect(evidenceScroll).toBeVisible();
    await expect(evidenceScroll).toHaveAttribute("tabindex", "0");
    await evidenceScroll.focus();
    await expect(evidenceScroll).toBeFocused();
  });
});
