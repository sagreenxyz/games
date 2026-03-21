// @ts-check
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
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

  /** Start a local PeerJS signalling server before tests */
  globalSetup: './tests/global-setup.js',
  globalTeardown: './tests/global-teardown.js',

  webServer: {
    command: 'npm run dev -- --port 4321',
    url: 'http://localhost:4321/games/poker/',
    // Always reuse an already-running dev server (avoids port conflicts)
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
