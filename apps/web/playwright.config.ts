import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
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
