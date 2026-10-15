import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps map labels out of the client-reference boundary used by the rendered explorer", () => {
  const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  expect(page).not.toMatch(/import\s*\{[^}]*MAP_HEADING[^}]*\}\s*from\s*["']\.\/TerritorialMapStage["']/);
});
