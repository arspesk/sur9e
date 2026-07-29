import { defineConfig } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const shouldStartServer = process.env.PLAYWRIGHT_START_SERVER === '1';
const smokeMode = process.env.PLAYWRIGHT_SMOKE_MODE === '1';

export default defineConfig({
  testDir: 'test/e2e',
  reporter: 'list',
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  webServer: shouldStartServer
    ? {
        command: `./node_modules/.bin/next ${smokeMode ? 'start' : 'dev'} -p ${port}`,
        url: baseURL,
        env: smokeMode ? {} : { SUR9E_TAILNET_HOST: new URL(baseURL).hostname },
        reuseExistingServer: false,
        timeout: 120_000,
      }
    : undefined,
});
