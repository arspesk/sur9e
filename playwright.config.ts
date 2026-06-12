import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  use: { baseURL: 'http://localhost:3000' },
  reporter: 'list',
});
