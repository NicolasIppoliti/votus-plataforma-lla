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

const appearanceCapture = {
  version: 2, reason: "appearance", control: "nav-close",
  appearance: { active: true, focusVisible: true, outlineWidthPx: 0, outlineOffsetPx: 3, outlineStyle: "none" },
  snapshot: { ...snapshot, intersects: true },
};

test("rejects unversioned writer input without filesystem calls", async () => {
  const outputPath = vi.fn((name: string) => name);
  const writer = vi.fn().mockResolvedValue(undefined);
  expect(await writeReviewFocusGeometry({ control: "nav-close", snapshot }, { outputPath }, writer)).toBe(false);
  expect(outputPath).not.toHaveBeenCalled();
  expect(writer).not.toHaveBeenCalled();
});

test("writes versioned appearance failure with bounded private output", async () => {
  const writer = vi.fn().mockResolvedValue(undefined);
  expect(await writeReviewFocusGeometry(appearanceCapture, { outputPath: (name) => name }, writer)).toBe(true);
  expect(writer).toHaveBeenCalledWith("review-focus-geometry.json", JSON.stringify(appearanceCapture), { mode: 0o600, flag: "wx" });
  const call = writer.mock.calls[0];
  if (!call) throw new Error("Appearance was not written");
  expect(Buffer.byteLength(call[1])).toBeLessThanOrEqual(4096);
});

test("versioned off-viewport capture still requires failed intersection", async () => {
  const writer = vi.fn().mockResolvedValue(undefined);
  const output = { outputPath: (name: string) => name };
  const capture = { ...appearanceCapture, reason: "off-viewport", snapshot };
  expect(await writeReviewFocusGeometry(capture, output, writer)).toBe(true);
  expect(await writeReviewFocusGeometry({ ...capture, snapshot: { ...snapshot, intersects: true } }, output, writer)).toBe(false);
  expect(writer).toHaveBeenCalledTimes(1);
});

test.each([
  { ...appearanceCapture, version: 3 },
  { ...appearanceCapture, reason: "unknown" },
  { ...appearanceCapture, secret: "synthetic-secret" },
  ...[{ secret: "synthetic-secret" }, { outlineStyle: "unknown" }, { active: "true" }, { focusVisible: 1 },
    ...[NaN, Infinity, -Infinity, -1, 1_000_001].map((outlineWidthPx) => ({ outlineWidthPx })),
    ...[NaN, Infinity, -Infinity, -1_000_001, 1_000_001].map((outlineOffsetPx) => ({ outlineOffsetPx })),
  ].map((patch) => ({ ...appearanceCapture, appearance: { ...appearanceCapture.appearance, ...patch } })),
])("rejects unsafe appearance captures before resolving a path", async (capture) => {
  const outputPath = vi.fn();
  const writer = vi.fn();
  expect(await writeReviewFocusGeometry(capture, { outputPath }, writer)).toBe(false);
  expect(outputPath).not.toHaveBeenCalled();
  expect(writer).not.toHaveBeenCalled();
});

const offViewportCapture = { ...appearanceCapture, reason: "off-viewport", snapshot };

test("writes the captured failed geometry to the fixed private exclusive output file", async () => {
  const writer = vi.fn().mockResolvedValue(undefined);
  const outputPath = vi.fn((name: string) => `case-output/${name}`);
  expect(await writeReviewFocusGeometry(offViewportCapture, { outputPath }, writer)).toBe(true);
  expect(outputPath).toHaveBeenCalledWith("review-focus-geometry.json");
  expect(writer).toHaveBeenCalledWith("case-output/review-focus-geometry.json", expect.any(String), { mode: 0o600, flag: "wx" });
  const call = writer.mock.calls[0];
  if (!call) throw new Error("Geometry was not written");
  expect(JSON.parse(call[1])).toEqual(offViewportCapture);
  expect(Buffer.byteLength(call[1])).toBeLessThanOrEqual(4096);
});

test.each([
  { ...offViewportCapture, control: "synthetic-secret" },
  { ...offViewportCapture, secret: "synthetic-secret" },
  { ...offViewportCapture, snapshot: { ...snapshot, secret: "x".repeat(8192) } },
  { ...offViewportCapture, snapshot: { ...snapshot, target: { ...snapshot.target, left: "synthetic-secret" } } },
  ...[NaN, Infinity, -Infinity, 1_000_001].map((left) => ({
    ...offViewportCapture, snapshot: { ...snapshot, target: { ...snapshot.target, left } },
  })),
  { ...offViewportCapture, snapshot: { ...snapshot, viewport: { ...snapshot.viewport, url: "synthetic-secret" } } },
  { ...offViewportCapture, snapshot: { ...snapshot, dialog: { ...snapshot.dialog, text: "synthetic-secret" } } },
  { ...offViewportCapture, snapshot: { ...snapshot, intersects: true } },
])("rejects unsafe or non-failing input without requesting an output path", async (capture) => {
  const writer = vi.fn();
  const outputPath = vi.fn();
  expect(await writeReviewFocusGeometry(capture, { outputPath }, writer)).toBe(false);
  expect(outputPath).not.toHaveBeenCalled();
  expect(writer).not.toHaveBeenCalled();
});

test("supports no open dialog and the closed unlabelled fallback", async () => {
  const writer = vi.fn().mockResolvedValue(undefined);
  const capture = { ...offViewportCapture, control: "unlabelled", snapshot: { ...snapshot, dialog: null } };
  expect(await writeReviewFocusGeometry(capture, { outputPath: (name) => name }, writer)).toBe(true);
  const call = writer.mock.calls[0];
  if (!call) throw new Error("Geometry was not written");
  expect(JSON.parse(call[1])).toEqual(capture);
});

test.each([appearanceCapture, offViewportCapture])("projects $reason focus metadata outside the strict receiver", async (capture) => {
  const outputPath = vi.fn((name: string) => `case-output/${name}`);
  const writer = vi.fn().mockResolvedValue(undefined);
  const enriched = { ...capture, snapshot: { ...capture.snapshot, focus: {
    activeTarget: "drawer-trigger", documentFocused: true, targetConnected: true,
  } } };
  expect(await writeReviewFocusGeometry(enriched, { outputPath }, writer)).toBe(false);
  expect(outputPath).not.toHaveBeenCalled();
  expect(writer).not.toHaveBeenCalled();
  const { focus: _focus, ...canonical } = enriched.snapshot;
  void _focus;
  const projected = { ...capture, snapshot: canonical };
  expect(await writeReviewFocusGeometry(projected, { outputPath }, writer)).toBe(true);
  expect(writer).toHaveBeenCalledWith("case-output/review-focus-geometry.json", JSON.stringify(capture), { mode: 0o600, flag: "wx" });
  writer.mockRejectedValueOnce(new Error("synthetic write failure"));
  expect(await writeReviewFocusGeometry(projected, { outputPath }, writer)).toBe(false);
  expect(projected).toEqual(capture);
});

test.each(["path", "write", "existing-file"])("diagnostic failure (%s) preserves the captured false assertion", async (failure) => {
  const capture = { ...offViewportCapture, snapshot: structuredClone(snapshot) };
  const outputPath = () => {
    if (failure === "path") throw new Error("synthetic-secret");
    return "case-output/review-focus-geometry.json";
  };
  const writer = vi.fn().mockRejectedValue(new Error("synthetic-secret"));
  expect(await writeReviewFocusGeometry(capture, { outputPath }, writer)).toBe(false);
  expect(capture.snapshot.intersects).toBe(false);
  expect(() => expect(capture.snapshot.intersects).toBe(true)).toThrow();
});
