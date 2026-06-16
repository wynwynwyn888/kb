import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { getSupabaseService } from '../../lib/supabase';
import { QUEUES } from '../../queues/queue.constants';
import { FollowUpSettingsService } from '../follow-up-settings/follow-up-settings.service';
import { resolveAppTimeZone, wallClockInZoneToUtcMs } from '../../lib/business-time';
import { ConversationsService } from '../conversations/conversations.service';
import { GenerationService } from '../generation/generation.service';
import { KbService } from '../kb/kb.service';
import { AgencyAiConfigService } from '../agency-ai-config/agency-ai-config.service';
import { BotProfilesService } from '../prompts/bot-profiles.service';
import { OutboundSendService } from '../outbound/outbound-send.service';
import { OutboundSafetyGovernorService } from '../outbound/outbound-safety-governor.service';
import { formatLiveCustomerDraftForPreview } from '../../lib/live-outbound-preview';
import { toBullSafeFollowUpJobId } from './follow-up-bull-job-id';
import {
  mergeConversationMetadataForPersist,
  readConversationMetadataField,
} from '../../lib/conversation-metadata-merge';
import { rewriteUnsupportedBusinessClaimsWhenNoKb } from '../../lib/outbound-safety-governor';
import type { MemoryEntry } from '../orchestration/dto/memory-entry';
import type { RetrievalChunk } from '../kb/dto/retrieval.dto';
import type { ReplyDecision } from '../reply-planning/dto';

type FollowUpJobStatus = 'PENDING' | 'SENT' | 'SKIPPED' | 'FAILED';

export type FollowUpProcessorJob =
  | {
      kind: 'send_step';
      followUpJobId: string;
    };

const DEFAULT_AI_INSTRUCTION =
  'Gentle nudge only. Do not sound salesy. Follow up based on the previous conversation context.';

function parseTenantTzFromSettings(settings: unknown): string | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const r = settings as Record<string, unknown>;
  for (const key of ['timeZone', 'timezone', 'crmTimezone', 'businessTimezone']) {
    const v = r[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function weekdayKeyInZone(timeZone: string, at: Date): 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' {
  // en-US weekday is stable for mapping; we do not use locale-specific strings in persistence.
  const wd = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(at).toLowerCase();
  switch (wd) {
    case 'mon':
      return 'mon';
    case 'tue':
      return 'tue';
    case 'wed':
      return 'wed';
    case 'thu':
      return 'thu';
    case 'fri':
      return 'fri';
    case 'sat':
      return 'sat';
    default:
      return 'sun';
  }
}

function hmToParts(hm: string): { hour: number; minute: number } | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hm.trim());
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

function withinWindowLocalMinutes(nowHm: { hour: number; minute: number }, start: { hour: number; minute: number }, end: { hour: number; minute: number }): boolean {
  const n = nowHm.hour * 60 + nowHm.minute;
  const s = start.hour * 60 + start.minute;
  const e = end.hour * 60 + end.minute;
  if (e <= s) {
    // Treat inverted windows as disabled (prevents accidental overnight sends).
    return false;
  }
  return n >= s && n < e;
}

function localWallClockParts(timeZone: string, at: Date): { y: number; m: number; d: number; hour: number; minute: number } {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(at);
  const n = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === type)?.value ?? 0);
  return { y: n('year'), m: n('month'), d: n('day'), hour: n('hour'), minute: n('minute') };
}

@Injectable()
export class FollowUpEngineService {
  private readonly logger = new Logger(FollowUpEngineService.name);
  private readonly supabase = getSupabaseService();

  constructor(
    private readonly followUpSettings: FollowUpSettingsService,
    private readonly conversations: ConversationsService,
    private readonly generation: GenerationService,
    private readonly kb: KbService,
    private readonly agencyAiConfig: AgencyAiConfigService,
    private readonly botProfiles: BotProfilesService,
    private readonly outboundSend: OutboundSendService,
    private readonly outboundSafetyGovernor: OutboundSafetyGovernorService,
    @InjectQueue(QUEUES.FOLLOW_UP) private readonly followUpQueue: Queue,
  ) {}

  async resolveTenantTimeZone(tenantId: string): Promise<string> {
    const { data, error } = await this.supabase.from('tenants').select('settings').eq('id', tenantId).maybeSingle();
    if (error) {
      this.logger.warn(`resolveTenantTimeZone: ${error.message}`);
    }
    const tz = parseTenantTzFromSettings(data?.settings) ?? resolveAppTimeZone();
    return tz || 'Asia/Singapore';
  }

  /**
   * Called after a successful outbound send bubble.
   * Schedules follow-up step jobs (delayed) and persists rows for observability.
   */
  async scheduleAfterOutboundSend(params: {
    tenantId: string;
    conversationId: string;
    contactId: string;
    ghlLocationId: string;
    sentAtIso: string;
  }): Promise<void> {
    const { tenantId, conversationId, contactId, ghlLocationId, sentAtIso } = params;
    const settings = await this.followUpSettings.getFollowUpSettings(tenantId);
    if (!settings.enabled) return;

    if (settings.stopOnEscalated) {
      const inHandover = await this.conversations.isInHandover(conversationId);
      if (inHandover) {
        this.logger.log(
          `followUpScheduleSkipped ${JSON.stringify({ tenantId, conversationId, reason: 'handover_active' })}`,
        );
        return;
      }
    }

    const enabledSteps = (settings.steps ?? []).filter(s => s.enabled);
    if (enabledSteps.length === 0) return;

    const scheduleVersion = await this.bumpFollowUpScheduleVersion(conversationId, 'outbound_sent');

    for (const step of enabledSteps) {
      const dueAtIso = this.computeDueAtIso(sentAtIso, step.delayAmount, String(step.delayUnit));
      const rowId = randomUUID();
      const { error } = await this.supabase.from('conversation_follow_up_jobs').insert({
        id: rowId,
        tenant_id: tenantId,
        conversation_id: conversationId,
        contact_id: contactId,
        ghl_location_id: ghlLocationId,
        step_number: step.stepNumber,
        schedule_version: scheduleVersion,
        scheduled_at: sentAtIso,
        due_at: dueAtIso,
        status: 'PENDING',
        step_snapshot_json: step,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (error) {
        this.logger.warn(`followUpSchedulePersistFailed ${JSON.stringify({ tenantId, conversationId, err: error.message })}`);
        continue;
      }
      const delayMs = Math.max(0, Date.parse(dueAtIso) - Date.now());
      const bullJobId = toBullSafeFollowUpJobId(rowId);
      try {
        await this.followUpQueue.add(
          'follow-up',
          { kind: 'send_step', followUpJobId: rowId } satisfies FollowUpProcessorJob,
          {
            jobId: bullJobId,
            delay: delayMs,
            attempts: 2,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: true,
            removeOnFail: false,
          },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        try {
          await this.markJobFailed(rowId, 'queue_enqueue_failed', { error: msg, bullJobId });
        } catch (markErr) {
          const markMsg = markErr instanceof Error ? markErr.message : String(markErr);
          this.logger.warn(
            `followUpScheduleMarkFailedAfterEnqueueError ${JSON.stringify({
              tenantId,
              conversationId,
              followUpJobId: rowId,
              bullJobId,
              stepNumber: step.stepNumber,
              err: markMsg,
            })}`,
          );
        }
        this.logger.warn(
          `followUpScheduleEnqueueFailed ${JSON.stringify({
            tenantId,
            conversationId,
            followUpJobId: rowId,
            bullJobId,
            stepNumber: step.stepNumber,
            err: msg,
          })}`,
        );
        continue;
      }
      this.logger.log(
        `followUpScheduled ${JSON.stringify({
          tenantId,
          conversationId,
          contactId,
          followUpJobId: rowId,
          stepNumber: step.stepNumber,
          dueAtIso,
          delayMs,
          scheduleVersion,
        })}`,
      );
    }
  }

  /**
   * Called on inbound contact message to stop pending follow-ups when configured.
   * Also marks pending DB rows as SKIPPED for observability.
   */
  async noteInboundFromContact(params: { tenantId: string; conversationId: string; inboundText: string; inboundAtIso: string }): Promise<void> {
    const { tenantId, conversationId, inboundText, inboundAtIso } = params;
    const settings = await this.followUpSettings.getFollowUpSettings(tenantId);
    const isOptOut = this.detectOptOut(inboundText);
    if (isOptOut) {
      await this.markConversationOptOut(conversationId, inboundAtIso, inboundText);
    }

    if (!settings.enabled) return;
    if (!settings.stopOnCustomerReply) return;

    const scheduleVersion = await this.bumpFollowUpScheduleVersion(conversationId, 'customer_reply');
    const { error } = await this.supabase
      .from('conversation_follow_up_jobs')
      .update({
        status: 'SKIPPED' satisfies FollowUpJobStatus,
        decided_at: new Date().toISOString(),
        decision_reason: 'customer_replied',
        updated_at: new Date().toISOString(),
      })
      .eq('conversation_id', conversationId)
      .eq('status', 'PENDING');
    if (error) {
      this.logger.warn(`followUpSkipMarkFailed ${JSON.stringify({ conversationId, err: error.message })}`);
    }
    this.logger.log(
      `followUpCustomerReply ${JSON.stringify({
        tenantId,
        conversationId,
        inboundAtIso,
        scheduleVersion,
        optOutDetected: isOptOut,
      })}`,
    );
  }

  /**
   * When the conversation is escalated to humans, invalidate pending follow-up work and mark rows skipped.
   */
  async cancelPendingJobsForHumanEscalation(params: { tenantId: string; conversationId: string }): Promise<void> {
    await this.invalidatePendingFollowUpJobs(params, 'human_escalated');
  }

  /**
   * When bot state is reset, invalidate pending follow-up work so stale nudges do not fire.
   */
  async cancelPendingJobsForBotReset(params: { tenantId: string; conversationId: string }): Promise<void> {
    await this.invalidatePendingFollowUpJobs(params, 'bot_reset');
  }

  private async invalidatePendingFollowUpJobs(
    params: { tenantId: string; conversationId: string },
    reason: 'human_escalated' | 'bot_reset',
  ): Promise<void> {
    const { tenantId, conversationId } = params;
    const { data: pendingRows } = await this.supabase
      .from('conversation_follow_up_jobs')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('status', 'PENDING');
    for (const row of pendingRows ?? []) {
      const id = typeof row.id === 'string' ? row.id : '';
      if (!id) continue;
      try {
        const bullJob = await this.followUpQueue.getJob(toBullSafeFollowUpJobId(id));
        if (bullJob) await bullJob.remove();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(
          `followUpBullJobRemoveFailed ${JSON.stringify({ conversationId, followUpJobId: id, err: msg })}`,
        );
      }
    }
    const scheduleVersion = await this.bumpFollowUpScheduleVersion(conversationId, reason);
    const { error } = await this.supabase
      .from('conversation_follow_up_jobs')
      .update({
        status: 'SKIPPED',
        decided_at: new Date().toISOString(),
        decision_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('conversation_id', conversationId)
      .eq('status', 'PENDING');
    if (error) {
      this.logger.warn(`followUpSkipMarkFailed ${JSON.stringify({ conversationId, err: error.message })}`);
    }
    this.logger.log(
      `followUpSkipped ${JSON.stringify({
        tenantId,
        conversationId,
        reason,
        scheduleVersion,
      })}`,
    );
  }

  async processFollowUpJob(followUpJobId: string): Promise<void> {
    const { data: row, error } = await this.supabase
      .from('conversation_follow_up_jobs')
      .select('*')
      .eq('id', followUpJobId)
      .maybeSingle();
    if (error || !row) {
      this.logger.warn(`followUpJobMissing ${JSON.stringify({ followUpJobId, err: error?.message ?? null })}`);
      return;
    }

    if (row.status !== 'PENDING') return;

    const tenantId = String(row.tenant_id);
    const conversationId = String(row.conversation_id);
    const contactId = String(row.contact_id);
    const ghlLocationId = String(row.ghl_location_id);
    const scheduleVersion = Number(row.schedule_version ?? 0);
    const scheduledAtIso = String(row.scheduled_at);

    // Stale schedule protection
    const curVer = await this.getConversationFollowUpScheduleVersion(conversationId);
    if (curVer !== scheduleVersion) {
      await this.markJobSkipped(followUpJobId, 'stale_schedule_version', { curVer, scheduleVersion });
      this.logger.log(`followUpSkipped ${JSON.stringify({ tenantId, conversationId, followUpJobId, reason: 'stale_version', curVer, scheduleVersion })}`);
      return;
    }

    const settings = await this.followUpSettings.getFollowUpSettings(tenantId);
    if (!settings.enabled) {
      await this.markJobSkipped(followUpJobId, 'follow_up_disabled');
      return;
    }

    // Stop conditions
    if (settings.stopOnEscalated) {
      const inHandover = await this.conversations.isInHandover(conversationId);
      if (inHandover) {
        await this.markJobSkipped(followUpJobId, 'handover_active');
        this.logger.log(
          `followUpSkipped ${JSON.stringify({ tenantId, conversationId, followUpJobId, reason: 'handover_active' })}`,
        );
        return;
      }
    }

    if (settings.stopOnOptOut) {
      const opted = await this.isConversationOptedOut(conversationId);
      if (opted) {
        await this.markJobSkipped(followUpJobId, 'opted_out');
        this.logger.log(
          `followUpSkipped ${JSON.stringify({ tenantId, conversationId, followUpJobId, reason: 'opted_out' })}`,
        );
        return;
      }
    }

    if (settings.stopOnCustomerReply) {
      const replied = await this.hasInboundAfter(conversationId, scheduledAtIso);
      if (replied) {
        await this.markJobSkipped(followUpJobId, 'customer_replied_after_scheduled');
        this.logger.log(
          `followUpSkipped ${JSON.stringify({ tenantId, conversationId, followUpJobId, reason: 'customer_replied' })}`,
        );
        return;
      }
    }

    // Active hours deferral
    const step = row.step_snapshot_json as Record<string, unknown> | null;
    const stepNumber = Number(row.step_number ?? 0);
    if (!step || !Number.isFinite(stepNumber) || stepNumber <= 0) {
      await this.markJobFailed(followUpJobId, 'invalid_step_snapshot');
      return;
    }

    const tenantTz = await this.resolveTenantTimeZone(tenantId);
    if (settings.businessHoursOnly) {
      const snapNow = new Date();
      const within = this.isWithinActiveHours(settings.activeHoursWindows, tenantTz, snapNow);
      if (!within) {
        const nextUtcMs = this.computeNextActiveWindowUtcMs(settings.activeHoursWindows, tenantTz, snapNow);
        if (!nextUtcMs) {
          await this.markJobSkipped(followUpJobId, 'no_active_windows_configured');
          this.logger.log(
            `followUpSkipped ${JSON.stringify({ tenantId, conversationId, followUpJobId, reason: 'no_active_windows' })}`,
          );
          return;
        }
        const nextIso = new Date(nextUtcMs).toISOString();
        await this.deferJob(followUpJobId, nextIso, 'outside_active_hours', { tenantTz });
        this.logger.log(
          `followUpDeferred ${JSON.stringify({
            tenantId,
            conversationId,
            followUpJobId,
            reason: 'outside_active_hours',
            tenantTz,
            nextEligibleAtIso: nextIso,
          })}`,
        );
        return;
      }
    }

    // Compose message
    const mode = String(step['mode'] ?? '').trim();
    let outboundText = '';
    let kbChunksReturned = 0;
    if (mode === 'fixed_message') {
      outboundText = String(step['fixedMessage'] ?? '').trim();
      if (!outboundText) {
        await this.markJobFailed(followUpJobId, 'missing_fixed_message');
        return;
      }
    } else if (mode === 'ai_decides') {
      const instr = String(step['aiInstruction'] ?? '').trim() || DEFAULT_AI_INSTRUCTION;
      const gen = await this.generateAiFollowUpText({
        tenantId,
        conversationId,
        instruction: instr,
      });
      outboundText = gen.text.trim();
      kbChunksReturned = gen.kbChunksReturned;
      if (!outboundText) {
        await this.markJobFailed(followUpJobId, 'ai_generation_empty');
        return;
      }
    } else {
      await this.markJobFailed(followUpJobId, `unknown_mode:${mode || 'empty'}`);
      return;
    }

    const noKbGuard = rewriteUnsupportedBusinessClaimsWhenNoKb({
      replyText: outboundText,
      kbChunksReturned,
      latestIntent: 'UNKNOWN',
    });
    if (noKbGuard.rewritten) {
      outboundText = noKbGuard.text;
    }

    // Send through existing outbound pipeline
    let replyPlan: ReplyDecision = {
      planStatus: 'PLANNED' as const,
      responseMode: 'standard' as const,
      handoverRecommended: false,
      confidence: 0.9,
      rationale: `follow_up_step_${stepNumber}`,
      bubbles: [{ index: 0, text: outboundText }],
      suggestedActions: [],
      draftProvenance: 'live_generation' as const,
    };

    this.logger.log(`followUpDue ${JSON.stringify({ tenantId, conversationId, followUpJobId, stepNumber, mode })}`);

    const govStarted = Date.now();
    replyPlan = await this.outboundSafetyGovernor.applyOutboundGovernor(replyPlan, {
      tenantId,
      conversationId,
      contactId,
    });
    this.logger.log(
      `followUpSafetyGovernorApplied ${JSON.stringify({
        tenantId,
        conversationId,
        followUpJobId,
        stepNumber,
        ms: Date.now() - govStarted,
      })}`,
    );

    const summary = await this.outboundSend.sendReply({
      tenantId,
      conversationId,
      contactId,
      replyPlan,
      ghlLocationId,
      sendBubbleJobId: `follow_up:${followUpJobId}`,
    });

    if (summary.succeeded > 0 && summary.failed === 0) {
      await this.supabase
        .from('conversation_follow_up_jobs')
        .update({
          status: 'SENT',
          decided_at: new Date().toISOString(),
          sent_at: new Date().toISOString(),
          decision_reason: 'sent',
          updated_at: new Date().toISOString(),
        })
        .eq('id', followUpJobId);
      this.logger.log(`followUpSent ${JSON.stringify({ tenantId, conversationId, followUpJobId, stepNumber })}`);
      return;
    }

    await this.markJobFailed(followUpJobId, 'ghl_send_failed', {
      succeeded: summary.succeeded,
      failed: summary.failed,
      bubbleResults: summary.bubbleResults,
    });
    this.logger.warn(`followUpFailed ${JSON.stringify({ tenantId, conversationId, followUpJobId, stepNumber, reason: 'ghl_send_failed' })}`);
  }

  // -------------------------
  // Helpers (DB + time)
  // -------------------------

  private computeDueAtIso(anchorIso: string, delayAmount: number, delayUnit: string): string {
    const base = Date.parse(anchorIso);
    if (!Number.isFinite(base)) throw new BadRequestException('Invalid sentAt');
    const n = Math.max(1, Math.floor(delayAmount));
    const u = delayUnit;
    const mul = u === 'minutes' ? 60_000 : u === 'hours' ? 3_600_000 : 86_400_000;
    return new Date(base + n * mul).toISOString();
  }

  private async bumpFollowUpScheduleVersion(conversationId: string, reason: string): Promise<number> {
    const { data, error } = await this.supabase.from('conversations').select('metadata').eq('id', conversationId).maybeSingle();
    if (error || !data) return 1;
    const prev = readConversationMetadataField(data.metadata);
    const cur = typeof prev['followUpScheduleVersion'] === 'number' && Number.isFinite(prev['followUpScheduleVersion']) ? Math.floor(prev['followUpScheduleVersion'] as number) : 0;
    const next = cur + 1;
    const incoming = {
      followUpScheduleVersion: next,
      followUpScheduleVersionUpdatedAt: new Date().toISOString(),
      followUpScheduleVersionReason: reason,
    };
    const merged = mergeConversationMetadataForPersist(prev, incoming);
    await this.supabase.from('conversations').update({ metadata: merged, updated_at: new Date().toISOString() }).eq('id', conversationId);
    return next;
  }

  private async getConversationFollowUpScheduleVersion(conversationId: string): Promise<number> {
    const { data } = await this.supabase.from('conversations').select('metadata').eq('id', conversationId).maybeSingle();
    const meta = data?.metadata;
    const o = meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
    const cur = typeof o['followUpScheduleVersion'] === 'number' && Number.isFinite(o['followUpScheduleVersion']) ? Math.floor(o['followUpScheduleVersion'] as number) : 0;
    return cur;
  }

  private detectOptOut(text: string): boolean {
    const t = text.trim().toLowerCase();
    if (!t) return false;
    return /\b(stop|unsubscribe|opt\s*out|do\s*not\s*contact|don't\s*contact|not\s*interested|leave\s*me\s*alone)\b/.test(t);
  }

  private async markConversationOptOut(conversationId: string, atIso: string, inboundText: string): Promise<void> {
    const { data } = await this.supabase.from('conversations').select('metadata').eq('id', conversationId).maybeSingle();
    const prev = readConversationMetadataField(data?.metadata);
    const incoming = {
      followUpOptOutAt: atIso,
      followUpOptOutText: inboundText.slice(0, 240),
    };
    const merged = mergeConversationMetadataForPersist(prev, incoming);
    await this.supabase.from('conversations').update({ metadata: merged, updated_at: new Date().toISOString() }).eq('id', conversationId);
  }

  private async isConversationOptedOut(conversationId: string): Promise<boolean> {
    const { data } = await this.supabase.from('conversations').select('metadata').eq('id', conversationId).maybeSingle();
    const meta = data?.metadata;
    const o = meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
    const v = o['followUpOptOutAt'];
    return typeof v === 'string' && v.trim().length > 0;
  }

  private async hasInboundAfter(conversationId: string, afterIso: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('messages')
      .select('id, created_at')
      .eq('conversation_id', conversationId)
      .eq('direction', 'INBOUND')
      .eq('sender', 'CONTACT')
      .gt('created_at', afterIso)
      .limit(1);
    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  }

  private isWithinActiveHours(windows: Record<string, { enabled: boolean; start: string; end: string }>, timeZone: string, at: Date): boolean {
    const key = weekdayKeyInZone(timeZone, at);
    const w = windows?.[key];
    if (!w?.enabled) return false;
    const start = hmToParts(String(w.start ?? ''));
    const end = hmToParts(String(w.end ?? ''));
    if (!start || !end) return false;
    const now = localWallClockParts(timeZone, at);
    return withinWindowLocalMinutes({ hour: now.hour, minute: now.minute }, start, end);
  }

  private computeNextActiveWindowUtcMs(
    windows: Record<string, { enabled: boolean; start: string; end: string }>,
    timeZone: string,
    at: Date,
  ): number | null {
    // Scan up to 8 days forward; pick earliest enabled day's start time.
    const baseLocal = localWallClockParts(timeZone, at);
    const baseUtcMidnight = wallClockInZoneToUtcMs(timeZone, baseLocal.y, baseLocal.m, baseLocal.d, 0, 0);
    for (let addDays = 0; addDays <= 8; addDays++) {
      const probeUtc = baseUtcMidnight + addDays * 86_400_000;
      const key = weekdayKeyInZone(timeZone, new Date(probeUtc));
      const w = windows?.[key];
      if (!w?.enabled) continue;
      const start = hmToParts(String(w.start ?? ''));
      if (!start) continue;
      const localProbe = localWallClockParts(timeZone, new Date(probeUtc));
      const utcMs = wallClockInZoneToUtcMs(timeZone, localProbe.y, localProbe.m, localProbe.d, start.hour, start.minute);
      if (utcMs > at.getTime() + 5_000) return utcMs;
    }
    return null;
  }

  private async deferJob(followUpJobId: string, nextDueAtIso: string, reason: string, meta?: Record<string, unknown>): Promise<void> {
    const delayMs = Math.max(0, Date.parse(nextDueAtIso) - Date.now());
    const bullJobId = toBullSafeFollowUpJobId(followUpJobId);
    try {
      const existing = await this.followUpQueue.getJob(bullJobId);
      if (existing) await existing.remove();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`followUpDeferRemoveExistingFailed ${JSON.stringify({ followUpJobId, bullJobId, err: msg })}`);
    }
    try {
      await this.followUpQueue.add(
        'follow-up',
        { kind: 'send_step', followUpJobId } satisfies FollowUpProcessorJob,
        {
          jobId: bullJobId,
          delay: delayMs,
          attempts: 2,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`followUpDeferEnqueueFailed ${JSON.stringify({ followUpJobId, err: msg })}`);
      throw e;
    }
    await this.supabase
      .from('conversation_follow_up_jobs')
      .update({
        due_at: nextDueAtIso,
        updated_at: new Date().toISOString(),
        last_defer_reason: reason,
        last_defer_meta: meta ?? {},
      })
      .eq('id', followUpJobId);
  }

  private async markJobSkipped(followUpJobId: string, reason: string, meta?: Record<string, unknown>): Promise<void> {
    await this.supabase
      .from('conversation_follow_up_jobs')
      .update({
        status: 'SKIPPED',
        decided_at: new Date().toISOString(),
        decision_reason: reason,
        decision_meta: meta ?? {},
        updated_at: new Date().toISOString(),
      })
      .eq('id', followUpJobId);
  }

  private async markJobFailed(followUpJobId: string, reason: string, meta?: Record<string, unknown>): Promise<void> {
    await this.supabase
      .from('conversation_follow_up_jobs')
      .update({
        status: 'FAILED',
        decided_at: new Date().toISOString(),
        decision_reason: reason,
        decision_meta: meta ?? {},
        updated_at: new Date().toISOString(),
      })
      .eq('id', followUpJobId);
  }

  private async generateAiFollowUpText(params: {
    tenantId: string;
    conversationId: string;
    instruction: string;
  }): Promise<{ text: string; kbChunksReturned: number }> {
    const { tenantId, conversationId, instruction } = params;
    // Load tenant/agency prompt context like BotTestService, but with real conversation memory.
    const { data: tenant } = await this.supabase.from('tenants').select('id, agency_id').eq('id', tenantId).single();
    const agencyId = tenant?.agency_id as string | undefined;
    if (!agencyId) return { text: '', kbChunksReturned: 0 };

    const { data: policyRows } = await this.supabase
      .from('agency_system_policies')
      .select('content, priority, created_at')
      .eq('agency_id', agencyId)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);
    const agencyPrompt = policyRows?.[0]?.content as string | undefined;

    const orch = await this.botProfiles.getActivePromptForOrchestration(tenantId);
    const tenantPrompt = orch?.systemPrompt;
    const modelOverride = orch?.modelOverride?.trim() ?? '';
    const subTemp = orch != null ? Number(orch.temperature) : NaN;
    const subMax = orch?.maxTokens ?? null;

    const systemPrompt = (() => {
      const a = agencyPrompt?.trim();
      const t = tenantPrompt?.trim();
      if (a && t) return `${a}\n\n---\n\nSubaccount bot instructions:\n${t}`;
      if (t) return t;
      if (a) return a;
      return 'You are a helpful AI assistant.';
    })();

    const memory = await this.loadConversationMemory(conversationId);

    const kbFilter = await this.botProfiles.getKbDocumentAllowlistForActiveProfile(tenantId);
    let documentIdAllowlist: string[] | null | undefined = undefined;
    if (kbFilter.kind === 'allowlist') documentIdAllowlist = kbFilter.documentIds;
    else if (kbFilter.kind === 'none') documentIdAllowlist = [];

    const kbResult = await this.kb.retrieve({
      tenantId,
      conversationId,
      query: 'follow up message',
      topK: 8,
      documentIdAllowlist,
    });
    const kbChunks: RetrievalChunk[] = kbResult.chunks;

    const cfg = await this.agencyAiConfig.getConfig(agencyId);
    const modelUsed = modelOverride || cfg?.activeModel || cfg?.defaultModel || 'gpt-4o-mini';

    const incomingMessage =
      `Write ONE short follow-up message to the customer.\n` +
      `Instruction: ${instruction}\n` +
      `Constraints: keep it friendly, concise, and do not mention internal systems.`;

    const gen = await this.generation.generateDraft({
      tenantId,
      incomingMessage,
      systemPrompt,
      memory,
      kbContext: kbChunks,
      tenantGenerationModelOverride: modelUsed,
      ...(Number.isFinite(subTemp) ? { temperature: subTemp } : {}),
      ...(subMax != null && subMax > 0 ? { maxTokens: subMax } : {}),
    });

    return {
      text: gen.content ? formatLiveCustomerDraftForPreview(gen.content) : '',
      kbChunksReturned: kbChunks.length,
    };
  }

  private async loadConversationMemory(conversationId: string): Promise<MemoryEntry[]> {
    const { data, error } = await this.supabase
      .from('messages')
      .select('direction, sender, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error || !data) return [];
    const rows = data as Array<{ direction: string; sender: string; content: string; created_at: string }>;
    const mapped = rows
      .slice()
      .reverse()
      .map((r) => {
        const isInbound = String(r.direction) === 'INBOUND' && String(r.sender) === 'CONTACT';
        return {
          role: isInbound ? ('user' as const) : ('assistant' as const),
          content: String(r.content ?? '').trim(),
          sender: isInbound ? ('CONTACT' as const) : ('AI' as const),
          timestamp: String(r.created_at ?? new Date().toISOString()),
          messageType: 'text' as const,
        };
      })
      .filter((m) => m.content.length > 0);
    // Keep last 12 turns max.
    return mapped.slice(-12);
  }
}

