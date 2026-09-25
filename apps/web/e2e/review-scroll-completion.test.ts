import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { createReviewScrollObserver, withReviewScrollDiagnostics, writeReviewScrollCompletion } from "./review-scroll-completion";

class ScrollTarget extends EventTarget {
  scrollLeft = 0;
  scrollTop = 0;
  clientWidth = 280;
  scrollWidth = 600;
  isConnected = true;
}

class ArrowKey extends Event {
  key = "ArrowRight";
  altKey = false;
  ctrlKey = false;
  metaKey = false;
  shiftKey = false;
  override get isTrusted() { return true; }
}

afterEach(() => vi.unstubAllGlobals());
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function target() {
  const element = new ScrollTarget();
  vi.stubGlobal("document", { activeElement: element, hasFocus: () => true });
  vi.stubGlobal("KeyboardEvent", ArrowKey);
  return element as unknown as HTMLElement;
}

test("the real scroll observer exposes a bounded passive event history", () => {
  const element = target();
  const observer = createReviewScrollObserver(element);
  observer.reset();
  for (let index = 0; index < 20; index += 1) {
    element.scrollLeft = index;
    element.dispatchEvent(new Event("scroll"));
  }
  expect(observer.snapshot()).toEqual(expect.objectContaining({
    totalEvents: 21,
    droppedEvents: 5,
    events: expect.any(Array),
  }));
  expect(observer.snapshot().events).toHaveLength(16);
  expect(observer.snapshot().events[0]?.sequence).toBe(6);
  expect(observer.snapshot().events.at(-1)?.state.scrollLeft).toBe(19);
  observer.dispose();
});

test("the serialized browser factory preserves completion and invalidates settlement after actual movement", () => {
  const element = target();
  const factory = runInNewContext(`(${createReviewScrollObserver.toString()})`, {
    document, performance, KeyboardEvent: ArrowKey,
  }) as typeof createReviewScrollObserver;
  const observer = factory(element);
  observer.reset();
  element.dispatchEvent(new ArrowKey("keydown"));
  element.scrollLeft = 40;
  element.dispatchEvent(new Event("scroll"));
  expect(observer.completed()).toBe(false);
  element.dispatchEvent(new ArrowKey("keyup"));
  expect(observer.completed()).toBe(true);
  expect(observer.settled()).toBe(false);
  element.dispatchEvent(new Event("scrollend"));
  expect(observer.settled()).toBe(true);
  element.scrollLeft = 41;
  element.dispatchEvent(new Event("scroll"));
  expect(observer.completed()).toBe(true);
  expect(observer.settled()).toBe(false);
  const trace = observer.snapshot();
  expect(trace.events.map((event) => event.type)).toEqual(["reset", "keydown", "scroll", "keyup", "scrollend", "scroll"]);
  expect(trace.events[4]?.state.settled).toBe(true);
  expect(trace.events[5]?.state.settled).toBe(false);
  expect(trace.state).toMatchObject({ targetConnected: true, targetFocused: true, documentFocused: true });
  observer.dispose();
  element.dispatchEvent(new Event("scrollend"));
  expect(observer.snapshot()).toEqual(trace);
});

test("the serialized observer retains settlement for the hosted same-position notification sequence", () => {
  const element = target();
  const factory = runInNewContext(`(${createReviewScrollObserver.toString()})`, {
    document, performance, KeyboardEvent: ArrowKey,
  }) as typeof createReviewScrollObserver;
  const observer = factory(element);
  observer.reset();
  element.dispatchEvent(new ArrowKey("keydown"));
  element.dispatchEvent(new ArrowKey("keyup"));
  for (const left of [1, 4, 10, 17, 24, 31, 36, 39]) {
    element.scrollLeft = left;
    element.dispatchEvent(new Event("scroll"));
  }
  expect(observer.completed()).toBe(true);
  expect(observer.settled()).toBe(false);
  element.scrollLeft = 40;
  element.dispatchEvent(new Event("scrollend"));
  expect(observer.settled()).toBe(true);
  element.dispatchEvent(new Event("scroll"));
  expect(observer.settled()).toBe(true);
  expect(observer.completed()).toBe(true);
  expect(observer.snapshot()).toMatchObject({
    totalEvents: 13, droppedEvents: 0, eligibleScrollEnds: 1, settlementInvalidations: 0,
  });
  observer.dispose();
});

test.each(["scrollLeft", "scrollTop"] as const)("fractional %s movement requires a new end before settlement can return", (coordinate) => {
  const element = target();
  const factory = runInNewContext(`(${createReviewScrollObserver.toString()})`, {
    document, performance, KeyboardEvent: ArrowKey,
  }) as typeof createReviewScrollObserver;
  const observer = factory(element);
  observer.reset();
  element.dispatchEvent(new ArrowKey("keydown"));
  element.scrollLeft = 40;
  element.dispatchEvent(new Event("scroll"));
  element.dispatchEvent(new ArrowKey("keyup"));
  element.dispatchEvent(new Event("scroll"));
  expect(observer.settled()).toBe(false);
  element.dispatchEvent(new Event("scrollend"));
  expect(observer.settled()).toBe(true);
  const previous = element[coordinate];
  element[coordinate] += 0.25;
  element.dispatchEvent(new Event("scroll"));
  expect(observer.settled()).toBe(false);
  element.dispatchEvent(new Event("scroll"));
  expect(observer.settled()).toBe(false);
  element[coordinate] = previous;
  element.dispatchEvent(new Event("scroll"));
  expect(observer.settled()).toBe(false);
  element.dispatchEvent(new Event("scrollend"));
  element.dispatchEvent(new Event("scroll"));
  expect(observer.settled()).toBe(true);
  expect(observer.snapshot()).toMatchObject({ eligibleScrollEnds: 2, settlementInvalidations: 1 });
  observer.dispose();
});

test("passive capture failures cannot alter native completion state", () => {
  const element = target();
  const observer = createReviewScrollObserver(element);
  observer.reset();
  vi.stubGlobal("document", { hasFocus: () => { throw new Error("synthetic private failure"); } });
  element.dispatchEvent(new ArrowKey("keydown"));
  element.scrollLeft = 40;
  element.dispatchEvent(new Event("scroll"));
  element.dispatchEvent(new ArrowKey("keyup"));
  element.dispatchEvent(new Event("scrollend"));
  expect(observer.completed()).toBe(true);
  expect(observer.settled()).toBe(true);
  observer.dispose();
});

test("retains eligible-end and invalidation evidence after the event ring evicts the end", () => {
  const element = target();
  const observer = createReviewScrollObserver(element);
  observer.reset();
  element.dispatchEvent(new ArrowKey("keydown"));
  element.scrollLeft = 40;
  element.dispatchEvent(new Event("scroll"));
  element.dispatchEvent(new ArrowKey("keyup"));
  element.dispatchEvent(new Event("scrollend"));
  element.scrollLeft = 41;
  for (let index = 0; index < 20; index += 1) element.dispatchEvent(new Event("scroll"));
  const trace = observer.snapshot();
  expect(trace.events.every((event) => event.type === "scroll")).toBe(true);
  expect(trace).toMatchObject({ eligibleScrollEnds: 1, settlementInvalidations: 1 });
  expect(trace.state.settled).toBe(false);
  observer.dispose();
});

function capture() {
  const observer = createReviewScrollObserver(target());
  observer.reset();
  const trace = observer.snapshot();
  observer.dispose();
  return { version: 1, phase: "settlement", viewport: { width: 320, height: 844 }, evidence: "final", trace };
}

test("writes only the validated fixed filename with private exclusive creation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "review-scroll-contract-"));
  directories.push(directory);
  const input = capture();
  const output = { outputPath: (name: string) => join(directory, name) };
  expect(await writeReviewScrollCompletion(input, output)).toBe(true);
  const path = join(directory, "review-scroll-completion.json");
  const bytes = await readFile(path, "utf8");
  expect(JSON.parse(bytes)).toEqual(input);
  expect(Buffer.byteLength(bytes)).toBeLessThanOrEqual(16_384);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(await writeReviewScrollCompletion(input, output)).toBe(false);
  expect(await readFile(path, "utf8")).toBe(bytes);
});

test("failure capture preserves the original assertion and the last successful snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "review-scroll-contract-"));
  directories.push(directory);
  const input = capture();
  const original = new Error("synthetic original assertion");
  let caught: unknown;
  try {
    await withReviewScrollDiagnostics(async () => { throw original; }, async () => { throw new Error("synthetic private evaluation failure"); },
      { phase: "settlement", viewport: input.viewport, lastSuccessful: input.trace },
      { outputPath: (name: string) => join(directory, name) });
  } catch (error) { caught = error; }
  expect(caught).toBe(original);
  const artifact = JSON.parse(await readFile(join(directory, "review-scroll-completion.json"), "utf8"));
  expect(artifact).toEqual({ ...input, evidence: "last-successful" });
  expect(JSON.stringify(artifact)).not.toContain("synthetic");
});

test("successful interaction never reads or writes failure diagnostics", async () => {
  const read = vi.fn();
  const outputPath = vi.fn();
  await withReviewScrollDiagnostics(async () => {}, read,
    { phase: "settlement", viewport: { width: 390, height: 844 }, lastSuccessful: null }, { outputPath });
  expect(read).not.toHaveBeenCalled();
  expect(outputPath).not.toHaveBeenCalled();
});

test.each(["path", "write", "unavailable"])("retains the original error when diagnostics fail: %s", async (failure) => {
  const original = new Error("synthetic original assertion");
  const input = capture();
  const outputPath = vi.fn(() => {
    if (failure === "path") throw new Error("synthetic private path failure");
    return "/nonexistent-review-scroll-directory/review-scroll-completion.json";
  });
  await expect(withReviewScrollDiagnostics(async () => { throw original; }, async () => {
    if (failure === "unavailable") throw new Error("synthetic private evaluation failure");
    return input.trace;
  }, { phase: "settlement", viewport: input.viewport, lastSuccessful: null }, { outputPath })).rejects.toBe(original);
});

const invalidCaptures: Array<[string, (input: ReturnType<typeof capture>) => unknown]> = [
  ["version", (input) => ({ ...input, version: 2 })],
  ["phase text", (input) => ({ ...input, phase: "synthetic-secret" })],
  ["evidence text", (input) => ({ ...input, evidence: "synthetic-secret" })],
  ["root text", (input) => ({ ...input, url: "synthetic-secret" })],
  ["viewport text", (input) => ({ ...input, viewport: { ...input.viewport, text: "synthetic-secret" } })],
  ["trace text", (input) => ({ ...input, trace: { ...input.trace, error: "synthetic-secret" } })],
  ["state text", (input) => ({ ...input, trace: { ...input.trace, state: { ...input.trace.state, text: "synthetic-secret" } } })],
  ["event text", (input) => ({ ...input, trace: { ...input.trace, events: [{ ...input.trace.events[0], type: "synthetic-secret" }] } })],
  ["event extra key", (input) => ({ ...input, trace: { ...input.trace, events: [{ ...input.trace.events[0], key: "synthetic-secret" }] } })],
  ["event state text", (input) => ({ ...input, trace: { ...input.trace, events: [{ ...input.trace.events[0], state: { ...input.trace.state, text: "synthetic-secret" } }] } })],
  ["oversized ring", (input) => ({ ...input, trace: { ...input.trace, events: Array(17).fill(input.trace.events[0]) } })],
  ["incorrect counts", (input) => ({ ...input, trace: { ...input.trace, droppedEvents: 1 } })],
  ["incorrect sequence", (input) => ({ ...input, trace: { ...input.trace, events: [{ ...input.trace.events[0], sequence: 9 }] } })],
  ["missing trace", (input) => ({ ...input, trace: null })],
  ["false unavailable", (input) => ({ ...input, evidence: "unavailable" })],
  ["nonboolean", (input) => ({ ...input, trace: { ...input.trace, state: { ...input.trace.state, targetConnected: "true" } } })],
  ...[NaN, Infinity, -Infinity, -1, 1_000_001].map((width): [string, (input: ReturnType<typeof capture>) => unknown] =>
    [`invalid dimension ${width}`, (input) => ({ ...input, viewport: { ...input.viewport, width } })]),
];

test.each(invalidCaptures)("rejects %s before filesystem access without mutating the input", async (_name, change) => {
  const input = change(capture());
  const before = structuredClone(input);
  const outputPath = vi.fn();
  const writer = vi.fn();
  expect(await writeReviewScrollCompletion(input, { outputPath }, writer)).toBe(false);
  expect(outputPath).not.toHaveBeenCalled();
  expect(writer).not.toHaveBeenCalled();
  expect(input).toEqual(before);
});

test("records final evidence instead of stale evidence and supports unavailable context", async () => {
  const directory = await mkdtemp(join(tmpdir(), "review-scroll-contract-"));
  directories.push(directory);
  const input = capture();
  const original = new Error("synthetic assertion");
  await expect(withReviewScrollDiagnostics(async () => { throw original; }, async () => input.trace,
    { phase: "settlement", viewport: input.viewport, lastSuccessful: null },
    { outputPath: (name) => join(directory, name) })).rejects.toBe(original);
  expect(JSON.parse(await readFile(join(directory, "review-scroll-completion.json"), "utf8"))).toEqual(input);
  const writer = vi.fn().mockResolvedValue(undefined);
  expect(await writeReviewScrollCompletion({ ...input, evidence: "unavailable", trace: null },
    { outputPath: (name) => name }, writer)).toBe(true);
});
