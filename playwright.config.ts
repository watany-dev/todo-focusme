import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: "npm run dev",
    port: 8788,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: "http://localhost:8788",
  },
});
