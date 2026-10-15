import { beforeEach, expect, it, vi } from "vitest";
import type { Locator, Page } from "@playwright/test";
const { attach } = vi.hoisted(() => ({ attach: vi.fn() }));
vi.mock("@playwright/test", async original => ({ ...await original<typeof import("@playwright/test")>(), test: { info: () => ({ attach }) } }));
const { expectMobileFormGeometry } = await import("./mobile-form-geometry");

function fixture({ overflow = false, scrollError }: { overflow?: boolean; scrollError?: Error } = {}) {
  const page = { viewportSize: () => ({ width: 320, height: 844 }), evaluate: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ kind: "page", documentWidth: overflow ? 400 : 320, clientWidth: 320 }) };
  const field = { scrollIntoViewIfNeeded: scrollError ? vi.fn().mockRejectedValue(scrollError) : vi.fn(), evaluate: vi.fn() };
  const fields = { count: async () => scrollError ? 1 : 0, nth: () => field };
  const root = { locator: () => fields };
  return { page: page as unknown as Page, root: root as unknown as Locator };
}
beforeEach(() => attach.mockReset());
it("attaches bounded page facts on an overflow assertion failure", async () => {
  const { page, root } = fixture({ overflow: true });
  await expect(expectMobileFormGeometry(page, root)).rejects.toThrow();
  expect(attach).toHaveBeenCalledOnce();
  expect(JSON.parse(attach.mock.calls[0]![1].body.toString())).toEqual({ version: 1, phase: "page", index: null, viewportWidth: 320, sample: { kind: "page", documentWidth: 400, clientWidth: 320 } });
});
it("identifies unreachable-field scrolling without replacing its original error", async () => {
  const error = new Error("SECRET original failure");
  const { page, root } = fixture({ scrollError: error });
  await expect(expectMobileFormGeometry(page, root)).rejects.toBe(error);
  expect(attach).toHaveBeenCalledOnce();
  const text = attach.mock.calls[0]![1].body.toString();
  expect(JSON.parse(text)).toEqual({ version: 1, phase: "field-scroll", index: 0, viewportWidth: 320 });
  expect(text).not.toContain("SECRET");
});
it("does not attach facts on success", async () => {
  const { page, root } = fixture();
  await expect(expectMobileFormGeometry(page, root)).resolves.toBeUndefined();
  expect(attach).not.toHaveBeenCalled();
});
it("keeps the assertion failure if optional attachment writing fails", async () => {
  attach.mockRejectedValueOnce(new Error("SECRET attachment failure"));
  const { page, root } = fixture({ overflow: true });
  await expect(expectMobileFormGeometry(page, root)).rejects.not.toThrow("SECRET attachment failure");
  expect(attach).toHaveBeenCalledOnce();
});
