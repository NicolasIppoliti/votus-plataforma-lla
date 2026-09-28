import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

const { GET } = await import("./route");
const actualRead = vi.mocked(readFile);

afterEach(() => actualRead.mockImplementation((...args) => vi.importActual<typeof import("node:fs/promises")>("node:fs/promises").then((fs) => fs.readFile(...args))));

describe("GET /api/geography/buenos-aires", () => {
  it("serves only the SHA-verified canonical IGN feature with private caching", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    const feature = await response.json();
    expect(feature.type).toBe("Feature");
    expect(feature.geometry.type).toBe("MultiPolygon");
    expect(feature.geometry.coordinates.length).toBe(95);
    expect(feature.properties).toEqual({});
  });

  it.each(["missing", "corrupt"])("withholds %s archive bytes", async (condition) => {
    actualRead.mockImplementation(async (path, ...args) => {
      if (String(path).endsWith(".geojson")) {
        if (condition === "missing") throw new Error("ENOENT");
        return Buffer.from("corrupt archive");
      }
      const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
      return fs.readFile(path, ...args);
    });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(await response.json()).toEqual({ status: "withheld" });
  });
});
