import { defineConfig, devices } from '@playwright/test';

// Runs against a running Pelo CRM with the demo seed: `npm run seed -w @baton/api -- --demo`.
// E2E_BASE_URL defaults to the Vite dev server; CI points it at the Docker stack (https://localhost).
export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : undefined } },
    // Safari's engine on a MacBook-sized screen: every user type, the query journey and go-live screens.
    { name: 'safari', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }, testMatch: /(personas|queries|golive)\.spec\.ts/ },
  ],
});
