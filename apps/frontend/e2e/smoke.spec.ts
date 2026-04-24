import { expect, test } from '@playwright/test';

const email = process.env['E2E_EMAIL'] ?? '';
const password = process.env['E2E_PASSWORD'] ?? '';
const hasCreds = Boolean(email && password);
const overrideTenantId = process.env['E2E_TENANT_ID']?.trim() ?? '';

/**
 * Requires a running app (`next dev` / `next start`), reachable API, and Supabase auth.
 * Full route coverage expects an **agency** user (tenant directory + Agency GHL). Use E2E_TENANT_ID to
 * drive tenant pages if you only have a tenant-scoped account (agency routes are skipped).
 */
test('protected agency route redirects toward login when not signed in', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/app/agency');
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
});

test('smoke: login, MVP routes, logout', async ({ page }) => {
  test.skip(
    !hasCreds,
    'Set E2E_EMAIL and E2E_PASSWORD (and PLAYWRIGHT_BASE_URL if not http://127.0.0.1:3000). API + Supabase must be reachable.',
  );

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(
    u => {
      const p = u.pathname;
      return /\/app\/(agency|tenant)(\/|$)/.test(p);
    },
    { timeout: 45_000 },
  );

  let tenantId = overrideTenantId;

  const settledUrl = page.url();
  const tenantUrlMatch = settledUrl.match(/\/app\/tenant\/([^/]+)/);

  if (/\/app\/agency/.test(settledUrl)) {
    await page.goto('/app/agency', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });

    await page.goto('/app/agency/tenants');
    await expect(page.getByRole('heading', { level: 1, name: 'Tenant directory' })).toBeVisible({
      timeout: 20_000,
    });

    await page.goto('/app/agency/settings/ghl');
    await expect(page.getByRole('heading', { level: 1, name: 'Integrations' })).toBeVisible({
      timeout: 20_000,
    });

    if (!tenantId) {
      await page.goto('/app/agency/tenants');
      const firstHub = page.locator('a[href^="/app/tenant/"]').filter({ hasText: /Open workspace/i }).first();
      if ((await firstHub.count()) === 0) {
        throw new Error(
          'No tenant in directory (Open workspace). Create one or set E2E_TENANT_ID for tenant-page checks.',
        );
      }
      const href = await firstHub.getAttribute('href');
      const m = href?.match(/\/app\/tenant\/([^/]+)/);
      tenantId = m?.[1] ?? '';
    }
  } else if (tenantUrlMatch?.[1]) {
    tenantId = overrideTenantId || tenantUrlMatch[1];
  }

  expect(tenantId, 'Set E2E_TENANT_ID or use an agency user with a tenant in the directory.').toBeTruthy();

  await page.goto(`/app/tenant/${tenantId}/prompt`);
  await expect(page).toHaveURL(new RegExp(`/app/tenant/${tenantId}/goals`));
  await expect(page.getByRole('heading', { level: 1, name: 'Goals' })).toBeVisible({ timeout: 20_000 });

  await page.goto(`/app/tenant/${tenantId}/conversations`);
  await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible({ timeout: 20_000 });

  await page.goto(`/app/tenant/${tenantId}/diagnostics`);
  await expect(page.getByRole('heading', { level: 1, name: 'Diagnostics' })).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

  await page.goto(`/app/tenant/${tenantId}/goals`);
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
});
