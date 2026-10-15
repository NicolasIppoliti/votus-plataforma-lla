import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(__dirname, path), "utf8");

// A server component that imports a plain value from a "use client" module receives a
// client reference, not the value: `heading !== MAP_HEADING.REFERENCE` then holds for the
// reference map and its "Ver evidencia" link leaks into the locator (#450).
describe("map heading boundary", () => {
  it("serves MAP_HEADING to server components from a module without the client directive", () => {
    expect(read("map-heading.ts")).not.toMatch(/^["']use client["']/m);
    expect(read("page.tsx")).toMatch(/import \{ MAP_HEADING \} from "\.\/map-heading";/);
    expect(read("page.tsx")).not.toMatch(/import \{[^}]*MAP_HEADING[^}]*\} from "\.\/TerritorialMapStage"/);
  });
});
