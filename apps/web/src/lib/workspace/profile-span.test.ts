import { afterEach, describe, expect, it, vi } from "vitest";
import { profileSpan } from "./profile-span";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("server profiling privacy boundary", () => {
  it("correlates spans with generated request metadata and records interval bounds", async () => {
    vi.stubEnv("VOTUS_PROFILE_SPANS", "1");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await profileSpan("auth.getClaims", async () => 1, { requestId: "00000000-0000-4000-8000-000000000001", route: "/compare", parentSpanId: null });
    expect(JSON.parse(log.mock.calls[0]?.[0] as string)).toMatchObject({ requestId: "00000000-0000-4000-8000-000000000001", route: "/compare", parentSpanId: null, startMs: expect.any(Number), spanId: expect.any(String) });
  });
  it("is silent by default and preserves the result", async () => {
    vi.stubEnv("VOTUS_PROFILE_SPANS", "");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = { private: "must not be logged" };
    expect(await profileSpan("auth.getClaims", async () => result)).toBe(result);
    expect(log).not.toHaveBeenCalled();
  });
  it("emits only timing and a fixed operation label, never payloads", async () => {
    vi.stubEnv("VOTUS_PROFILE_SPANS", "1");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await profileSpan("auth.getClaims", async () => ({ token: "sensitive" }));
    expect(log).toHaveBeenCalledTimes(1);
    const event = JSON.parse(log.mock.calls[0]?.[0] as string);
    expect(event).toEqual({ type: "votus.profile.span", name: "auth.getClaims", durationMs: expect.any(Number), outcome: "ok" });
  });
  it("does not turn a logging failure into an application failure", async () => {
    vi.stubEnv("VOTUS_PROFILE_SPANS", "1");
    vi.spyOn(console, "info").mockImplementation(() => { throw new Error("sink failed"); });
    expect(await profileSpan("auth.getClaims", async () => 42)).toBe(42);
  });
  it("preserves failures without serializing their contents", async () => {
    vi.stubEnv("VOTUS_PROFILE_SPANS", "1");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const failure = new Error("sensitive details");
    await expect(profileSpan("auth.getClaims", async () => { throw failure; })).rejects.toBe(failure);
    expect(JSON.parse(log.mock.calls[0]?.[0] as string)).toEqual({ type: "votus.profile.span", name: "auth.getClaims", durationMs: expect.any(Number), outcome: "error" });
  });
});
