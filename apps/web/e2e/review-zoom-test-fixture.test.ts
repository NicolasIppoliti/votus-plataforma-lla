import { describe, expect, it } from "vitest";
import { ownedInitialBlank, ownedZoomTabId, requireZoomConfiguration, requireZoomUrl, withOwnedZoomSession } from "./review-zoom-test-fixture";

describe("owned zoom lifecycle", () => {
  it("resets then confirms closure before removing the owned root", async () => {
    const events: string[] = [];
    let confirmClose!: () => void;
    let reportClosing!: () => void;
    const closed = new Promise<void>((resolve) => { confirmClose = resolve; });
    const closing = new Promise<void>((resolve) => { reportClosing = resolve; });
    const result = withOwnedZoomSession(async () => { events.push("remove"); }, async (owner) => {
      await owner.launch(async () => ({ close: async () => {
        events.push("closing");
        reportClosing();
        await closed;
        events.push("closed");
      } }));
      owner.reset = async () => { events.push("reset"); };
    });
    await closing;
    expect(events).toEqual(["reset", "closing"]);
    confirmClose();
    await result;
    expect(events).toEqual(["reset", "closing", "closed", "remove"]);
  });

  it.each([false, true])("retains the root after unconfirmed launch/close (context returned: %s)", async (returned) => {
    const failure = new Error("browser lifecycle failure");
    let removed = false;
    await expect(withOwnedZoomSession(async () => { removed = true; }, async (owner) => {
      await owner.launch(async () => {
        if (!returned) throw failure;
        return { close: async () => { throw failure; } };
      });
    })).rejects.toMatchObject({ errors: [failure, expect.objectContaining({ message: expect.stringMatching(/retained/) })] });
    expect(removed).toBe(false);
  });

  it("removes a never-launched root and preserves setup and removal failures", async () => {
    const primary = new Error("extension preparation failed");
    const cleanup = new Error("owned removal failed");
    await expect(withOwnedZoomSession(async () => { throw cleanup; }, async () => {
      throw primary;
    })).rejects.toMatchObject({ errors: [primary, cleanup] });
  });

  it.each([false, true])("reset failure cannot prevent closure or mask failures (close fails: %s)", async (closeFails) => {
    const primary = new Error("review assertion failed");
    const reset = new Error("zoom reset failed");
    const close = new Error("context close failed");
    const events: string[] = [];
    const result = withOwnedZoomSession(async () => { events.push("remove"); }, async (owner) => {
      await owner.launch(async () => ({ close: async () => {
        events.push("close");
        if (closeFails) throw close;
      } }));
      owner.reset = async () => { events.push("reset"); throw reset; };
      throw primary;
    });
    await expect(result).rejects.toMatchObject({ errors: closeFails
      ? [primary, reset, close, expect.objectContaining({ message: expect.stringMatching(/retained/) })]
      : [primary, reset] });
    expect(events).toEqual(closeFails ? ["reset", "close"] : ["reset", "close", "remove"]);
  });

  it("rejects a second launch without losing ownership of the first context", async () => {
    const events: string[] = [];
    await expect(withOwnedZoomSession(async () => { events.push("remove"); }, async (owner) => {
      await owner.launch(async () => ({ close: async () => { events.push("close"); } }));
      await owner.launch(async () => { throw new Error("must not launch again"); });
    })).rejects.toMatchObject({ errors: [expect.objectContaining({ message: "Native zoom launch already attempted" })] });
    expect(events).toEqual(["close", "remove"]);
  });
});

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

  it("accepts only the approved fixed window widths before launch", () => {
    for (const width of [640, 1280]) {
      expect(() => requireZoomConfiguration("chromium", "provided-login-state", {}, width)).not.toThrow();
    }
    for (const width of [0, 320, 639, 1280.5, NaN]) {
      expect(() => requireZoomConfiguration("chromium", "provided-login-state", {}, width)).toThrow(/window width/);
    }
  });

  it("allows HTTP application zoom but rejects restricted schemes", () => {
    expect(() => requireZoomUrl("http://localhost:3000/review")).not.toThrow();
    expect(() => requireZoomUrl("https://example.test/review")).not.toThrow();
    for (const url of ["about:blank", "chrome://settings", "file:///page", "invalid"]) {
      expect(() => requireZoomUrl(url)).toThrow();
    }
  });
});
