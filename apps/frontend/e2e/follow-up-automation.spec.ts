import { expect, test } from '@playwright/test';

const email = process.env['E2E_EMAIL'] ?? 'agency-admin@demo.aisbp.com';
const password = process.env['E2E_PASSWORD'] ?? 'Demo123!';
const overrideTenantId = process.env['E2E_TENANT_ID']?.trim() ?? '';

async function loginAsAgency(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(
    (u) => /\/app\/(agency|tenant)(\/|$)/.test(u.pathname),
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

test.describe('Follow-up automation UI (workspace scoped)', () => {
  test('supports up to 10 steps; Add disabled at 10; Save persists after refresh', async ({ page }) => {
    await loginAsAgency(page);
    const tenantId = await firstTenantIdFromDirectory(page);

    await page.goto(`/app/tenant/${tenantId}/assistant/automation/follow-up`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: /Automation/i })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(/Follow-up assistant/i)).toBeVisible({ timeout: 25_000 });

    // Remove any existing steps (best-effort).
    for (let i = 0; i < 12; i++) {
      const btn = page.getByRole('button', { name: 'Delete step' }).first();
      if (await btn.count()) {
        await btn.click();
      } else {
        break;
      }
    }

    // Enable follow-up assistant
    const enable = page.getByLabel(/Enable follow-up assistant/i);
    await expect(enable).toBeVisible({ timeout: 25_000 });
    await enable.check();

    // Add steps until 10
    for (let i = 0; i < 10; i++) {
      const addBtn = page.getByRole('button', { name: 'Add step' });
      if (i === 0) {
        // If no steps exist, add first.
        await expect(addBtn).toBeVisible();
      }
      if (await addBtn.isVisible()) {
        await addBtn.click();
      }
      // Ensure step exists
      await expect(page.getByText(new RegExp(`Step\\s+${i + 1}`))).toBeVisible();
      // Ensure fixed message is non-empty (required when enabled)
      const fixedArea = page.locator('textarea').nth(i);
      await fixedArea.fill(`E2E fixed msg ${i + 1}`);
    }

    // At 10 steps, Add step should be gone and notice shown.
    await expect(page.getByRole('button', { name: 'Add step' })).toHaveCount(0);
    await expect(page.getByText(/Maximum 10 follow-up steps reached\./i)).toBeVisible();

    // Save
    await page.getByRole('button', { name: /Save follow-up settings/i }).click();
    await expect(page.getByText(/Saved\./i)).toBeVisible({ timeout: 25_000 });

    // Refresh and verify 10 steps still render.
    await page.reload({ waitUntil: 'domcontentloaded' });
    for (let i = 0; i < 10; i++) {
      await expect(page.getByText(new RegExp(`Step\\s+${i + 1}`))).toBeVisible();
    }
  });
});

