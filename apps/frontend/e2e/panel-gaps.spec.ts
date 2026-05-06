import { expect, test } from '@playwright/test';

/**
 * Narrow follow-up: high-value gaps not fully covered by panel-mvp headings-only sweep.
 * Requires local Next + API + Supabase (same as panel-mvp).
 *
 * Optional env (UUIDs from your Supabase Auth / profiles — seed does not hard-code them):
 * - E2E_EXTRA_AGENCY_PROFILE_ID — existing profile id not already in the demo agency (e.g. tenant-b-user).
 * - E2E_EXTRA_TENANT_A_PROFILE_ID — existing profile id not already on tenant A (e.g. agency-operator from Auth).
 * - E2E_TENANT_ID — tenant slug in URL when not `demo-tenant-a` (tenant-a-admin is routed to /app/agency first).
 */
const agencyEmail = process.env['E2E_EMAIL'] ?? 'agency-admin@demo.aisbp.com';
const agencyPassword = process.env['E2E_PASSWORD'] ?? 'Demo123!';
const tenantAdminEmail =
  process.env['E2E_TENANT_ADMIN_EMAIL'] ?? 'tenant-a-admin@demo.aisbp.com';
const tenantAdminPassword = process.env['E2E_TENANT_ADMIN_PASSWORD'] ?? agencyPassword;
const overrideTenantId = process.env['E2E_TENANT_ID']?.trim() ?? '';
const extraAgencyProfileId = process.env['E2E_EXTRA_AGENCY_PROFILE_ID']?.trim() ?? '';
const extraTenantAProfileId = process.env['E2E_EXTRA_TENANT_A_PROFILE_ID']?.trim() ?? '';
/** Seed default for tenant A; override with E2E_TENANT_ID when your DB uses different ids. */
const seededTenantAId = process.env['E2E_TENANT_ID']?.trim() || 'demo-tenant-a';

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(
    u => /\/app\/(agency|tenant)(\/|$)/.test(u.pathname),
    { timeout: 60_000 },
  );
}

async function firstTenantIdFromDirectory(page: import('@playwright/test').Page): Promise<string> {
  if (overrideTenantId) return overrideTenantId;
  await page.goto('/app/agency/tenants', { waitUntil: 'domcontentloaded' });
  const hub = page.getByRole('link', { name: /Open workspace/i }).first();
  await expect(hub).toBeVisible({ timeout: 25_000 });
  const href = await hub.getAttribute('href');
  const m = href?.match(/\/app\/tenant\/([^/]+)/);
  const id = m?.[1] ?? '';
  expect(id, 'Need seeded tenant or E2E_TENANT_ID').toBeTruthy();
  return id;
}

test.describe('Panel gaps (narrow)', () => {
  test('1. Tenant AI prompt: edit, save, reload and revisit persist marker', async ({ page }) => {
    await login(page, agencyEmail, agencyPassword);
    const tenantId = await firstTenantIdFromDirectory(page);
    await page.goto(`/app/tenant/${tenantId}/assistant/instructions`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: /Assistant · Instructions/i })).toBeVisible({
      timeout: 25_000,
    });
    const promptBox = page.getByLabel(/System prompt/i);
    await expect(promptBox).toBeVisible({ timeout: 25_000 });
    const marker = `\n[e2e-gap ${Date.now()}]`;
    await promptBox.fill((await promptBox.inputValue()) + marker);
    await page
      .locator('form')
      .filter({ has: page.getByLabel(/System prompt/i) })
      .getByRole('button', { name: 'Save' })
      .click();
    await expect(page.getByText(/Prompt saved\./)).toBeVisible({ timeout: 20_000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: /Assistant · Instructions/i })).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByLabel(/System prompt/i)).toContainText('[e2e-gap', { timeout: 25_000 });

    await page.goto(`/app/tenant/${tenantId}/assistant/instructions`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel(/System prompt/i)).toContainText('[e2e-gap', { timeout: 25_000 });
  });

  test('2. Agency Team: roster loads; operator role round-trip (OPERATOR ↔ MEMBER)', async ({ page }) => {
    await login(page, agencyEmail, agencyPassword);
    await page.goto('/app/agency/team', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Agency team' })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole('columnheader', { name: 'Email' })).toBeVisible({ timeout: 25_000 });

    const opRow = page.locator('tr').filter({ hasText: 'agency-operator@demo.aisbp.com' }).first();
    await expect(opRow).toBeVisible({ timeout: 25_000 });
    await opRow.getByRole('combobox').selectOption('MEMBER');
    await opRow.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Role updated.')).toBeVisible({ timeout: 20_000 });

    const opRow2 = page.locator('tr').filter({ hasText: 'agency-operator@demo.aisbp.com' }).first();
    await expect(opRow2.getByRole('combobox')).toHaveValue('MEMBER', { timeout: 15_000 });
    await opRow2.getByRole('combobox').selectOption('OPERATOR');
    await opRow2.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Role updated.')).toBeVisible({ timeout: 20_000 });
  });

  test('2b. Agency Team: add + remove (optional profile UUID)', async ({ page }) => {
    test.skip(!extraAgencyProfileId, 'Set E2E_EXTRA_AGENCY_PROFILE_ID to an existing profiles.id not in the agency.');
    await login(page, agencyEmail, agencyPassword);
    await page.goto('/app/agency/team', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Agency team' })).toBeVisible({ timeout: 25_000 });

    const addBlock = page.locator('div').filter({ has: page.getByRole('button', { name: 'Add member' }) });
    await addBlock.getByPlaceholder(/xxxxxxxx-xxxx/).fill(extraAgencyProfileId);
    await addBlock.getByRole('combobox').selectOption('MEMBER');
    await page.getByRole('button', { name: 'Add member' }).click();
    await expect(page.getByText('Member added.')).toBeVisible({ timeout: 25_000 });

    const newRow = page.locator('tr').filter({ hasText: extraAgencyProfileId }).first();
    await expect(newRow).toBeVisible({ timeout: 25_000 });
    page.once('dialog', d => d.accept());
    await newRow.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('Member removed.')).toBeVisible({ timeout: 25_000 });
  });

  test('3a. Tenant Team: tenant admin sees roster and add form', async ({ page }) => {
    await login(page, tenantAdminEmail, tenantAdminPassword);
    await page.waitForURL(u => /\/app\/(agency|tenant)/.test(u.pathname), { timeout: 30_000 });
    const tenantId = overrideTenantId || seededTenantAId;

    await page.goto(`/app/tenant/${tenantId}/team`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Team' })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(/Your tenant role:\s*ADMIN/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('columnheader', { name: 'Email' })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole('button', { name: 'Add member' })).toBeVisible();
  });

  test('3a2. Tenant Automation Tags: classifier visible; agency smoke test hidden', async ({ page }) => {
    await login(page, tenantAdminEmail, tenantAdminPassword);
    const tenantId = overrideTenantId || seededTenantAId;
    await page.goto(`/app/tenant/${tenantId}/assistant/automation/tags`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Test classifier')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText('Agency smoke test')).toHaveCount(0);
  });

  test('3b. Tenant Team: add, role change, remove (optional profile UUID)', async ({ page }) => {
    test.skip(
      !extraTenantAProfileId,
      'Set E2E_EXTRA_TENANT_A_PROFILE_ID to an existing profiles.id not on this tenant (e.g. agency-operator from Auth).',
    );
    await login(page, tenantAdminEmail, tenantAdminPassword);
    await page.waitForURL(u => /\/app\/(agency|tenant)/.test(u.pathname), { timeout: 30_000 });
    const tenantId = overrideTenantId || seededTenantAId;

    await page.goto(`/app/tenant/${tenantId}/team`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Team' })).toBeVisible({ timeout: 25_000 });

    const addBlock = page.locator('div').filter({ has: page.getByRole('button', { name: 'Add member' }) });
    await addBlock.getByPlaceholder(/xxxxxxxx-xxxx/).fill(extraTenantAProfileId);
    await addBlock.getByRole('combobox').selectOption('AGENT');
    await page.getByRole('button', { name: 'Add member' }).click();
    await expect(page.getByText('Member added.')).toBeVisible({ timeout: 25_000 });

    const row = page.locator('tr').filter({ hasText: extraTenantAProfileId }).first();
    await expect(row).toBeVisible({ timeout: 25_000 });
    await row.getByRole('combobox').selectOption('VIEWER');
    await row.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Role updated.')).toBeVisible({ timeout: 20_000 });

    const row2 = page.locator('tr').filter({ hasText: extraTenantAProfileId }).first();
    page.once('dialog', d => d.accept());
    await row2.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('Member removed.')).toBeVisible({ timeout: 25_000 });
  });

  test('4. Diagnostics: run routing probe and render result fields', async ({ page }) => {
    await login(page, agencyEmail, agencyPassword);
    const tenantId = await firstTenantIdFromDirectory(page);
    await page.goto(`/app/tenant/${tenantId}/diagnostics`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Diagnostics' })).toBeVisible({
      timeout: 25_000,
    });

    await page.getByLabel(/Sample customer message/i).fill('E2E routing probe: need a human for my booking.');
    await page.getByRole('button', { name: 'Run routing probe' }).click();

    await expect(page.getByTestId('routing-probe-result')).toBeVisible({ timeout: 60_000 });
    const box = page.getByTestId('routing-probe-result');
    await expect(box.getByText('Recommended model', { exact: true })).toBeVisible();
    await expect(box.getByText('Response mode', { exact: true })).toBeVisible();
    await expect(box.getByText('Confidence', { exact: true })).toBeVisible();
    await expect(box.getByText('Reasoning', { exact: true })).toBeVisible();
  });

  test('5. Session-expired UX: login page shows banner for ?session=expired', async ({ page }) => {
    await page.goto('/login?session=expired', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('alert').filter({ hasText: /session expired or is no longer valid/i })).toBeVisible({
      timeout: 15_000,
    });
  });
});
