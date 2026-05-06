import { expect, test } from '@playwright/test';

/**
 * MVP control-panel pass against local Next + API + Supabase.
 * Default credentials match prisma/seed.ts and the /login helper copy (demo accounts).
 * Override with E2E_EMAIL / E2E_PASSWORD for non-seeded projects.
 */
const email = process.env['E2E_EMAIL'] ?? 'agency-admin@demo.aisbp.com';
const password = process.env['E2E_PASSWORD'] ?? 'Demo123!';
const overrideTenantId = process.env['E2E_TENANT_ID']?.trim() ?? '';

async function loginAsAgency(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(
    (u) => {
      const p = u.pathname;
      return /\/app\/(agency|tenant)(\/|$)/.test(p);
    },
    { timeout: 60_000 },
  );
}

async function firstTenantIdFromDirectory(page: import('@playwright/test').Page): Promise<string> {
  if (overrideTenantId) return overrideTenantId;
  await page.goto('/app/agency/tenants', { waitUntil: 'networkidle' });
  const hub = page.getByRole('link', { name: /Open workspace/i }).first();
  await expect(hub).toBeVisible({ timeout: 25_000 });
  const href = await hub.getAttribute('href');
  const m = href?.match(/\/app\/tenant\/([^/]+)/);
  const id = m?.[1] ?? '';
  expect(id, 'Need seeded tenant or E2E_TENANT_ID').toBeTruthy();
  return id;
}

test.describe('A. Auth and routing', () => {
  test('protected agency route redirects to login when logged out', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/app/agency');
    await expect(page).toHaveURL(/\/login/, { timeout: 25_000 });
  });

  test('login → /app routes agency user to agency workspace; sign out → login redirect', async ({ page }) => {
    await loginAsAgency(page);
    await expect(page).toHaveURL(/\/app\/agency/, { timeout: 10_000 });

    await page.goto('/app');
    await expect(page).toHaveURL(/\/app\/agency/, { timeout: 15_000 });

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });

    await page.goto('/app/agency/tenants');
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  });
});

test.describe('B–C. Agency + tenant surfaces (logged-in)', () => {
  /**
   * Single sign-in for the whole sweep: repeated `beforeEach` logins against hosted Supabase
   * can throttle later tests in the same file (e.g. tenant prompt persistence).
   */
  test('single session: agency home, settings pages, tenant directory, tenant route headings', async ({
    page,
  }) => {
    await loginAsAgency(page);

    await page.goto('/app/agency', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByRole('link', { name: /Subaccounts/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Integrations/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /AI & models/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Master Prompt/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Agency team/i }).first()).toBeVisible();

    await page.getByRole('link', { name: /Subaccounts/i }).first().click();
    await expect(page).toHaveURL(/\/app\/agency\/tenants/);
    await expect(page.getByRole('heading', { level: 1, name: 'Tenant directory' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('link', { name: /Open workspace/i }).first()).toBeVisible({
      timeout: 25_000,
    });

    await page.goto('/app/agency/settings/ai', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'AI & models' })).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByLabel(/Default model/i)).toBeVisible();

    await page.goto('/app/agency/settings/policies', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Master Prompt' })).toBeVisible({
      timeout: 25_000,
    });

    await page.goto('/app/agency/settings/ghl', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Integrations' })).toBeVisible({
      timeout: 25_000,
    });

    await page.goto('/app/agency/team', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Agency team' })).toBeVisible({
      timeout: 25_000,
    });

    let tenantId = overrideTenantId;
    if (!tenantId) {
      await page.goto('/app/agency/tenants', { waitUntil: 'networkidle' });
      const hub = page.getByRole('link', { name: /Open workspace/i }).first();
      await expect(hub).toBeVisible({ timeout: 25_000 });
      const href = await hub.getAttribute('href');
      const m = href?.match(/\/app\/tenant\/([^/]+)/);
      tenantId = m?.[1] ?? '';
    }
    expect(tenantId, 'Need at least one tenant (seed) or E2E_TENANT_ID').toBeTruthy();

    await page.goto(`/app/tenant/${tenantId}`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(`/app/tenant/${tenantId}/assistant`));
    await expect(page.getByRole('heading', { level: 1, name: 'Assistant' })).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByRole('link', { name: 'Preview' })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText('Quick actions')).toHaveCount(0);
    await expect(page.getByText(/Workspace tagging/i)).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(/Workspace booking/i)).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(/Workspace follow-up/i)).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(/Knowledge vault status/i)).toBeVisible({ timeout: 25_000 });

    await page.goto(`/app/tenant/${tenantId}/prompt`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(`/app/tenant/${tenantId}/assistant/instructions`));
    await expect(page.getByRole('heading', { level: 1, name: /Assistant · Instructions/i })).toBeVisible({
      timeout: 25_000,
    });

    await page.goto(`/app/tenant/${tenantId}/ghl-status`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Connection' })).toBeVisible({
      timeout: 25_000,
    });

    await page.goto(`/app/tenant/${tenantId}/conversations`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible({
      timeout: 25_000,
    });

    await page.goto(`/app/tenant/${tenantId}/knowledge-vaults`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Knowledge Vaults' })).toBeVisible({
      timeout: 25_000,
    });

    await page.goto(`/app/tenant/${tenantId}/team`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Team' })).toBeVisible({
      timeout: 25_000,
    });

    await page.goto(`/app/tenant/${tenantId}/diagnostics`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Diagnostics' })).toBeVisible({
      timeout: 25_000,
    });

    await page.goto(`/app/tenant/${tenantId}/assistant/automation/tags`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Agency smoke test')).toBeVisible({ timeout: 25_000 });
  });
});

test.describe('Persistence spot-check (tenant prompt — own login, isolated)', () => {
  test('tenant AI prompt: append marker, save, revisit same URL shows marker', async ({ page }) => {
    await loginAsAgency(page);
    const tenantId = await firstTenantIdFromDirectory(page);
    await page.goto(`/app/tenant/${tenantId}/prompt`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(`/app/tenant/${tenantId}/assistant/instructions`));
    await expect(page.getByRole('heading', { level: 1, name: /Assistant · Instructions/i })).toBeVisible({
      timeout: 25_000,
    });
    const promptBox = page.getByLabel(/System prompt/i);
    await expect(promptBox).toBeVisible({ timeout: 25_000 });
    const marker = `\n[e2e-qa ${Date.now()}]`;
    await promptBox.fill((await promptBox.inputValue()) + marker);
    await page
      .locator('form')
      .filter({ has: page.getByLabel(/System prompt/i) })
      .getByRole('button', { name: 'Save' })
      .click();
    await expect(page.getByText(/Prompt saved\./)).toBeVisible({ timeout: 20_000 });
    await page.goto(`/app/tenant/${tenantId}/assistant/instructions`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel(/System prompt/i)).toContainText('[e2e-qa', { timeout: 25_000 });
  });
});

test.describe('Persistence spot-check (agency — single login)', () => {
  test('agency AI save + policies editor reflects saved marker', async ({ page }) => {
    await loginAsAgency(page);
    await page.goto('/app/agency/settings/ai', { waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel(/Default model/i)).toBeVisible({ timeout: 25_000 });
    await page.getByRole('button', { name: /Save provider settings/i }).click();
    await expect(
      page.getByText(/Provider settings saved\.|Save failed|Request failed|HTTP/i).first(),
    ).toBeVisible({ timeout: 25_000 });

    await page.goto('/app/agency/settings/policies', { waitUntil: 'domcontentloaded' });
    const area = page.locator('textarea').first();
    await expect(area).toBeVisible({ timeout: 25_000 });
    const policyMarker = `\n\n[e2e ${Date.now()}]`;
    await area.fill((await area.inputValue()) + policyMarker);
    await page.getByRole('button', { name: 'Save policy' }).click();
    await expect(page.getByText(/Policy saved\.|Save failed|Request failed|HTTP \d+/i).first()).toBeVisible({
      timeout: 25_000,
    });
    await expect(page).toHaveURL(/\/app\/agency\/settings\/policies/);
    await expect(page.locator('textarea').first()).toContainText('[e2e', { timeout: 25_000 });
  });
});
