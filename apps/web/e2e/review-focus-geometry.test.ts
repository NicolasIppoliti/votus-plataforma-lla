import { expect, test, vi } from "vitest";
import { writeReviewFocusGeometry } from "./review-focus-geometry";

const snapshot = {
  effectiveOpacity: 1, opaque: true, intersects: false, contained: false,
  target: { left: -80, top: 12, right: -20, bottom: 56, width: 60, height: 44 },
  viewport: { innerWidth: 320, innerHeight: 450, outerWidth: 640, outerHeight: 900, scrollX: 0, scrollY: 12 },
  dialog: {
    rect: { left: 0, top: 0, right: 320, bottom: 450, width: 320, height: 450 },
    clientHeight: 450, scrollHeight: 700, scrollTop: 20,
  },
};

test("writes the captured failed geometry to the fixed private exclusive output file", async () => {
  const writer = vi.fn().mockResolvedValue(undefined);
  const outputPath = vi.fn((name: string) => `case-output/${name}`);
  expect(await writeReviewFocusGeometry({ control: "nav-close", snapshot }, { outputPath }, writer)).toBe(true);
  expect(outputPath).toHaveBeenCalledWith("review-focus-geometry.json");
  expect(writer).toHaveBeenCalledWith("case-output/review-focus-geometry.json", expect.any(String), { mode: 0o600, flag: "wx" });
  const call = writer.mock.calls[0];
  if (!call) throw new Error("Geometry was not written");
  expect(JSON.parse(call[1])).toEqual({ control: "nav-close", snapshot });
  expect(Buffer.byteLength(call[1])).toBeLessThanOrEqual(4096);
});

test.each([
  { control: "synthetic-secret", snapshot },
  { control: "nav-close", snapshot, secret: "synthetic-secret" },
  { control: "nav-close", snapshot: { ...snapshot, secret: "x".repeat(8192) } },
  { control: "nav-close", snapshot: { ...snapshot, target: { ...snapshot.target, left: "synthetic-secret" } } },
  ...[NaN, Infinity, -Infinity, 1_000_001].map((left) => ({
    control: "nav-close", snapshot: { ...snapshot, target: { ...snapshot.target, left } },
  })),
  { control: "nav-close", snapshot: { ...snapshot, viewport: { ...snapshot.viewport, url: "synthetic-secret" } } },
  { control: "nav-close", snapshot: { ...snapshot, dialog: { ...snapshot.dialog, text: "synthetic-secret" } } },
  { control: "nav-close", snapshot: { ...snapshot, intersects: true } },
])("rejects unsafe or non-failing input without requesting an output path", async (capture) => {
  const writer = vi.fn();
  const outputPath = vi.fn();
  expect(await writeReviewFocusGeometry(capture, { outputPath }, writer)).toBe(false);
  expect(outputPath).not.toHaveBeenCalled();
  expect(writer).not.toHaveBeenCalled();
});

test("supports no open dialog and the closed unlabelled fallback", async () => {
  const writer = vi.fn().mockResolvedValue(undefined);
  const capture = { control: "unlabelled", snapshot: { ...snapshot, dialog: null } };
  expect(await writeReviewFocusGeometry(capture, { outputPath: (name) => name }, writer)).toBe(true);
  const call = writer.mock.calls[0];
  if (!call) throw new Error("Geometry was not written");
  expect(JSON.parse(call[1])).toEqual(capture);
});

test.each(["path", "write", "existing-file"])("diagnostic failure (%s) preserves the captured false assertion", async (failure) => {
  const capture = { control: "nav-close", snapshot: structuredClone(snapshot) };
  const outputPath = () => {
    if (failure === "path") throw new Error("synthetic-secret");
    return "case-output/review-focus-geometry.json";
  };
  const writer = vi.fn().mockRejectedValue(new Error("synthetic-secret"));
  expect(await writeReviewFocusGeometry(capture, { outputPath }, writer)).toBe(false);
  expect(capture.snapshot.intersects).toBe(false);
  expect(() => expect(capture.snapshot.intersects).toBe(true)).toThrow();
});
