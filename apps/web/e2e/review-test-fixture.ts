import { expect } from "@playwright/test";
import { test as nextTest } from "next/experimental/testmode/playwright.js";
import { createReviewTestWorker } from "./review-state-control";

export const test = nextTest.extend({
  _nextWorker: async ({}, use) => {
    const worker = await createReviewTestWorker();
    try {
      // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture callback.
      await use(worker);
    } finally {
      await worker.close();
    }
  },
});

export { expect };
