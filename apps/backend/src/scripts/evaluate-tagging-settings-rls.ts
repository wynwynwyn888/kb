import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const STAGING_REF = 'tuxbrerxmhnotcfrmzct';
const url = String(process.env['SUPABASE_URL'] ?? '');
const anonKey = String(process.env['SUPABASE_ANON_KEY'] ?? '');
const serviceKey = String(process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '');
const explicitlyAllowed = process.env['ALLOW_STAGING_RLS_FIXTURES'] === '1';
let hostname = '';
try { hostname = new URL(url).hostname; } catch { /* rejected below */ }

if (!explicitlyAllowed || process.env['NODE_ENV'] === 'production' || hostname !== `${STAGING_REF}.supabase.co`) {
  throw new Error('Refusing tagging-settings RLS fixtures outside the designated staging project');
}
if (!anonKey || !serviceKey) throw new Error('Missing staging Supabase keys');

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomUUID().slice(0, 8);
const agencyId = `tag-rls-agency-${run}`;
const tenantA = `tag-rls-tenant-a-${run}`;
const tenantB = `tag-rls-tenant-b-${run}`;
const password = `Tag-Rls-${randomUUID()}!aA1`;
const now = () => new Date().toISOString();

type Actor = 'founder' | 'adminA' | 'agentA' | 'viewerA' | 'adminB' | 'outsider';
const actors: Actor[] = ['founder', 'adminA', 'agentA', 'viewerA', 'adminB', 'outsider'];
const emails = Object.fromEntries(
  actors.map(actor => [actor, `tag-rls-${actor.toLowerCase()}-${run}@example.invalid`]),
) as Record<Actor, string>;
const authIds: Partial<Record<Actor, string>> = {};
const passed: string[] = [];

function must(error: unknown, label: string): void {
  if (error) throw new Error(`${label} failed`);
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
    id: data.user.id,
    email: emails[actor],
    full_name: `Tag RLS ${actor}`,
    updated_at: now(),
  })).error, `create profile ${actor}`);
}

async function clientFor(actor: Actor): Promise<SupabaseClient> {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  must((await client.auth.signInWithPassword({ email: emails[actor], password })).error, `sign in ${actor}`);
  return client;
}

async function setting(client: SupabaseClient, tenantId: string): Promise<boolean | null> {
  const { data, error } = await client
    .from('tenant_tagging_settings')
    .select('automatic_tagging_enabled')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  must(error, 'select tagging setting');
  return data == null ? null : Boolean(data['automatic_tagging_enabled']);
}

async function seed(): Promise<void> {
  for (const actor of actors) await createActor(actor);
  must((await service.from('agencies').insert({
    id: agencyId, name: `Tag RLS fixture ${run}`, updated_at: now(),
  })).error, 'create fixture agency');
  must((await service.from('tenants').insert([
    { id: tenantA, agency_id: agencyId, name: `Tag RLS A ${run}`, status: 'active', updated_at: now() },
    { id: tenantB, agency_id: agencyId, name: `Tag RLS B ${run}`, status: 'active', updated_at: now() },
  ])).error, 'create fixture tenants');
  must((await service.from('agency_users').insert({
    id: randomUUID(), agency_id: agencyId, profile_id: authIds.founder, role: 'OWNER', updated_at: now(),
  })).error, 'create founder membership');
  must((await service.from('tenant_users').insert([
    { id: randomUUID(), tenant_id: tenantA, profile_id: authIds.adminA, role: 'ADMIN', updated_at: now() },
    { id: randomUUID(), tenant_id: tenantA, profile_id: authIds.agentA, role: 'AGENT', updated_at: now() },
    { id: randomUUID(), tenant_id: tenantA, profile_id: authIds.viewerA, role: 'VIEWER', updated_at: now() },
    { id: randomUUID(), tenant_id: tenantB, profile_id: authIds.adminB, role: 'ADMIN', updated_at: now() },
  ])).error, 'create tenant memberships');
  must((await service.from('tenant_tagging_settings').insert([
    { tenant_id: tenantA, automatic_tagging_enabled: true, updated_at: now() },
    { tenant_id: tenantB, automatic_tagging_enabled: false, updated_at: now() },
  ])).error, 'create tagging settings');
}

async function evaluate(): Promise<void> {
  const founder = await clientFor('founder');
  const adminA = await clientFor('adminA');
  const agentA = await clientFor('agentA');
  const viewerA = await clientFor('viewerA');
  const adminB = await clientFor('adminB');
  const outsider = await clientFor('outsider');
  const anonymous = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  assert(await setting(founder, tenantA) === true && await setting(founder, tenantB) === false,
    'founder reads both customer tenants');
  assert(await setting(adminA, tenantA) === true, 'tenant A admin reads tenant A');
  assert(await setting(adminA, tenantB) === null, 'tenant A admin cannot read tenant B');
  assert(await setting(agentA, tenantA) === true && await setting(agentA, tenantB) === null,
    'tenant A agent is confined to tenant A');
  assert(await setting(viewerA, tenantA) === true && await setting(viewerA, tenantB) === null,
    'tenant A viewer is confined to tenant A');
  assert(await setting(adminB, tenantB) === false && await setting(adminB, tenantA) === null,
    'tenant B admin is confined to tenant B');

  const { data: agencyRows, error: agencyError } = await adminA.from('agencies').select('id').eq('id', agencyId);
  must(agencyError, 'customer agency visibility check');
  assert((agencyRows ?? []).length === 0, 'customer cannot read agency table');
  assert(await setting(outsider, tenantA) === null && await setting(outsider, tenantB) === null,
    'unaffiliated authenticated user reads neither tenant');
  assert(await setting(anonymous, tenantA) === null && await setting(anonymous, tenantB) === null,
    'anonymous user reads neither tenant');

  const insert = await adminA.from('tenant_tagging_settings').insert({
    tenant_id: `tag-rls-forged-${run}`, automatic_tagging_enabled: true,
  });
  const update = await adminA.from('tenant_tagging_settings')
    .update({ automatic_tagging_enabled: false }).eq('tenant_id', tenantA).select('tenant_id');
  const remove = await adminA.from('tenant_tagging_settings').delete().eq('tenant_id', tenantA).select('tenant_id');
  const unchanged = await service.from('tenant_tagging_settings')
    .select('automatic_tagging_enabled').eq('tenant_id', tenantA).single();
  assert(Boolean(insert.error) && (update.data ?? []).length === 0 && (remove.data ?? []).length === 0
    && unchanged.data?.automatic_tagging_enabled === true,
  'caller insert update and delete are denied');

  const [concurrentA, concurrentB] = await Promise.all([
    setting(adminA, tenantA), setting(adminB, tenantA),
  ]);
  assert(concurrentA === true && concurrentB === null, 'concurrent customer tokens remain isolated');
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
    console.log(JSON.stringify({
      stagingOnly: true,
      contentFree: true,
      fixtureRun: run,
      assertionsPassed: passed.length,
      assertions: passed,
    }, null, 2));
  } finally {
    await cleanup();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Tagging-settings RLS evaluation failed');
  process.exitCode = 1;
});
