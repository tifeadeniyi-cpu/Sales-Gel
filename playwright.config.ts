import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// E2E runs the production build against the isolated test database.
const env = loadEnv({ path: ".env.test", override: false }).parsed ?? {};
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // Set PLAYWRIGHT_CHANNEL=chrome to use an installed Google Chrome instead of the bundled Chromium.
      use: { ...devices["Desktop Chrome"], channel: process.env.PLAYWRIGHT_CHANNEL || undefined },
    },
  ],
  webServer: {
    command: `pnpm start -p ${PORT}`,
    url: `${baseURL}/sign-in`,
    reuseExistingServer: false,
    timeout: 120_000,
    // Fixed test-only key so the Integrations page renders its connect forms; never used outside E2E.
    env: { INTEGRATIONS_ENCRYPTION_KEY: "dGVzdC1vbmx5LWUyZS1rZXktMzItYnl0ZXMtbG9uZyE=", ...env, BETTER_AUTH_URL: baseURL, NEXT_PUBLIC_APP_URL: baseURL, NODE_ENV: "production" },
  },
});
