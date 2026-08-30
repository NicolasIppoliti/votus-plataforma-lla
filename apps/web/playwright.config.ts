import { defineConfig } from "@playwright/test";

const baseURL = process.env["VOTUS_E2E_BASE_URL"];
const storageState = process.env["VOTUS_E2E_STORAGE_STATE"];
if (!baseURL) {
  throw new Error("VOTUS_E2E_BASE_URL must be exported by the e2e release gate");
}
if (!storageState) throw new Error("VOTUS_E2E_STORAGE_STATE must be exported by the e2e release gate");

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["./e2e/release-gate-reporter.ts"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL,
    storageState,
  },
});
