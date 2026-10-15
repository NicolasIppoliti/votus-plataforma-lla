import { afterEach, expect, it, vi } from "vitest";

const effects = vi.hoisted(() => ({ mount: undefined as (() => (() => void)) | undefined }));
vi.mock("react", () => ({ useEffect: (effect: () => (() => void)) => { effects.mount = effect; } }));
import SessionMonitor from "./SessionMonitor";

afterEach(() => { vi.unstubAllGlobals(); });

it.each([401, "expired", "revoked"])("replaces the authenticated document while preserving its exact URL after %s", async (status) => {
  const replace = vi.fn();
  vi.stubGlobal("window", {
    location: { pathname: "/simulate", search: "?input=%7B%22seats%22%3A9%7D", replace },
    setTimeout: vi.fn(), clearTimeout: vi.fn(), setInterval: vi.fn(), clearInterval: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  });
  vi.stubGlobal("document", { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: typeof status === "number" ? status : 200, ok: typeof status !== "number", json: async () => ({ status }) }));
  SessionMonitor();
  const cleanup = effects.mount!();
  await vi.waitFor(() => expect(replace).toHaveBeenCalledOnce());
  expect(replace).toHaveBeenCalledWith("/login?returnTo=%2Fsimulate%3Finput%3D%257B%2522seats%2522%253A9%257D");
  cleanup();
});
