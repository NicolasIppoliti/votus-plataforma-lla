import { describe, expect, it } from "vitest";
import { ownedInitialBlank, ownedZoomTabId, requireZoomConfiguration, requireZoomUrl } from "./review-zoom-test-fixture";

describe("owned zoom tab identity", () => {
  it("resolves a tab only from a one-page, one-tab bijection", () => {
    const page = {};
    expect(ownedZoomTabId([page], page, [{ id: 17 }])).toBe(17);
    expect(() => ownedZoomTabId([page, {}], page, [{ id: 17 }])).toThrow(/ownership/);
    expect(() => ownedZoomTabId([{}], page, [{ id: 17 }])).toThrow(/ownership/);
    expect(() => ownedZoomTabId([page], page, [{ id: 17 }, { id: 18 }])).toThrow(/ownership/);
  });

  it.each([undefined, 0, -1, 1.5, NaN])("rejects unusable tab ID %s", (id) => {
    const page = {};
    expect(() => ownedZoomTabId([page], page, [id === undefined ? {} : { id }])).toThrow(/ownership/);
  });

  it("rejects missing pages or tabs", () => {
    const page = {};
    expect(() => ownedZoomTabId([], page, [{ id: 17 }])).toThrow(/ownership/);
    expect(() => ownedZoomTabId([page], page, [])).toThrow(/ownership/);
  });
});

describe("zoom startup and configuration guards", () => {
  it("captures only the single initial blank page identity", () => {
    const blank = { url: () => "about:blank" };
    expect(ownedInitialBlank([blank])).toBe(blank);
    for (const pages of [[], [blank, blank], [{ url: () => "https://example.test" }]]) {
      expect(() => ownedInitialBlank(pages)).toThrow(/startup/);
    }
  });

  it("requires Chromium and supplied real-login storage state", () => {
    expect(() => requireZoomConfiguration("chromium", "provided-login-state", {})).not.toThrow();
    expect(() => requireZoomConfiguration("firefox", "provided-login-state", {})).toThrow(/Chromium/);
    expect(() => requireZoomConfiguration("chromium", undefined, {})).toThrow(/storageState/);
    expect(() => requireZoomConfiguration("chromium", "provided-login-state", { executablePath: "/browser" })).toThrow(/launch/);
    expect(() => requireZoomConfiguration("chromium", "provided-login-state", { args: ["--user-data-dir=other"] })).toThrow(/launch/);
  });

  it("allows HTTP application zoom but rejects restricted schemes", () => {
    expect(() => requireZoomUrl("http://localhost:3000/review")).not.toThrow();
    expect(() => requireZoomUrl("https://example.test/review")).not.toThrow();
    for (const url of ["about:blank", "chrome://settings", "file:///page", "invalid"]) {
      expect(() => requireZoomUrl(url)).toThrow();
    }
  });
});
