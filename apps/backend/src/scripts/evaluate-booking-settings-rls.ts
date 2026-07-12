import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const STAGING_REF = 'tuxbrerxmhnotcfrmzct';
const url = String(process.env['SUPABASE_URL'] ?? '');
const anonKey = String(process.env['SUPABASE_ANON_KEY'] ?? '');
const serviceKey = String(process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '');
let hostname = '';
try { hostname = new URL(url).hostname; } catch { /* rejected below */ }
if (
  process.env['ALLOW_STAGING_RLS_FIXTURES'] !== '1'
  || process.env['NODE_ENV'] === 'production'
  || hostname !== `${STAGING_REF}.supabase.co`
) {
  throw new Error('Refusing booking-settings fixtures outside the designated staging project');
}
if (!anonKey || !serviceKey) throw new Error('Missing staging Supabase keys');

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomUUID().slice(0, 8);
const agencyId = `book-rls-agency-${run}`;
const tenantA = `book-rls-tenant-a-${run}`;
const tenantB = `book-rls-tenant-b-${run}`;
const password = `Book-Rls-${randomUUID()}!aA1`;
const staffNumber = '+6599990000';
const staffTemplate = 'Private staff booking alert';
const now = () => new Date().toISOString();

type Actor = 'owner' | 'operator' | 'adminA' | 'agentA' | 'viewerA' | 'adminB' | 'outsider';
const actors: Actor[] = ['owner', 'operator', 'adminA', 'agentA', 'viewerA', 'adminB', 'outsider'];
const emails = Object.fromEntries(
  actors.map(actor => [actor, `book-rls-${actor.toLowerCase()}-${run}@example.invalid`]),
) as Record<Actor, string>;
const authIds: Partial<Record<Actor, string>> = {};
const passed: string[] = [];

function must(error: unknown, label: string): void {
  if (error) {
    const detail = typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : '';
    throw new Error(`${label} failed${detail ? `: ${detail}` : ''}`);
  }
}
function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
  passed.push(label);
}

async function createActor(actor: Actor): Promise<void> {
  const { data, error } = await service.auth.admin.createUser({
    email: emails[actor], password, email_confirm: true,
  });
  must(error, `create auth ${actor}`);
  if (!data.user) throw new Error(`create auth ${actor} returned no user`);
  authIds[actor] = data.user.id;
  must((await service.from('profiles').insert({
    id: data.user.id, email: emails[actor], full_name: `Booking RLS ${actor}`, updated_at: now(),
  })).error, `create profile ${actor}`);
}

async function clientFor(actor: Actor): Promise<SupabaseClient> {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  must((await client.auth.signInWithPassword({ email: emails[actor], password })).error, `sign in ${actor}`);
  return client;
}

async function rpc(client: SupabaseClient, tenantId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await client.rpc('get_tenant_booking_settings', { p_tenant_id: tenantId });
  must(error, 'booking settings RPC');
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === 'object' ? row as Record<string, unknown> : null;
}

async function seed(): Promise<void> {
  for (const actor of actors) await createActor(actor);
  must((await service.from('agencies').insert({
    id: agencyId, name: `Booking RLS fixture ${run}`, updated_at: now(),
  })).error, 'create fixture agency');
  must((await service.from('tenants').insert([
    { id: tenantA, agency_id: agencyId, name: `Booking RLS A ${run}`, status: 'active', updated_at: now() },
    { id: tenantB, agency_id: agencyId, name: `Booking RLS B ${run}`, status: 'active', updated_at: now() },
  ])).error, 'create fixture tenants');
  must((await service.from('agency_users').insert([
    { id: randomUUID(), agency_id: agencyId, profile_id: authIds.owner, role: 'OWNER', updated_at: now() },
    { id: randomUUID(), agency_id: agencyId, profile_id: authIds.operator, role: 'OPERATOR', updated_at: now() },
  ])).error, 'create agency memberships');
  must((await service.from('tenant_users').insert([
    { id: randomUUID(), tenant_id: tenantA, profile_id: authIds.adminA, role: 'ADMIN', updated_at: now() },
    { id: randomUUID(), tenant_id: tenantA, profile_id: authIds.agentA, role: 'AGENT', updated_at: now() },
    { id: randomUUID(), tenant_id: tenantA, profile_id: authIds.viewerA, role: 'VIEWER', updated_at: now() },
    { id: randomUUID(), tenant_id: tenantB, profile_id: authIds.adminB, role: 'ADMIN', updated_at: now() },
  ])).error, 'create tenant memberships');
  must((await service.from('tenant_booking_settings').insert([
    {
      tenant_id: tenantA, enabled: true, booking_mode: 'CHECK_AVAILABILITY',
      internal_booking_alert_enabled: true, internal_booking_alert_number: staffNumber,
      internal_booking_alert_channel: 'GHL_MESSAGE',
      internal_booking_alert_template: staffTemplate, updated_at: now(),
    },
    {
      tenant_id: tenantB, enabled: false, booking_mode: 'COLLECT_DETAILS_ONLY',
      internal_booking_alert_enabled: false, internal_booking_alert_number: null,
      internal_booking_alert_channel: 'GHL_MESSAGE', internal_booking_alert_template: null,
      updated_at: now(),
    },
  ])).error, 'create booking settings');
}

async function evaluate(): Promise<void> {
  const owner = await clientFor('owner');
  const operator = await clientFor('operator');
  const adminA = await clientFor('adminA');
  const agentA = await clientFor('agentA');
  const viewerA = await clientFor('viewerA');
  const adminB = await clientFor('adminB');
  const outsider = await clientFor('outsider');
  const anonymous = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const ownerA = await rpc(owner, tenantA);
  assert(ownerA?.['can_manage'] === true && ownerA['internal_booking_alert_number'] === staffNumber,
    'agency owner reads complete settings and can manage');
  assert((await rpc(owner, tenantB))?.['can_manage'] === true, 'agency owner reads both customer tenants');

  const operatorA = await rpc(operator, tenantA);
  assert(operatorA?.['enabled'] === true && operatorA['can_manage'] === false
    && operatorA['internal_booking_alert_number'] === null
    && operatorA['internal_booking_alert_template'] === null,
  'agency operator reads operational settings with staff alert fields redacted');

  const adminARow = await rpc(adminA, tenantA);
  assert(adminARow?.['can_manage'] === true && adminARow['internal_booking_alert_number'] === staffNumber,
    'tenant admin reads complete own-tenant settings and can manage');
  assert(await rpc(adminA, tenantB) === null, 'tenant A admin cannot read tenant B');

  for (const [label, client] of [['agent', agentA], ['viewer', viewerA]] as const) {
    const row = await rpc(client, tenantA);
    assert(row?.['enabled'] === true && row['can_manage'] === false
      && row['internal_booking_alert_number'] === null
      && row['internal_booking_alert_template'] === null,
    `tenant ${label} reads status with staff alert fields redacted`);
  }
  assert((await rpc(adminB, tenantB))?.['can_manage'] === true && await rpc(adminB, tenantA) === null,
    'tenant B admin is confined to tenant B');
  assert(await rpc(outsider, tenantA) === null && await rpc(outsider, tenantB) === null,
    'unaffiliated authenticated user reads neither tenant');

  const anonRpc = await anonymous.rpc('get_tenant_booking_settings', { p_tenant_id: tenantA });
  assert(Boolean(anonRpc.error), 'anonymous RPC execution is denied');

  const direct = await adminA.from('tenant_booking_settings').select('*').eq('tenant_id', tenantA);
  must(direct.error, 'direct booking table SELECT');
  assert((direct.data ?? []).length === 0, 'direct authenticated table read remains closed');

  const insert = await adminA.from('tenant_booking_settings').insert({
    tenant_id: `book-rls-forged-${run}`, enabled: true,
  });
  const update = await adminA.from('tenant_booking_settings').update({ enabled: false })
    .eq('tenant_id', tenantA).select('tenant_id');
  const remove = await adminA.from('tenant_booking_settings').delete()
    .eq('tenant_id', tenantA).select('tenant_id');
  const unchanged = await service.from('tenant_booking_settings').select('enabled')
    .eq('tenant_id', tenantA).single();
  assert(Boolean(insert.error) && (update.data ?? []).length === 0 && (remove.data ?? []).length === 0
    && unchanged.data?.enabled === true,
  'direct caller insert update and delete are denied');

  const [concurrentA, concurrentB] = await Promise.all([rpc(adminA, tenantA), rpc(adminB, tenantA)]);
  assert(concurrentA?.['can_manage'] === true && concurrentB === null,
    'concurrent customer tokens remain isolated');
}

async function cleanup(): Promise<void> {
  await service.from('agencies').delete().eq('id', agencyId);
  const ids = Object.values(authIds).filter((id): id is string => Boolean(id));
  if (ids.length) await service.from('profiles').delete().in('id', ids);
  for (const id of ids) await service.auth.admin.deleteUser(id);
}

async function main(): Promise<void> {
  try {
    await seed();
    await evaluate();
  } finally {
    await cleanup();
  }
  const [agencies, tenants, profiles, authUsers] = await Promise.all([
    service.from('agencies').select('id').eq('id', agencyId),
    service.from('tenants').select('id').like('id', `book-rls-tenant-%-${run}`),
    service.from('profiles').select('id').in('id', Object.values(authIds).filter(Boolean)),
    service.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  must(agencies.error, 'verify agency cleanup');
  must(tenants.error, 'verify tenant cleanup');
  must(profiles.error, 'verify profile cleanup');
  must(authUsers.error, 'verify auth cleanup');
  const fixtureEmails = new Set(Object.values(emails));
  assert(
    (agencies.data ?? []).length === 0
      && (tenants.data ?? []).length === 0
      && (profiles.data ?? []).length === 0
      && !(authUsers.data?.users ?? []).some(user => fixtureEmails.has(user.email ?? '')),
    'temporary database and auth fixtures are fully removed',
  );
  console.log(JSON.stringify({
    stagingOnly: true, contentFree: true, fixtureRun: run,
    assertionsPassed: passed.length, assertions: passed,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Booking-settings RLS evaluation failed');
  process.exitCode = 1;
});
