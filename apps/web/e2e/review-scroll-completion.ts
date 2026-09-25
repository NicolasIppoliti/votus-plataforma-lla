import { writeFile } from "node:fs/promises";
import { z } from "zod";

const phases = ["reset", "keyboard", "movement", "completion", "settlement"] as const;
export type ReviewScrollPhase = typeof phases[number];
const dimension = z.number().finite().min(0).max(1_000_000);
const counter = z.number().int().min(0).max(1_000_000);
const stateSchema = z.strictObject({
  armed: z.boolean(), moved: z.boolean(), released: z.boolean(), complete: z.boolean(),
  settled: z.boolean(), resetPending: z.boolean(), resetComplete: z.boolean(),
  scrollLeft: z.number().finite().min(-1_000_000).max(1_000_000),
  clientWidth: dimension, scrollWidth: dimension,
  documentFocused: z.boolean(), targetFocused: z.boolean(), targetConnected: z.boolean(),
});
const eventSchema = z.strictObject({
  sequence: counter, type: z.enum(["reset", "keydown", "keyup", "scroll", "scrollend"]),
  elapsedMs: dimension, trusted: z.boolean().nullable(), targetMatches: z.boolean().nullable(),
  state: stateSchema,
});
const traceSchema = z.strictObject({
  totalEvents: counter, droppedEvents: counter, events: z.array(eventSchema).max(16), state: stateSchema,
  eligibleScrollEnds: counter, settlementInvalidations: counter,
}).refine((trace) => trace.events.length === Math.min(trace.totalEvents, 16)
  && trace.totalEvents === trace.droppedEvents + trace.events.length
  && trace.events.every((event, index) => event.sequence === trace.droppedEvents + index + 1));
const captureSchema = z.strictObject({
  version: z.literal(1), phase: z.enum(phases),
  viewport: z.strictObject({ width: dimension, height: dimension }),
  evidence: z.enum(["final", "last-successful", "unavailable"]), trace: traceSchema.nullable(),
}).refine((capture) => (capture.evidence === "unavailable") === (capture.trace === null));

interface OutputLocation { outputPath(name: string): string; }
interface Viewport { width: number; height: number; }
interface ScrollContext {
  phase: ReviewScrollPhase;
  viewport: Viewport;
  lastSuccessful: unknown;
}
type Writer = (path: string, body: string, options: { mode: number; flag: "wx" }) => Promise<unknown>;

export async function writeReviewScrollCompletion(capture: unknown, output: OutputLocation, writer: Writer = writeFile): Promise<boolean> {
  try {
    const parsed = captureSchema.safeParse(capture);
    if (!parsed.success) return false;
    const body = JSON.stringify(parsed.data);
    if (Buffer.byteLength(body, "utf8") > 16_384) return false;
    await writer(output.outputPath("review-scroll-completion.json"), body, { mode: 0o600, flag: "wx" });
    return true;
  } catch { return false; }
}

export async function withReviewScrollDiagnostics(
  action: () => Promise<void>, read: () => Promise<unknown>, context: ScrollContext, output: OutputLocation,
): Promise<void> {
  try { await action(); }
  catch (error) {
    try {
      let trace = context.lastSuccessful;
      let evidence = trace === null ? "unavailable" : "last-successful";
      try { trace = await read(); evidence = "final"; } catch { /* Retain the last successful observation. */ }
      await writeReviewScrollCompletion({ version: 1, phase: context.phase, viewport: context.viewport, evidence, trace }, output);
    } catch { /* Diagnostic failures never replace the original assertion. */ }
    throw error;
  }
}

// This factory is serialized by Playwright. Keep its runtime dependencies local.
export function createReviewScrollObserver(element: HTMLElement) {
  let armed = false, moved = false, released = false, complete = false;
  let settled = false;
  let resetPending = false;
  let resetComplete = false;
  const startedAt = performance.now();
  let totalEvents = 0;
  let eligibleScrollEnds = 0;
  let settlementInvalidations = 0;
  const state = () => ({
    armed, moved, released, complete, settled, resetPending, resetComplete,
    scrollLeft: element.scrollLeft, clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth, documentFocused: document.hasFocus(),
    targetFocused: document.activeElement === element, targetConnected: element.isConnected,
  });
  const events: Array<z.infer<typeof eventSchema>> = [];
  const record = (type: typeof events[number]["type"], event?: Event) => {
    try {
      const observation = state();
      events.push({
        sequence: ++totalEvents, type, elapsedMs: performance.now() - startedAt,
        trusted: event?.isTrusted ?? null, targetMatches: event ? event.target === element : null,
        state: observation,
      });
      if (events.length > 16) events.shift();
    } catch { /* Diagnostics must not affect native interaction state. */ }
  };
  const completeInteraction = () => {
    complete = armed && moved && released && element.scrollLeft > 0;
  };
  const key = (event: Event) => {
    if (!resetComplete || !(event instanceof KeyboardEvent) || event.target !== element || !event.isTrusted || event.key !== "ArrowRight"
      || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.type === "keydown") { armed = true; moved = released = complete = settled = false; }
    else if (armed) { released = true; completeInteraction(); }
    record(event.type === "keydown" ? "keydown" : "keyup", event);
  };
  const scroll = (event: Event) => {
    if (settled) settlementInvalidations += 1;
    settled = false;
    complete = false;
    if (armed && element.scrollLeft > 0) { moved = true; completeInteraction(); }
    record("scroll", event);
  };
  const end = (event: Event) => {
    if (armed && moved && element.scrollLeft > 0) {
      settled = true;
      eligibleScrollEnds += 1;
    }
    if (resetPending) {
      if (element.scrollLeft === 0) {
        resetPending = false;
        resetComplete = true;
      }
    }
    record("scrollend", event);
  };
  element.addEventListener("keydown", key);
  element.addEventListener("keyup", key);
  element.addEventListener("scroll", scroll);
  element.addEventListener("scrollend", end);
  return {
    reset: () => {
      resetPending = element.scrollLeft !== 0;
      resetComplete = !resetPending;
      element.scrollLeft = 0;
      // An immediate reset need not dispatch a later scrollend event.
      if (element.scrollLeft === 0) {
        resetPending = false;
        resetComplete = true;
      }
      record("reset");
    },
    resetCompleted: () => resetComplete,
    completed: () => complete,
    settled: () => settled,
    snapshot: () => ({
      totalEvents, droppedEvents: totalEvents - events.length,
      events: events.map((event) => ({ ...event, state: { ...event.state } })), state: state(),
      eligibleScrollEnds, settlementInvalidations,
    }),
    dispose: () => {
      element.removeEventListener("keydown", key);
      element.removeEventListener("keyup", key);
      element.removeEventListener("scroll", scroll);
      element.removeEventListener("scrollend", end);
    },
  };
}
