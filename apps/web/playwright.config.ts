import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:3300', trace: 'off', ...devices['Desktop Chrome'], permissions: ['microphone'],
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'], ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}) } },
  webServer: {
    command: 'node ../../scripts/e2e-stack.mjs',
    cwd: '.',
    url: 'http://localhost:3300/onboarding',
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
  },
});
