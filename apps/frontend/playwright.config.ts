import { defineConfig, devices } from '@playwright/test';

/**
 * Minimal smoke E2E: requires a running Next app (`pnpm dev` / `turbo dev`) and working API + Supabase auth.
 * @see e2e/smoke.spec.ts
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: process.env['CI'] ? 'github' : 'list',
  timeout: 60_000,
  use: {
    // Must match backend CORS_ORIGIN (default http://localhost:3000) — 127.0.0.1 is a different Origin.
    baseURL: process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    ...devices['Desktop Chrome'],
  },
});
