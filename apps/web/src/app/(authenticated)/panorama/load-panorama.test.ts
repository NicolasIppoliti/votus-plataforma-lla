import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ selection: vi.fn(), defaults: vi.fn(), repository: vi.fn() }));
vi.mock("@/lib/workspace/profile-server", () => ({ profileServerSpan: (_name: string, run: () => unknown) => run() }));
vi.mock("@/lib/workspace/selection", () => ({ loadWorkspaceSelection: mocks.selection }));
vi.mock("@/lib/workspace/official-facets", () => ({ createAuthorizedOfficialFacetRepository: mocks.repository }));
vi.mock("@/lib/context/default", () => ({ resolveDefaultElectoralContext: mocks.defaults }));
vi.mock("@/lib/workspace/official-drilldown-evidence", () => ({ loadAuthorizedOfficialDrilldownEvidence: vi.fn() }));
vi.mock("../drilldown/circuit-geometry", () => ({ loadCircuitGeometry: vi.fn() }));

import { loadPanorama } from "./load-panorama";

beforeEach(() => { vi.clearAllMocks(); mocks.defaults.mockResolvedValue({ sourceKind: "official" }); });

it("awaits first-request workspace bootstrap before resolving authorized Panorama defaults", async () => {
  let release!: () => void;
  mocks.selection.mockReturnValue(new Promise<void>(resolve => { release = resolve; }));
  const pending = loadPanorama();
  await Promise.resolve();
  expect(mocks.repository).not.toHaveBeenCalled();
  expect(mocks.defaults).not.toHaveBeenCalled();
  release();
  await expect(pending).resolves.toEqual({ href: "/drilldown", exclusions: [] });
  expect(mocks.selection).toHaveBeenCalledOnce();
  expect(mocks.defaults).toHaveBeenCalledOnce();
});

it("keeps Panorama unavailable when workspace initialization fails, without reading facets", async () => {
  mocks.selection.mockRejectedValue(new Error("unavailable"));
  await expect(loadPanorama()).resolves.toEqual({ href: "/drilldown", exclusions: [] });
  expect(mocks.repository).not.toHaveBeenCalled();
});
