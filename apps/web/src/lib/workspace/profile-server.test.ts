import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ headers: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
import { profileServerSpan } from "./profile-server";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); mocks.headers.mockReset(); });

describe("request waterfall scope", () => {
  it("isolates concurrent requests and retains nested parent edges", async () => {
    vi.stubEnv("VOTUS_PROFILE_SPANS", "1");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
    for (const id of ids) mocks.headers.mockResolvedValueOnce(new Headers({ "x-votus-profile-request": id, "x-votus-profile-route": "/compare" }));
    await Promise.all(ids.map(() => profileServerSpan("page.compare", async () => {
      await Promise.resolve();
      return profileServerSpan("auth.getClaims", async () => ({ private: "never-log" }));
    })));
    const events = log.mock.calls.map(call => JSON.parse(call[0] as string));
    expect(mocks.headers).toHaveBeenCalledTimes(2);
    for (const id of ids) {
      const request = events.filter(event => event.requestId === id);
      expect(request).toHaveLength(2);
      const parent = request.find(event => event.name === "page.compare");
      const child = request.find(event => event.name === "auth.getClaims");
      expect(parent.parentSpanId).toBeNull();
      expect(child.parentSpanId).toBe(parent.spanId);
      expect(child.startMs).toBeGreaterThanOrEqual(parent.startMs);
    }
    expect(JSON.stringify(events)).not.toContain("never-log");
  });
  it("does not access headers when instrumentation is off", async () => {
    vi.stubEnv("VOTUS_PROFILE_SPANS", "");
    expect(await profileServerSpan("page.compare", async () => 42)).toBe(42);
    expect(mocks.headers).not.toHaveBeenCalled();
  });
});
