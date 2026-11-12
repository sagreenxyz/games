// @ts-check
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.js', // unit tests in tests/unit run with `npm run test:unit`
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Tests must run sequentially: each test uses multiple pages in the SAME
  // browser context so BroadcastChannel messages are shared between pages.
  fullyParallel: false,
  retries: 0,
  reporter: 'list',

  use: {
    baseURL: 'http://localhost:4321',
    permissions: ['clipboard-read', 'clipboard-write'],
    ignoreHTTPSErrors: true,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npm run dev -- --port 4321',
    url: 'http://localhost:4321/games/poker/',
    // Reuse a running dev server locally; always start a fresh one in CI
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
