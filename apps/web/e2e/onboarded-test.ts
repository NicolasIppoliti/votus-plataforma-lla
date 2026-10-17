import { test as base, expect } from "@playwright/test";
import { withAuthorizedResultWorkspace } from "./authorized-result-workspace";

/** Simulation exercises need a completed workspace before entering the data shell. */
export const test = base.extend<{ onboardedWorkspace: void }>({
  onboardedWorkspace: [async ({ page, baseURL }, use) => {
    if (!baseURL) throw new Error("onboarded fixture requires the gate base URL");
    await withAuthorizedResultWorkspace(page, baseURL, { distritoCode: "02", seccionCode: "027" }, use);
  }, { auto: true }],
});
export { expect };
