import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  use: { baseURL: process.env.TFC_BROWSER_ORIGIN || "http://localhost:3100", timezoneId: "America/New_York" },
  webServer: process.env.TFC_BROWSER_ORIGIN ? undefined : { command: "npm run dev -- --port 3100", url: "http://localhost:3100", reuseExistingServer: !process.env.CI },
});
