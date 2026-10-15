import { describe, expect, it } from "vitest";
import { summarize, parseSpan, intervalUnionMs, assertLocalUrl } from "../../scripts/page-waterfalls-report";

describe("waterfall reporting", () => {
  it("uses nearest-rank quantiles and no invented empty measurements", () => {
    expect(summarize([])).toEqual({ n: 0, medianMs: null, p95Ms: null });
    expect(summarize([10, 1, 4, 3])).toEqual({ n: 4, medianMs: 3.5, p95Ms: 10 });
  });
  it("does not double-count nested or overlapping work", () => {
    expect(intervalUnionMs([{ startMs: 0, durationMs: 10 }, { startMs: 2, durationMs: 4 }, { startMs: 8, durationMs: 5 }])).toBe(13);
  });
  it("rejects non-loopback and credentials in local endpoints", () => {
    expect(() => assertLocalUrl("https://hosted.example.test")).toThrow();
    expect(() => assertLocalUrl("http://secret@127.0.0.1:54321")).toThrow();
    expect(assertLocalUrl("http://127.0.0.1:54321").hostname).toBe("127.0.0.1");
  });
  it("drops unknown labels, extra payload keys and nonfinite times", () => {
    const span = { type: "votus.profile.span", name: "auth.getClaims", requestId: "00000000-0000-4000-8000-000000000001", route: "/compare", spanId: "00000000-0000-4000-8000-000000000002", parentSpanId: null, startMs: 100, durationMs: 2, outcome: "ok" };
    expect(parseSpan(JSON.stringify(span))).toEqual(span);
    expect(parseSpan(JSON.stringify({ ...span, cookie: "must-not-survive" }))).toBeNull();
    expect(parseSpan(JSON.stringify({ ...span, name: "private URL" }))).toBeNull();
    expect(parseSpan(JSON.stringify({ ...span, startMs: null }))).toBeNull();
  });
});
