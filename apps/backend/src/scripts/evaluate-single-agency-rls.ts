import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { AuthorizationPolicyService } from '../modules/authorization/authorization-policy.service';
import {
  AuthorizationShadowService,
  type AuthorizationShadowMetrics,
} from '../modules/authorization/authorization-shadow.service';

const url = process.env['SUPABASE_URL'] ?? '';
const anonKey = process.env['SUPABASE_ANON_KEY'] ?? '';
const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';
const allow = process.env['ALLOW_STAGING_RLS_FIXTURES'] === '1';
let hostname = '';
try {
  hostname = new URL(url).hostname;
} catch {
  // Invalid or absent URLs are rejected below.
}

if (!allow || process.env['NODE_ENV'] === 'production' || hostname !== 'tuxbrerxmhnotcfrmzct.supabase.co') {
  throw new Error('Refusing RLS fixture run: explicit staging environment is required');
}
if (!anonKey || !serviceKey) throw new Error('Missing staging Supabase keys');

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomUUID().slice(0, 8);
const agencyId = `rls-agency-${run}`;
const tenants = ['a', 'b', 'c'].map(x => `rls-tenant-${x}-${run}`);
const password = `Rls-${randomUUID()}!aA1`;

type ActorName = 'owner' | 'admin' | 'operator' | 'memberA' | 'memberOnly' | 'viewerB' | 'revoked' | 'outsider';
const emails: Record<ActorName, string> = {
  owner: `rls-owner-${run}@example.invalid`,
  admin: `rls-admin-${run}@example.invalid`,
  operator: `rls-operator-${run}@example.invalid`,
  memberA: `rls-member-a-${run}@example.invalid`,
  memberOnly: `rls-member-only-${run}@example.invalid`,
  viewerB: `rls-viewer-b-${run}@example.invalid`,
  revoked: `rls-revoked-${run}@example.invalid`,
  outsider: `rls-outsider-${run}@example.invalid`,
};
const authIds: Partial<Record<ActorName, string>> = {};
const now = (): string => new Date().toISOString();

function must(error: unknown, label: string): void {
  if (error) throw new Error(`${label}: ${JSON.stringify(error)}`);
}

async function createActor(name: ActorName): Promise<void> {
  const { data, error } = await service.auth.admin.createUser({
    email: emails[name], password, email_confirm: true,
  });
  must(error, `create auth ${name}`);
  if (!data.user) throw new Error(`create auth ${name}: no user`);
  authIds[name] = data.user.id;
  const { error: profileError } = await service.from('profiles').insert({
    id: data.user.id, email: emails[name], full_name: `RLS ${name}`, updated_at: now(),
  });
  must(profileError, `create profile ${name}`);
}

async function userClient(name: ActorName): Promise<SupabaseClient> {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email: emails[name], password });
  must(error, `sign in ${name}`);
  return client;
}

async function visibleTenants(client: SupabaseClient, table: string): Promise<string[]> {
  const { data, error } = await client.from(table).select('tenant_id').order('tenant_id');
  must(error, `select ${table}`);
  return [...new Set((data ?? []).map(row => String(row['tenant_id'])))];
}

function expectTenants(actual: string[], expected: string[], label: string): void {
  const a = [...actual].sort();
  const e = [...expected].sort();
  if (JSON.stringify(a) !== JSON.stringify(e)) {
    throw new Error(`${label}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
  }
}

async function expectInsertDenied(client: SupabaseClient, table: 'messages' | 'handover_events'): Promise<void> {
  const tenantId = tenants[0]!;
  const conversationId = `rls-conv-a-${run}`;
  const payload = table === 'messages'
    ? { id: randomUUID(), tenant_id: tenantId, conversation_id: conversationId, direction: 'INBOUND', sender: 'CONTACT', content: 'RLS fixture', contentType: 'TEXT' }
    : { id: randomUUID(), tenant_id: tenantId, conversation_id: conversationId, type: 'REQUEST', status: 'ACTIVE', initiated_by: 'contact' };
  const { error } = await client.from(table).insert(payload);
  if (!error) throw new Error(`${table}: authenticated insert unexpectedly allowed`);
}

async function seed(): Promise<void> {
  for (const name of Object.keys(emails) as ActorName[]) await createActor(name);
  must((await service.from('agencies').insert({ id: agencyId, name: `RLS agency ${run}`, updated_at: now() })).error, 'agency');
  must((await service.from('tenants').insert(tenants.map((id, i) => ({ id, agency_id: agencyId, name: `RLS tenant ${i + 1}`, status: 'active', updated_at: now() })))).error, 'tenants');
  must((await service.from('agency_users').insert([
    { id: randomUUID(), agency_id: agencyId, profile_id: authIds.owner, role: 'OWNER', updated_at: now() },
    { id: randomUUID(), agency_id: agencyId, profile_id: authIds.admin, role: 'ADMIN', updated_at: now() },
    { id: randomUUID(), agency_id: agencyId, profile_id: authIds.operator, role: 'OPERATOR', updated_at: now() },
    { id: randomUUID(), agency_id: agencyId, profile_id: authIds.memberA, role: 'MEMBER', updated_at: now() },
    { id: randomUUID(), agency_id: agencyId, profile_id: authIds.memberOnly, role: 'MEMBER', updated_at: now() },
  ])).error, 'agency memberships');
  const revokedMembershipId = randomUUID();
  must((await service.from('tenant_users').insert([
    { id: randomUUID(), tenant_id: tenants[0], profile_id: authIds.memberA, role: 'AGENT', updated_at: now() },
    { id: randomUUID(), tenant_id: tenants[1], profile_id: authIds.viewerB, role: 'VIEWER', updated_at: now() },
    { id: revokedMembershipId, tenant_id: tenants[2], profile_id: authIds.revoked, role: 'VIEWER', updated_at: now() },
  ])).error, 'tenant memberships');
  must((await service.from('tenant_users').delete().eq('id', revokedMembershipId)).error, 'revoke tenant membership');

  const conversations = tenants.map((tenantId, i) => ({
    id: `rls-conv-${String.fromCharCode(97 + i)}-${run}`,
    tenant_id: tenantId,
    ghl_conversation_id: `rls-ghl-${i}-${run}`,
    contact_id: `rls-contact-${i}-${run}`,
    channel: 'CHAT', status: 'ACTIVE', last_message_at: now(), updated_at: now(),
  }));
  must((await service.from('conversations').insert(conversations)).error, 'conversations');
  must((await service.from('messages').insert(conversations.map((c, i) => ({
    id: randomUUID(), tenant_id: c.tenant_id, conversation_id: c.id,
    direction: 'INBOUND', sender: 'CONTACT', content: `RLS fixture ${i}`, contentType: 'TEXT',
  })))).error, 'messages');
  must((await service.from('handover_events').insert(conversations.map(c => ({
    id: randomUUID(), tenant_id: c.tenant_id, conversation_id: c.id,
    type: 'REQUEST', status: 'ACTIVE', initiated_by: 'contact', updated_at: now(),
  })))).error, 'handovers');

  const profiles = tenants.map((tenantId, i) => ({
    id: `rls-bot-${i}-${run}`, tenant_id: tenantId, name: `RLS bot ${i}-${run}`,
    is_active: true, updated_at: now(),
  }));
  const vaults = tenants.map((tenantId, i) => ({
    id: `rls-vault-${i}-${run}`, tenant_id: tenantId, name: `RLS vault ${i}-${run}`, updated_at: now(),
  }));
  must((await service.from('tenant_bot_profiles').insert(profiles)).error, 'bot profiles');
  must((await service.from('knowledge_vaults').insert(vaults)).error, 'vaults');
  must((await service.from('tenant_bot_profile_knowledge_vaults').insert(profiles.map((p, i) => ({
    tenant_id: p.tenant_id, profile_id: p.id, vault_id: vaults[i]!.id,
  })))).error, 'profile vault links');
}

async function cleanup(): Promise<void> {
  must((await service.from('agencies').delete().eq('id', agencyId)).error, 'cleanup agency');
  const ids = Object.values(authIds).filter((id): id is string => Boolean(id));
  if (ids.length > 0) must((await service.from('profiles').delete().in('id', ids)).error, 'cleanup profiles');
  for (const id of ids) {
    if (id) must((await service.auth.admin.deleteUser(id)).error, 'cleanup auth user');
  }
}

function expectMetric(
  metrics: AuthorizationShadowMetrics,
  key: keyof AuthorizationShadowMetrics,
  expected: number,
): void {
  if (metrics[key] !== expected) {
    throw new Error(`shadow metric ${key}: expected ${expected}, got ${metrics[key]}`);
  }
}

async function evaluateAuthorizationShadow(): Promise<AuthorizationShadowMetrics> {
  const previous = {
    enabled: process.env['AUTHORIZATION_SHADOW_ENABLED'],
    maximum: process.env['AUTHORIZATION_SHADOW_MAX_CONCURRENT'],
    timeout: process.env['AUTHORIZATION_SHADOW_TIMEOUT_MS'],
  };
  process.env['AUTHORIZATION_SHADOW_ENABLED'] = 'true';
  process.env['AUTHORIZATION_SHADOW_MAX_CONCURRENT'] = '8';
  process.env['AUTHORIZATION_SHADOW_TIMEOUT_MS'] = '5000';
  try {
    const shadow = new AuthorizationShadowService(new AuthorizationPolicyService());
    const observations = [
      { actor: 'owner' as const, tenantId: tenants[0]!, legacyAllowed: true },
      // Same pair intentionally overlaps to prove in-flight deduplication.
      { actor: 'owner' as const, tenantId: tenants[0]!, legacyAllowed: true },
      { actor: 'admin' as const, tenantId: tenants[1]!, legacyAllowed: true },
      { actor: 'operator' as const, tenantId: tenants[2]!, legacyAllowed: true },
      { actor: 'memberA' as const, tenantId: tenants[0]!, legacyAllowed: true },
      // Expected disagreement: legacy app allows agency MEMBER, contract does not.
      { actor: 'memberOnly' as const, tenantId: tenants[0]!, legacyAllowed: true },
      { actor: 'viewerB' as const, tenantId: tenants[1]!, legacyAllowed: true },
      { actor: 'revoked' as const, tenantId: tenants[2]!, legacyAllowed: false },
      { actor: 'outsider' as const, tenantId: tenants[0]!, legacyAllowed: false },
    ];
    await Promise.all(observations.map(item => shadow.observeTenantAccess({
      profileId: authIds[item.actor]!,
      tenantId: item.tenantId,
      action: 'read',
      legacyAllowed: item.legacyAllowed,
      source: 'staging-real-fixture',
    })));
    // The owner pair is now cached and must not create another database load.
    await shadow.observeTenantAccess({
      profileId: authIds.owner!, tenantId: tenants[0]!, action: 'read',
      legacyAllowed: true, source: 'staging-real-fixture-cache',
    });

    const metrics = shadow.getMetricsSnapshot();
    expectMetric(metrics, 'observed', 10);
    expectMetric(metrics, 'match', 9);
    expectMetric(metrics, 'disagreement', 1);
    expectMetric(metrics, 'unavailable', 0);
    expectMetric(metrics, 'error', 0);
    expectMetric(metrics, 'timeout', 0);
    expectMetric(metrics, 'capacity', 0);
    expectMetric(metrics, 'cacheHit', 1);
    expectMetric(metrics, 'deduplicated', 1);
    expectMetric(metrics, 'databaseLoad', 8);
    return metrics;
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      const envName = key === 'enabled'
        ? 'AUTHORIZATION_SHADOW_ENABLED'
        : key === 'maximum'
          ? 'AUTHORIZATION_SHADOW_MAX_CONCURRENT'
          : 'AUTHORIZATION_SHADOW_TIMEOUT_MS';
      if (value === undefined) delete process.env[envName];
      else process.env[envName] = value;
    }
  }
}

async function main(): Promise<void> {
  const report: Record<string, unknown> = { run, stagingOnly: true };
  try {
    await seed();
    const clients = Object.fromEntries(await Promise.all(
      (Object.keys(emails) as ActorName[]).map(async name => [name, await userClient(name)]),
    )) as Record<ActorName, SupabaseClient>;
    const tables = ['messages', 'handover_events', 'tenant_bot_profile_knowledge_vaults'];
    const expected: Record<ActorName, string[]> = {
      owner: tenants,
      admin: tenants,
      operator: tenants,
      memberA: [tenants[0]!],
      memberOnly: [],
      viewerB: [tenants[1]!],
      revoked: [],
      outsider: [],
    };
    for (const [actor, client] of Object.entries(clients) as Array<[ActorName, SupabaseClient]>) {
      for (const table of tables) {
        const visible = await visibleTenants(client, table);
        expectTenants(visible, expected[actor], `${actor}/${table}`);
      }
    }
    const anonymous = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    for (const table of tables) {
      expectTenants(await visibleTenants(anonymous, table), [], `anonymous/${table}`);
    }
    await expectInsertDenied(clients.memberA, 'messages');
    await expectInsertDenied(clients.memberA, 'handover_events');
    const shadowMetrics = await evaluateAuthorizationShadow();
    report['passed'] = true;
    report['assertions'] = 39;
    report['shadow'] = shadowMetrics;
  } finally {
    await cleanup();
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
