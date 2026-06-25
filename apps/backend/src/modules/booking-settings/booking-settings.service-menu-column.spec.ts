import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Schema-drift guard for tenant booking settings.
 *
 * Regression context: `BookingSettingsService.patchBookingSettings` wrote a
 * `service_menu_options` column that no migration ever created, so every save
 * failed in production. The existing service spec mocks Supabase and cannot see
 * schema, so this guard asserts (without a database) that any column the service
 * writes for `tenant_booking_settings` is actually backed by a migration and by
 * the Prisma model.
 */
describe('tenant_booking_settings service_menu_options persistence guard', () => {
  const backendRoot = resolve(__dirname, '..', '..', '..');
  const servicePath = join(__dirname, 'booking-settings.service.ts');
  const schemaPath = join(backendRoot, 'prisma', 'schema.prisma');
  const migrationsDir = join(backendRoot, 'prisma', 'migrations');

  const readAllMigrationSql = (): string => {
    const entries = readdirSync(migrationsDir, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => join(migrationsDir, e.name, 'migration.sql'))
      .filter(existsSync)
      .map(p => readFileSync(p, 'utf8'))
      .join('\n');
  };

  it('the service still writes the service_menu_options column', () => {
    const service = readFileSync(servicePath, 'utf8');
    expect(service).toContain('service_menu_options');
  });

  it('a migration creates service_menu_options on tenant_booking_settings', () => {
    const sql = readAllMigrationSql();
    expect(sql).toContain('service_menu_options');
    expect(sql).toMatch(/tenant_booking_settings/);
    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS\s+"?service_menu_options"?/i,
    );
  });

  it('the Prisma model maps the service_menu_options column', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    expect(schema).toMatch(/@map\("service_menu_options"\)/);
  });
});
