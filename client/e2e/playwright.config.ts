import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 8791);
/** Point at a server that is already running instead of starting one. */
const existing = process.env.E2E_BASE_URL;
const root = fileURLToPath(new URL('../..', import.meta.url));
const state = process.env.E2E_STATE ?? fileURLToPath(new URL('../../.wrangler/e2e-state', import.meta.url));

const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };

/** Runs against the built client served by `wrangler dev`; build first (`npm run build`). */
export default defineConfig({
  testDir: '.',
  outputDir: '../../test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list']],
  use: { baseURL: existing ?? `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', ...phone } },
    { name: 'webkit', use: { browserName: 'webkit', ...phone } },
  ],
  webServer: existing
    ? undefined
    : {
    command: `npx wrangler dev --port ${PORT} --ip 127.0.0.1 --persist-to ${state}`,
    cwd: root,
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
