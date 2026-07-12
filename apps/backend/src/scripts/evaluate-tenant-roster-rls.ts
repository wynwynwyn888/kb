import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const STAGING_REF = 'tuxbrerxmhnotcfrmzct';
const url = String(process.env['SUPABASE_URL'] ?? '');
const anonKey = String(process.env['SUPABASE_ANON_KEY'] ?? '');
const serviceKey = String(process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '');
let hostname = '';
try { hostname = new URL(url).hostname; } catch { /* rejected below */ }
if (process.env['ALLOW_STAGING_RLS_FIXTURES'] !== '1'
  || process.env['NODE_ENV'] === 'production'
  || hostname !== `${STAGING_REF}.supabase.co`) {
  throw new Error('Refusing tenant-roster fixtures outside the designated staging project');
}
if (!anonKey || !serviceKey) throw new Error('Missing staging Supabase keys');

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomUUID().slice(0, 8);
const agencyId = `roster-rls-agency-${run}`;
const tenantA = `roster-rls-tenant-a-${run}`;
const tenantB = `roster-rls-tenant-b-${run}`;
const password = `Roster-${randomUUID()}!aA1`;
const now = () => new Date().toISOString();
type Actor = 'founder' | 'adminA' | 'agentA' | 'viewerA' | 'adminB' | 'outsider';
const actors: Actor[] = ['founder', 'adminA', 'agentA', 'viewerA', 'adminB', 'outsider'];
const emails = Object.fromEntries(
  actors.map(actor => [actor, `roster-rls-${actor.toLowerCase()}-${run}@example.invalid`]),
) as Record<Actor, string>;
const ids: Partial<Record<Actor, string>> = {};
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
  ids[actor] = data.user.id;
  must((await service.from('profiles').insert({
    id: data.user.id, email: emails[actor], full_name: `Roster ${actor}`, updated_at: now(),
  })).error, `create profile ${actor}`);
}
async function clientFor(actor: Actor): Promise<SupabaseClient> {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  must((await client.auth.signInWithPassword({ email: emails[actor], password })).error, `sign in ${actor}`);
  return client;
}
async function roster(client: SupabaseClient, tenantId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await client.rpc('list_tenant_members', { p_tenant_id: tenantId });
  must(error, 'roster RPC');
  return (data ?? []) as Array<Record<string, unknown>>;
}
async function seed(): Promise<void> {
  for (const actor of actors) await createActor(actor);
  must((await service.from('agencies').insert({ id: agencyId, name: `Roster fixture ${run}`, updated_at: now() })).error,
    'create agency');
  must((await service.from('tenants').insert([
    { id: tenantA, agency_id: agencyId, name: `Roster A ${run}`, status: 'active', updated_at: now() },
    { id: tenantB, agency_id: agencyId, name: `Roster B ${run}`, status: 'active', updated_at: now() },
  ])).error, 'create tenants');
  must((await service.from('agency_users').insert({
    id: randomUUID(), agency_id: agencyId, profile_id: ids.founder, role: 'OWNER', updated_at: now(),
  })).error, 'create founder membership');
  must((await service.from('tenant_users').insert([
    { id: randomUUID(), tenant_id: tenantA, profile_id: ids.adminA, role: 'ADMIN', updated_at: now() },
    { id: randomUUID(), tenant_id: tenantA, profile_id: ids.agentA, role: 'AGENT', updated_at: now() },
    { id: randomUUID(), tenant_id: tenantA, profile_id: ids.viewerA, role: 'VIEWER', updated_at: now() },
    { id: randomUUID(), tenant_id: tenantB, profile_id: ids.adminB, role: 'ADMIN', updated_at: now() },
  ])).error, 'create tenant memberships');
}
async function evaluate(): Promise<void> {
  const founder = await clientFor('founder');
  const adminA = await clientFor('adminA');
  const agentA = await clientFor('agentA');
  const viewerA = await clientFor('viewerA');
  const adminB = await clientFor('adminB');
  const outsider = await clientFor('outsider');
  const anonymous = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  assert((await roster(founder, tenantA)).length === 3 && (await roster(founder, tenantB)).length === 1,
    'founder reads both customer rosters');
  assert((await roster(adminA, tenantA)).length === 3 && (await roster(adminA, tenantB)).length === 0,
    'tenant A admin is confined to tenant A roster');
  assert((await roster(agentA, tenantA)).length === 3 && (await roster(agentA, tenantB)).length === 0,
    'tenant A agent is confined to tenant A roster');
  assert((await roster(viewerA, tenantA)).length === 3 && (await roster(viewerA, tenantB)).length === 0,
    'tenant A viewer is confined to tenant A roster');
  assert((await roster(adminB, tenantB)).length === 1 && (await roster(adminB, tenantA)).length === 0,
    'tenant B admin is confined to tenant B roster');
  assert((await roster(outsider, tenantA)).length === 0, 'unaffiliated user receives no roster');

  const visibleEmails = (await roster(adminA, tenantA)).map(row => String(row['email'] ?? '')).sort();
  assert(visibleEmails.length === 3 && visibleEmails.every(email => email.includes(`-${run}@example.invalid`)),
    'authorized roster returns only tenant A profile details');
  const directProfiles = await adminA.from('profiles').select('id,email');
  must(directProfiles.error, 'direct profiles query');
  assert((directProfiles.data ?? []).length === 0, 'global profiles table remains hidden');

  const directMemberships = await adminA.from('tenant_users').select('tenant_id,profile_id,role');
  must(directMemberships.error, 'direct tenant membership query');
  assert((directMemberships.data ?? []).length === 3
    && (directMemberships.data ?? []).every(row => row.tenant_id === tenantA),
  'direct tenant_users SELECT is tenant scoped');

  const anonymousRpc = await anonymous.rpc('list_tenant_members', { p_tenant_id: tenantA });
  assert(Boolean(anonymousRpc.error) && (anonymousRpc.data ?? []).length === 0,
    'anonymous caller cannot execute roster RPC');

  const insert = await adminA.from('tenant_users').insert({
    id: randomUUID(), tenant_id: tenantB, profile_id: ids.outsider, role: 'VIEWER', updated_at: now(),
  });
  const update = await adminA.from('tenant_users').update({ role: 'ADMIN' }).eq('tenant_id', tenantA).select('id');
  const remove = await adminA.from('tenant_users').delete().eq('tenant_id', tenantA).select('id');
  assert(Boolean(insert.error) && (update.data ?? []).length === 0 && (remove.data ?? []).length === 0,
    'caller roster mutations are denied');

  const [concurrentA, concurrentB] = await Promise.all([roster(adminA, tenantA), roster(adminB, tenantA)]);
  assert(concurrentA.length === 3 && concurrentB.length === 0, 'concurrent customer tokens remain isolated');
}
async function cleanup(): Promise<void> {
  await service.from('agencies').delete().eq('id', agencyId);
  const profileIds = Object.values(ids).filter((id): id is string => Boolean(id));
  if (profileIds.length) await service.from('profiles').delete().in('id', profileIds);
  for (const id of profileIds) await service.auth.admin.deleteUser(id);
}
async function main(): Promise<void> {
  try {
    await seed();
    await evaluate();
    console.log(JSON.stringify({ stagingOnly: true, contentFree: true, assertionsPassed: passed.length, assertions: passed }, null, 2));
  } finally {
    await cleanup();
  }
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Tenant roster RLS evaluation failed');
  process.exitCode = 1;
});
