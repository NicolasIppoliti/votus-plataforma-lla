import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("scopes organization controls to navigation or the inline selection region, never the whole page", () => {
  const directory = fileURLToPath(new URL(".", import.meta.url));
  const violations = readdirSync(directory)
    .filter(name => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"))
    .flatMap(name => readFileSync(new URL(name, import.meta.url), "utf8").split("\n")
      .flatMap((line, index) => /\bpage\.getByRole\(["'](?:combobox|button)["'],\s*\{\s*name:\s*["'](?:Organización|Cambiar organización)["']/.test(line)
        ? [`${name}:${index + 1}: ${line.trim()}`] : []));
  expect(violations).toEqual([]);
});
