import { defineConfig } from "@playwright/test";

// access-control / 14c, task 14.7: load the LOCAL-stack-only credential
// defaults (`e2e.env`, committed on purpose -- see that file's own header
// for why) BEFORE anything below reads `process.env`. Values already
// present in the environment always win (Node's documented
// `process.loadEnvFile` precedence), so exporting real values still
// overrides this file for a run against a non-local stack. A missing
// `e2e.env` (e.g. a checkout that deleted it) is not fatal -- every e2e
// spec file already skips explicitly when its required variables are
// absent.
try {
  process.loadEnvFile(new URL("./e2e.env", import.meta.url));
} catch {
  // No-op: e2e.env absent, or already loaded. Specs skip explicitly.
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: "http://localhost:3000",
  },
  // Only started when a spec actually runs (not on skip) and reuses an
  // already-running dev server locally so repeated runs stay fast.
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
  },
});
