import { defineConfig, devices } from "@playwright/test";

const publicBaseURL = process.env.MSITE_PUBLIC_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "html",
  use: {
    baseURL: publicBaseURL ?? "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  webServer: publicBaseURL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: !process.env.CI,
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
