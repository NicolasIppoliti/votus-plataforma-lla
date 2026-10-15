import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), writeFile: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("node:fs/promises", () => ({ writeFile: mocks.writeFile }));
vi.mock("../../../e2e/gate-contract", () => ({ assertE2eEnvironment: () => ({}) }));
import { withPanoramaResults } from "../../../e2e/panorama-result-fixture";

it("records a failing election insert without deleting unowned catalog entries or exposing database messages", async () => {
  const remove = vi.fn();
  mocks.createClient.mockReturnValue({ from: (table: string) => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "existing-category" }, error: null }) }) }),
    insert: async () => ({ error: table === "election" ? { code: "23505", message: "private database detail" } : null }),
    delete: remove,
  }) });
  const run = vi.fn();
  await expect(withPanoramaResults(run, { outputPath: name => name })).rejects.toThrow("Panorama fixture or cleanup failed");
  expect(run).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  const [path, contents] = mocks.writeFile.mock.calls.at(-1)!;
  expect(path).toBe("e2e-facts-panorama-fixture.json");
  expect(JSON.parse(contents)).toMatchObject({ failures: [{ step: "election-insert", errorClass: "Error", sqlState: "23505" }], owned: { categoryCount: 0 } });
  expect(contents).not.toContain("private database detail");
  expect(contents).not.toContain("existing-category");
});
