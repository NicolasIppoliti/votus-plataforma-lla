import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), "src/app", path), "utf8");

it("the production shell loads one authenticated page geometry contract", () => {
  expect(source("(authenticated)/ApplicationShell.tsx")).toContain('import "./page-container.css"');
  const css = source("(authenticated)/page-container.css");
  expect(css).toContain("#main-content.app-content");
  expect(css).toContain("padding-inline: var(--content-gutter)");
  expect(css).toContain("max-width: var(--max-content-width)");
  expect(css).toContain("#main-content > main .shell-container");
  expect(css).toContain("font-size: 2rem");
  expect(css).toContain("font-size: 1.75rem");
});
