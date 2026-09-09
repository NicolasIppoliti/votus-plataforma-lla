import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, BrowserContextOptions, LaunchOptions, Page } from "@playwright/test";
import { test } from "./review-test-fixture";

export function ownedInitialBlank<T extends Pick<Page, "url">>(pages: readonly T[]): T {
  const blank = pages[0];
  if (pages.length !== 1 || !blank || blank.url() !== "about:blank") {
    throw new Error("Unexpected native zoom startup pages");
  }
  return blank;
}

export function requireZoomConfiguration(
  browserName: string,
  storageState: BrowserContextOptions["storageState"],
  launchOptions: LaunchOptions,
): void {
  if (browserName !== "chromium") throw new Error("Native zoom requires Chromium");
  if (!storageState) throw new Error("Native zoom requires the real-login storageState fixture");
  if (launchOptions.executablePath || launchOptions.channel || launchOptions.ignoreDefaultArgs ||
      launchOptions.args?.some((arg) => /--(user-data-dir|remote-debugging|load-extension|disable-extensions|window-size)/.test(arg))) {
    throw new Error("Conflicting native zoom launch options");
  }
}

export function requireZoomUrl(url: string): void {
  if (!["http:", "https:"].includes(new URL(url).protocol)) {
    throw new Error("Native zoom requires an owned HTTP(S) application page");
  }
}

export function ownedZoomTabId<T>(pages: readonly T[], page: T, tabs: readonly { id?: number }[]): number {
  const id = tabs[0]?.id;
  if (pages.length !== 1 || pages[0] !== page || tabs.length !== 1 ||
      id === undefined || !Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Native zoom ownership requires exactly one owned page and positive tab ID");
  }
  return id;
}

interface ChromeTabs {
  query(query: Record<string, never>): Promise<{ id?: number }[]>;
  setZoomSettings(id: number, settings: { mode: "automatic"; scope: "per-tab" }): Promise<void>;
  setZoom(id: number, factor: number): Promise<void>;
  getZoom(id: number): Promise<number>;
}

interface ZoomSession {
  context: BrowserContext;
  blank: Page;
}

interface ZoomDriver {
  set(factor: 1 | 2): Promise<number>;
}

interface ZoomFixtures {
  zoomSession: ZoomSession;
  zoom: ZoomDriver;
}

export const zoomTest = test.extend<ZoomFixtures>({
  zoomSession: async ({ playwright, browserName, launchOptions, storageState }, use) => {
    requireZoomConfiguration(browserName, storageState, launchOptions);
    const root = await mkdtemp(join(tmpdir(), "votus-review-zoom-"));
    let context: BrowserContext | undefined;
    let launchAttempted = false;
    let closed = false;
    const errors: unknown[] = [];
    try {
      const extension = join(root, "extension");
      await mkdir(extension);
      await writeFile(join(extension, "manifest.json"), JSON.stringify({
        manifest_version: 3,
        name: "Owned review zoom",
        version: "1.0.0",
        background: { service_worker: "worker.js" },
      }));
      await writeFile(join(extension, "worker.js"), "chrome.runtime.onInstalled.addListener(() => {});\n");
      launchAttempted = true;
      // The provided Playwright instance keeps context defaults and artifact hooks.
      // Persistent launch drops storageState, so restore it through the public API.
      context = await playwright.chromium.launchPersistentContext(join(root, "profile"), {
        ...launchOptions,
        channel: "chromium",
        viewport: null,
        args: [
          ...(launchOptions.args ?? []),
          `--disable-extensions-except=${extension}`,
          `--load-extension=${extension}`,
          "--window-size=1280,900",
        ],
      });
      const blank = ownedInitialBlank(context.pages());
      await context.setStorageState(storageState!);
      // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture callback.
      await use({ context, blank });
    } catch (error) {
      errors.push(error);
    } finally {
      if (context) {
        try {
          await context.close();
          closed = true;
        } catch (error) {
          errors.push(error);
        }
      }
      if (!launchAttempted || closed) {
        try {
          await rm(root, { recursive: true, force: true });
        } catch (error) {
          errors.push(error);
        }
      } else {
        errors.push(new Error("Native zoom closure unconfirmed; owned temporary directory retained"));
      }
    }
    if (errors.length) throw new AggregateError(errors, "Native zoom session failed");
  },
  context: async ({ zoomSession }, use) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture callback.
    await use(zoomSession.context);
  },
  page: async ({ page, zoomSession }, use) => {
    const pages = zoomSession.context.pages();
    if (pages.length !== 2 || !pages.includes(page) || !pages.includes(zoomSession.blank) ||
        page === zoomSession.blank || zoomSession.blank.url() !== "about:blank") {
      throw new Error("Unexpected native zoom page ownership before blank closure");
    }
    // Base page creation precedes this close; never close Chromium's last tab.
    await zoomSession.blank.close();
    // Next attaches to this same page/context before application navigation.
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture callback.
    await use(page);
  },
  zoom: async ({ page, context }, use) => {
    const workers = context.serviceWorkers();
    const worker = workers[0] ?? await context.waitForEvent("serviceworker");
    if (context.serviceWorkers().length !== 1 || !worker.url().startsWith("chrome-extension://")) {
      throw new Error("Unexpected native zoom extension workers");
    }
    const queryTabs = () => worker.evaluate(() => {
      const { chrome } = globalThis as unknown as { chrome: { tabs: ChromeTabs } };
      return chrome.tabs.query({});
    });
    const tabId = ownedZoomTabId(context.pages(), page, await queryTabs());
    const driver: ZoomDriver = {
      async set(factor) {
        requireZoomUrl(page.url());
        if (ownedZoomTabId(context.pages(), page, await queryTabs()) !== tabId) {
          throw new Error("Native zoom tab ownership changed");
        }
        return worker.evaluate(async ({ tabId, factor }) => {
          const { chrome } = globalThis as unknown as { chrome: { tabs: ChromeTabs } };
          await chrome.tabs.setZoomSettings(tabId, { mode: "automatic", scope: "per-tab" });
          await chrome.tabs.setZoom(tabId, factor);
          const actual = await chrome.tabs.getZoom(tabId);
          if (actual !== factor) throw new Error("Native zoom factor readback mismatch");
          return actual;
        }, { tabId, factor });
      },
    };
    const errors: unknown[] = [];
    try {
      // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture callback.
      await use(driver);
    } catch (error) {
      errors.push(error);
    } finally {
      try {
        if (page.isClosed()) throw new Error("Owned zoom page closed before explicit reset");
        await driver.set(1);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, "Native zoom use or reset failed");
  },
});
