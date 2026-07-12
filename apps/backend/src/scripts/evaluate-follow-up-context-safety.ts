import { randomUUID } from 'node:crypto';
import { getSupabaseService } from '../lib/supabase';
import { FollowUpEngineService } from '../modules/follow-up-engine/follow-up-engine.service';
import { FollowUpSettingsService } from '../modules/follow-up-settings/follow-up-settings.service';

const STAGING_REF = 'tuxbrerxmhnotcfrmzct';
const url = String(process.env['SUPABASE_URL'] ?? '');
let hostname = '';
try { hostname = new URL(url).hostname; } catch { /* rejected below */ }
if (
  process.env['ALLOW_STAGING_RLS_FIXTURES'] !== '1'
  || process.env['NODE_ENV'] === 'production'
  || hostname !== `${STAGING_REF}.supabase.co`
) {
  throw new Error('Refusing follow-up safety fixtures outside the designated staging project');
}

const db = getSupabaseService();
const run = randomUUID().slice(0, 8);
const agencyId = `follow-safe-agency-${run}`;
const tenantA = `follow-safe-tenant-a-${run}`;
const tenantB = `follow-safe-tenant-b-${run}`;
const conversationId = randomUUID();
const passed: string[] = [];
const now = Date.now();

function must(error: unknown, label: string): void {
  if (!error) return;
  const detail = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : '';
  throw new Error(`${label} failed${detail ? `: ${detail}` : ''}`);
}
function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
  passed.push(label);
}

function makeEngine(settings: Record<string, unknown>, queue: { add: (...args: unknown[]) => Promise<unknown> }) {
  return new FollowUpEngineService(
    { getFollowUpSettings: async () => settings } as never,
    { isInHandover: async () => false } as never,
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    { ...queue, getJob: async () => null } as never,
  );
}

async function seed(): Promise<void> {
  must((await db.from('agencies').insert({
    id: agencyId, name: `Follow-up safety ${run}`, updated_at: new Date().toISOString(),
  })).error, 'create agency');
  must((await db.from('tenants').insert([
    { id: tenantA, agency_id: agencyId, name: `Follow safety A ${run}`, status: 'active', updated_at: new Date().toISOString() },
    { id: tenantB, agency_id: agencyId, name: `Follow safety B ${run}`, status: 'active', updated_at: new Date().toISOString() },
  ])).error, 'create tenants');
  must((await db.from('conversations').insert({
    id: conversationId, tenant_id: tenantA, ghl_conversation_id: `follow-safe-ghl-${run}`,
    contact_id: `contact-${run}`, channel: 'WHATSAPP', status: 'ACTIVE',
    last_message_at: new Date().toISOString(), metadata: {}, updated_at: new Date().toISOString(),
  })).error, 'create conversation');
  const rows = Array.from({ length: 35 }, (_, index) => ({
    id: randomUUID(), tenant_id: tenantA, conversation_id: conversationId,
    direction: index % 2 === 0 ? 'INBOUND' : 'OUTBOUND',
    sender: index % 2 === 0 ? 'CONTACT' : 'AI',
    content: `staging-message-${index + 1}`,
    contentType: 'TEXT', metadata: {},
    created_at: new Date(now - (35 - index) * 1000).toISOString(),
  }));
  must((await db.from('messages').insert(rows)).error, 'create messages');
}

async function evaluate(): Promise<void> {
  const engine = makeEngine({}, { add: async () => ({}) });
  const own = await (engine as unknown as {
    loadConversationMemory: (tenantId: string, conversationId: string) => Promise<{
      memory: Array<{ content: string }>; earlierSummary: string;
    }>;
  }).loadConversationMemory(tenantA, conversationId);
  assert(own.memory.length === 30, 'staging memory keeps the newest 30 messages');
  assert(own.memory[0]?.content === 'staging-message-6' && own.memory[29]?.content === 'staging-message-35',
    'staging memory is chronological and preserves the newest messages');
  assert(own.earlierSummary.includes('staging-message-1') && own.earlierSummary.includes('staging-message-5'),
    'staging memory compacts messages older than the newest 30');

  const other = await (engine as unknown as {
    loadConversationMemory: (tenantId: string, conversationId: string) => Promise<{
      memory: Array<unknown>; earlierSummary: string;
    }>;
  }).loadConversationMemory(tenantB, conversationId);
  assert(other.memory.length === 0 && other.earlierSummary === '',
    'wrong-tenant memory query returns no conversation content');

  const settingsService = new FollowUpSettingsService();
  const saved = await settingsService.patchFollowUpSettings(tenantA, {
    enabled: false, maxFollowUps: 2,
    steps: [
      { stepNumber: 1, delayAmount: 1, delayUnit: 'hours', mode: 'ai_decides', aiInstruction: '', enabled: true },
      { stepNumber: 2, delayAmount: 2, delayUnit: 'hours', mode: 'ai_decides', aiInstruction: '', enabled: true },
      { stepNumber: 3, delayAmount: 3, delayUnit: 'hours', mode: 'ai_decides', aiInstruction: '', enabled: true },
    ],
  });
  assert(saved.steps.every(step => Boolean(step.aiInstruction?.trim())),
    'empty staging AI instructions persist the documented default');

  const queueAdds: unknown[][] = [];
  const scheduler = makeEngine(
    { ...saved, enabled: true, stopOnEscalated: false },
    { add: async (...args: unknown[]) => { queueAdds.push(args); return {}; } },
  );
  await scheduler.scheduleAfterOutboundSend({
    tenantId: tenantA, conversationId, contactId: `contact-${run}`,
    ghlLocationId: `location-${run}`, sentAtIso: new Date().toISOString(),
  });
  const jobs = await db.from('conversation_follow_up_jobs').select('step_number')
    .eq('tenant_id', tenantA).eq('conversation_id', conversationId).order('step_number');
  must(jobs.error, 'read scheduled jobs');
  assert(queueAdds.length === 2 && (jobs.data ?? []).map(row => row.step_number).join(',') === '1,2',
    'staging scheduler enforces maxFollowUps without sending through GHL');
}

async function cleanup(): Promise<void> {
  await db.from('conversation_follow_up_jobs').delete().eq('tenant_id', tenantA);
  await db.from('agencies').delete().eq('id', agencyId);
}

async function verifyCleanup(): Promise<void> {
  const [agency, tenants, jobs] = await Promise.all([
    db.from('agencies').select('id').eq('id', agencyId),
    db.from('tenants').select('id').in('id', [tenantA, tenantB]),
    db.from('conversation_follow_up_jobs').select('id').eq('tenant_id', tenantA),
  ]);
  must(agency.error, 'verify agency cleanup');
  must(tenants.error, 'verify tenant cleanup');
  must(jobs.error, 'verify job cleanup');
  assert((agency.data ?? []).length === 0 && (tenants.data ?? []).length === 0 && (jobs.data ?? []).length === 0,
    'temporary staging fixtures are fully removed');
}

async function main(): Promise<void> {
  try {
    await seed();
    await evaluate();
  } finally {
    await cleanup();
  }
  await verifyCleanup();
  console.log(JSON.stringify({
    stagingOnly: true, ghlSendAttempted: false, fixtureRun: run,
    assertionsPassed: passed.length, assertions: passed,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Follow-up safety staging evaluation failed');
  process.exitCode = 1;
});
