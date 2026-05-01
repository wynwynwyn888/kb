import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { getSupabaseService } from '../../lib/supabase';
import { getBusinessLocalNow, resolveAppTimeZone } from '../../lib/business-time';
import { BOOKING_CORE_FIELD_KEYS, type BookingMode } from '../../lib/tenant-automation-constants';
import type { CoreFieldToggle } from '../../lib/tenant-automation-validation';
import type { CustomBookingFieldDto } from '../../lib/tenant-automation-validation';
import { BookingSettingsService } from '../booking-settings/booking-settings.service';
import { GhlService } from '../ghl/ghl.service';
import type { GhlFreeSlot } from '@aisbp/ghl-client';
import type { ReplyDecision } from '../reply-planning/dto';
import type { RoutingResponse } from '../orchestration/dto';
import {
  AISBP_BOOKING_METADATA_KEY,
  emptyBookingState,
  mergeBookingIntoConversationMetadata,
  parseAisbpBookingState,
  type AisbpBookingStateV1,
  type AisbpOfferedSlot,
} from './conversation-booking-state';
import {
  detectLiveBookingInterest,
  extractEmail,
  extractFirstVisit,
  extractNameGuess,
  extractPhone,
  extractPreferredTime,
  extractServiceGuess,
  matchOfferedByHm,
  parseSlotSelection,
  resolveRelativeDayPhrase,
} from './booking-intent-and-parse';

export type BookingFlowOrchestrationHookResult =
  | { handled: false }
  | {
      handled: true;
      persistMetadata: Record<string, unknown>;
      replyPlan: ReplyDecision;
      routing: RoutingResponse;
    };

const LIVE_MODES: BookingMode[] = ['CHECK_AVAILABILITY', 'BOOK_AFTER_CONFIRMATION'];

/** Inbound text present — any GHL channel label (SMS, WhatsApp, webchat, etc.). */
export function isBookingFlowSupportedInboundText(latestInboundText: string, combinedInboundText: string): boolean {
  return Boolean(latestInboundText?.trim() || combinedInboundText?.trim());
}

function stubRouting(): RoutingResponse {
  return {
    recommendedModel: 'n/a',
    responseMode: 'standard',
    draftReply: null,
    handoverRecommended: false,
    bookingIntentDetected: false,
    tagsSuggested: [],
    confidence: 1,
    reasoning: 'conversation_booking_flow',
  };
}

function plan(text: string, rationale: string, suggestedActions: ReplyDecision['suggestedActions'] = []): ReplyDecision {
  return {
    planStatus: 'PLANNED',
    responseMode: 'standard',
    handoverRecommended: false,
    confidence: 0.95,
    rationale,
    bubbles: [{ index: 0, text }],
    suggestedActions,
    draftProvenance: 'policy_reply',
  };
}

function slotEndIso(slot: GhlFreeSlot, fallbackMinutes: number): string {
  if (slot.endTime && slot.endTime.trim()) return slot.endTime.trim();
  const startMs = Date.parse(slot.startTime);
  if (!Number.isFinite(startMs)) return slot.startTime;
  return new Date(startMs + fallbackMinutes * 60 * 1000).toISOString();
}

function formatSlotLabel(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  try {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
  } catch {
    return d.toISOString().slice(11, 16);
  }
}

function pickTopSlots(
  slots: GhlFreeSlot[],
  preferredHm: string | undefined,
  max: number,
  slotDurationFallback: number,
): GhlFreeSlot[] {
  const uniq = new Map<string, GhlFreeSlot>();
  for (const s of slots) {
    if (!uniq.has(s.startTime)) uniq.set(s.startTime, s);
  }
  const list = [...uniq.values()];
  if (preferredHm) {
    const parts = preferredHm.split(':');
    const ph = parseInt(parts[0] ?? '', 10);
    const pm = parseInt(parts[1] ?? '0', 10);
    if (Number.isFinite(ph)) {
      const target = ph * 60 + (Number.isFinite(pm) ? pm : 0);
      list.sort((a, b) => {
        const da = new Date(a.startTime);
        const db = new Date(b.startTime);
        const ta = da.getHours() * 60 + da.getMinutes();
        const tb = db.getHours() * 60 + db.getMinutes();
        return Math.abs(ta - target) - Math.abs(tb - target);
      });
    } else {
      list.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
    }
  } else {
    list.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  }
  return list.slice(0, max);
}

@Injectable()
export class ConversationBookingFlowService {
  private readonly logger = new Logger(ConversationBookingFlowService.name);
  private readonly supabase = getSupabaseService();

  constructor(
    private readonly bookingSettings: BookingSettingsService,
    private readonly ghlService: GhlService,
  ) {}

  /**
   * Conversation-scoped live booking (GHL channel label is not authoritative — e.g. WhatsApp via a provider may appear as SMS).
   * Returns handled=true with a deterministic reply plan when this layer owns the turn; otherwise leaves orchestration to the AI path.
   */
  async maybeHandleConversationBookingTurn(params: {
    tenantId: string;
    conversationId: string;
    contactId: string;
    channel: string;
    combinedInboundText: string;
    latestInboundText: string;
    metadata: Record<string, unknown>;
    tenantDisplayName?: string;
    tenantTimeZone?: string;
  }): Promise<BookingFlowOrchestrationHookResult> {
    if (!isBookingFlowSupportedInboundText(params.latestInboundText, params.combinedInboundText)) {
      this.logger.log(
        `bookingFlowSkipped ${JSON.stringify({
          reason: 'no_inbound_text',
          channel: params.channel,
          conversationId: params.conversationId,
          tenantId: params.tenantId,
        })}`,
      );
      return { handled: false };
    }

    let settings;
    try {
      settings = await this.bookingSettings.getBookingSettings(params.tenantId);
    } catch (e) {
      this.logger.warn(`bookingFlowSkipped ${JSON.stringify({ reason: 'settings_load_failed' })}`);
      return { handled: false };
    }

    if (settings.enabled && settings.bookingMode === 'COLLECT_DETAILS_ONLY') {
      return { handled: false };
    }

    const eligible =
      settings.enabled &&
      Boolean(settings.defaultGhlCalendarId?.trim()) &&
      LIVE_MODES.includes(settings.bookingMode);

    const combined = params.combinedInboundText.trim();
    const latest = params.latestInboundText.trim();
    const tz = params.tenantTimeZone?.trim() || resolveAppTimeZone();
    const todayYmd = getBusinessLocalNow(tz).localIso.slice(0, 10);

    const prevMeta =
      params.metadata && typeof params.metadata === 'object' && !Array.isArray(params.metadata)
        ? { ...params.metadata }
        : {};
    let booking = parseAisbpBookingState(prevMeta);

    if (booking?.status === 'failed') {
      booking = {
        ...booking,
        status: 'collecting_details',
        offeredSlots: undefined,
        lastOfferedAt: undefined,
        selectedSlot: undefined,
        lastCreateError: undefined,
      };
    }

    const interest = detectLiveBookingInterest(combined);
    const activeSession =
      booking &&
      (booking.status === 'collecting_details' ||
        booking.status === 'offered_slots' ||
        booking.status === 'creating');

    if (!eligible) {
      if (interest) {
        this.logger.log(
          `bookingFlowStarted ${JSON.stringify({
            channel: params.channel,
            tenantId: params.tenantId,
            conversationId: params.conversationId,
            eligible: false,
          })}`,
        );
        return {
          handled: true,
          persistMetadata: prevMeta,
          replyPlan: plan(
            "Thanks for wanting to book with us. Live calendar booking isn't switched on for this conversation yet, so I've noted your interest — the team will follow up to help you secure a time.",
            'booking_not_enabled',
          ),
          routing: stubRouting(),
        };
      }
      return { handled: false };
    }

    if (!interest && !activeSession) {
      return { handled: false };
    }

    this.logger.log(
      `bookingFlowStarted ${JSON.stringify({
        channel: params.channel,
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        hasActiveSession: Boolean(activeSession),
      })}`,
    );

    if (!booking) {
      booking = {
        ...emptyBookingState(),
        calendarId: settings.defaultGhlCalendarId!.trim(),
        version: 1,
      };
    }
    booking = { ...booking, calendarId: settings.defaultGhlCalendarId!.trim() };

    if (booking.status === 'confirmed' && booking.appointmentId) {
      const ack = /^(thanks|thank\s+you|ok+|okay|great|perfect)\b/i.test(latest);
      if (ack || combined.length < 40) {
        this.logger.log(`bookingFlowSkipped ${JSON.stringify({ reason: 'already_confirmed_ack' })}`);
        const when = booking.selectedSlot?.displayText ?? 'your appointment';
        return {
          handled: true,
          persistMetadata: prevMeta,
          replyPlan: plan(
            `You're already confirmed for ${when}. If you need to change it, just say "reschedule" and the team will help.`,
            'booking_duplicate_ack',
          ),
          routing: stubRouting(),
        };
      }
    }

    this.applyFieldExtraction(booking, settings, combined, latest, todayYmd);

    this.logger.log(
      `bookingDetailsUpdated ${JSON.stringify({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        hasName: Boolean(booking.customerName),
        hasPhone: Boolean(booking.phone),
        hasEmail: Boolean(booking.email),
        hasService: Boolean(booking.service),
        hasPreferredDate: Boolean(booking.preferredDate),
        hasPreferredTime: Boolean(booking.preferredTime),
      })}`,
    );

    const missing = this.nextMissingAskField(settings, booking);
    if (missing) {
      const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, { ...booking, status: 'collecting_details' });
      return {
        handled: true,
        persistMetadata: nextMeta,
        replyPlan: plan(missing, 'booking_collect_field'),
        routing: stubRouting(),
      };
    }

    if (!booking.preferredDate) {
      const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, { ...booking, status: 'collecting_details' });
      return {
        handled: true,
        persistMetadata: nextMeta,
        replyPlan: plan('What date would you like to come in? (You can say today, tomorrow, or YYYY-MM-DD.)', 'booking_need_date'),
        routing: stubRouting(),
      };
    }

    if (booking.status === 'offered_slots' && booking.offeredSlots?.length) {
      const sel = parseSlotSelection(latest, booking.offeredSlots);
      let picked: AisbpOfferedSlot | undefined;
      if (sel.kind === 'option') {
        picked = booking.offeredSlots.find(o => o.option === sel.option);
      } else if (sel.kind === 'time') {
        const m = matchOfferedByHm(booking.offeredSlots, sel.normalizedHm);
        if (m) {
          picked = booking.offeredSlots.find(o => o.option === m.option);
        }
      }
      if (!picked) {
        const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, { ...booking });
        return {
          handled: true,
          persistMetadata: nextMeta,
          replyPlan: plan(
            `Please reply with 1, 2, or 3 to pick one of the listed times, or repeat the time exactly as shown.`,
            'booking_pick_slot',
          ),
          routing: stubRouting(),
        };
      }

      const dup = await this.hasRecentExecutedBooking(params.tenantId, params.conversationId, picked.startIso, picked.calendarId);
      if (dup) {
        this.logger.log(`bookingFlowSkipped ${JSON.stringify({ reason: 'duplicate_executed_intent' })}`);
        const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, {
          ...booking,
          status: 'confirmed',
          selectedSlot: picked,
        });
        return {
          handled: true,
          persistMetadata: nextMeta,
          replyPlan: plan(
            `That time is already booked for you in our system — you're all set for ${picked.displayText}.`,
            'booking_idempotent',
          ),
          routing: stubRouting(),
        };
      }

      this.logger.log(`bookingSlotSelected ${JSON.stringify({ tenantId: params.tenantId, option: picked.option })}`);

      const ymd = booking.preferredDate;
      const recheck = await this.bookingSettings.fetchFreeSlotsForAutomation(params.tenantId, {
        calendarId: picked.calendarId,
        selectedDate: ymd,
      });

      this.logger.log(
        `bookingSlotRechecked ${JSON.stringify({
          tenantId: params.tenantId,
          slotsReturned: recheck.slots.length,
          hasError: Boolean(recheck.error),
        })}`,
      );

      if (recheck.error || recheck.slots.length === 0) {
        const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, {
          ...booking,
          status: 'collecting_details',
          offeredSlots: undefined,
          lastOfferedAt: undefined,
          selectedSlot: undefined,
        });
        return {
          handled: true,
          persistMetadata: nextMeta,
          replyPlan: plan(
            "That slot may have just been taken. Let me pull fresh availability — one moment.\n\nI'm having trouble confirming that exact time against the live calendar. I'll pass your request to the team so they can lock it in for you.",
            'booking_recheck_failed',
          ),
          routing: stubRouting(),
        };
      }

      const stillThere = recheck.slots.some(s => s.startTime === picked.startIso || this.sameMinute(s.startTime, picked.startIso));
      if (!stillThere) {
        const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, {
          ...booking,
          status: 'collecting_details',
          offeredSlots: undefined,
          lastOfferedAt: undefined,
          selectedSlot: undefined,
        });
        return {
          handled: true,
          persistMetadata: nextMeta,
          replyPlan: plan(
            "That slot is no longer available. Tell me another date (or the same date) and I'll fetch fresh times.",
            'booking_slot_taken',
          ),
          routing: stubRouting(),
        };
      }

      this.logger.log(`bookingAppointmentCreateStarted ${JSON.stringify({ tenantId: params.tenantId, calendarId: picked.calendarId })}`);

      const { client, ghlLocationId } = await this.ghlService.createGhlClientForConnectedTenantWorkerOrThrow(params.tenantId);
      const endIso = picked.endIso || slotEndIso({ startTime: picked.startIso, endTime: picked.endIso } as GhlFreeSlot, booking.slotDurationMinutes ?? 30);
      const titleParts = [booking.service, booking.customerName].filter(Boolean);
      const title = titleParts.length ? titleParts.join(' — ') : 'Appointment';

      const bookRes = await client.bookSlot({
        locationId: ghlLocationId,
        calendarId: picked.calendarId,
        contactId: params.contactId,
        startTime: picked.startIso,
        endTime: endIso,
        title,
        timezone: recheck.crmTimezoneUsed,
        appointmentStatus: 'confirmed',
      });

      if (!bookRes.success || !bookRes.appointmentId) {
        this.logger.warn(
          `bookingAppointmentCreateFailed ${JSON.stringify({
            tenantId: params.tenantId,
            conversationId: params.conversationId,
            calendarId: picked.calendarId,
          })}`,
        );
        const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, {
          ...booking,
          status: 'failed',
          selectedSlot: picked,
          lastCreateError: bookRes.error ?? 'unknown',
        });
        return {
          handled: true,
          persistMetadata: nextMeta,
          replyPlan: plan(
            "That slot looked available, but I couldn't confirm it automatically. I'll pass this to the team to secure it for you.",
            'booking_create_failed',
          ),
          routing: stubRouting(),
        };
      }

      const intentSource = `CONVERSATION_BOOKING:${bookRes.appointmentId}`;
      const { error: insErr } = await this.supabase.from('action_intents').insert({
        id: randomUUID(),
        tenant_id: params.tenantId,
        conversation_id: params.conversationId,
        action_type: 'UPDATE_CALENDAR',
        source: intentSource,
        status: 'EXECUTED',
        params: {
          bookSlotIntent: true,
          calendarId: picked.calendarId,
          startTime: picked.startIso,
          endTime: endIso,
          contactId: params.contactId,
          appointmentId: bookRes.appointmentId,
        },
        reason: 'conversation_booking_confirmed',
        gating_note: 'sync_create',
        executed_at: new Date().toISOString(),
      });
      if (insErr) {
        this.logger.error(`booking intent insert failed: ${formatPostgrestError(insErr)}`);
      }

      this.logger.log(
        `bookingAppointmentCreated ${JSON.stringify({
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          appointmentId: bookRes.appointmentId,
          hasContactId: Boolean(params.contactId),
        })}`,
      );

      const biz = params.tenantDisplayName?.trim() || 'us';
      const confirmText =
        `Done — your appointment is confirmed for ${booking.preferredDate} at ${picked.displayText}.\n\nWe'll see you at ${biz}.`;

      const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, {
        ...booking,
        status: 'confirmed',
        selectedSlot: picked,
        appointmentId: bookRes.appointmentId,
        bookingConfirmedAt: new Date().toISOString(),
        offeredSlots: undefined,
        lastOfferedAt: undefined,
        lastCreateError: undefined,
      });

      return {
        handled: true,
        persistMetadata: nextMeta,
        replyPlan: plan(confirmText, 'booking_confirmed'),
        routing: stubRouting(),
      };
    }

    const slotFetch = await this.bookingSettings.fetchFreeSlotsForAutomation(params.tenantId, {
      calendarId: booking.calendarId,
      selectedDate: booking.preferredDate!,
      selectedTime: booking.preferredTime,
    });

    if (slotFetch.error) {
      this.logger.warn(`bookingSlotsFetched ${JSON.stringify({ tenantId: params.tenantId, error: true })}`);
      const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, { ...booking, status: 'collecting_details' });
      return {
        handled: true,
        persistMetadata: nextMeta,
        replyPlan: plan(
          "I'm having trouble checking the live calendar right now. I'll pass your request to the team so they can help confirm the slot.",
          'booking_slots_error',
        ),
        routing: stubRouting(),
      };
    }

    const top = pickTopSlots(
      slotFetch.slots,
      booking.preferredTime,
      3,
      booking.slotDurationMinutes ?? 30,
    );
    if (top.length === 0) {
      const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, { ...booking, status: 'collecting_details' });
      return {
        handled: true,
        persistMetadata: nextMeta,
        replyPlan: plan(
          "I couldn't find open slots for that date in the live calendar. Try another date, or the team can help find a time.",
          'booking_no_slots',
        ),
        routing: stubRouting(),
      };
    }

    const offered: AisbpOfferedSlot[] = top.map((s, i) => ({
      option: i + 1,
      startIso: s.startTime,
      endIso: slotEndIso(s, booking.slotDurationMinutes ?? 30),
      displayText: formatSlotLabel(s.startTime, slotFetch.crmTimezoneUsed),
      calendarId: booking.calendarId,
    }));

    this.logger.log(
      `bookingSlotsOffered ${JSON.stringify({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        count: offered.length,
        date: booking.preferredDate,
      })}`,
    );

    const lines = offered.map(o => `${o.option}. ${o.displayText}`).join('\n');
    const body = `I found these available slots for ${booking.preferredDate}:\n\n${lines}\n\nWhich one should I book for you?`;

    const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, {
      ...booking,
      status: 'offered_slots',
      offeredSlots: offered,
      lastOfferedAt: new Date().toISOString(),
    });

    return {
      handled: true,
      persistMetadata: nextMeta,
      replyPlan: plan(body, 'booking_slots_offered'),
      routing: stubRouting(),
    };
  }

  private sameMinute(a: string, b: string): boolean {
    const da = Date.parse(a);
    const db = Date.parse(b);
    if (!Number.isFinite(da) || !Number.isFinite(db)) return false;
    return Math.abs(da - db) < 90 * 1000;
  }

  private async hasRecentExecutedBooking(
    tenantId: string,
    conversationId: string,
    startIso: string,
    calendarId: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('action_intents')
      .select('id, params, executed_at')
      .eq('tenant_id', tenantId)
      .eq('conversation_id', conversationId)
      .eq('action_type', 'UPDATE_CALENDAR')
      .eq('status', 'EXECUTED')
      .contains('params', { bookSlotIntent: true })
      .order('executed_at', { ascending: false })
      .limit(8);

    if (error || !data?.length) return false;
    const cutoff = Date.now() - 48 * 3600 * 1000;
    for (const row of data) {
      const p = row.params as Record<string, unknown> | null;
      const ex = row.executed_at ? Date.parse(String(row.executed_at)) : 0;
      if (!Number.isFinite(ex) || ex < cutoff) continue;
      if (p?.['calendarId'] === calendarId && p?.['startTime'] === startIso) return true;
    }
    return false;
  }

  private applyFieldExtraction(
    booking: AisbpBookingStateV1,
    settings: {
      coreFieldsJson: Record<string, CoreFieldToggle>;
      customFieldsJson: CustomBookingFieldDto[];
    },
    combined: string,
    latest: string,
    todayYmd: string,
  ): void {
    const text = `${combined}\n${latest}`;
    if (!booking.service) {
      const g = extractServiceGuess(text);
      if (g) booking.service = g;
    }
    if (!booking.customerName) {
      const n = extractNameGuess(latest) || extractNameGuess(combined);
      if (n) booking.customerName = n;
    }
    if (!booking.phone) {
      const p = extractPhone(text);
      if (p) booking.phone = p;
    }
    if (!booking.email) {
      const e = extractEmail(text);
      if (e) booking.email = e;
    }
    if (!booking.preferredDate) {
      const d = resolveRelativeDayPhrase(text, todayYmd);
      if (d) booking.preferredDate = d;
    }
    if (!booking.preferredTime) {
      const t = extractPreferredTime(latest) || extractPreferredTime(combined);
      if (t) booking.preferredTime = t;
    }
    if (!booking.firstVisit) {
      const fv = extractFirstVisit(text);
      if (fv) booking.firstVisit = fv;
    }

    for (const cf of settings.customFieldsJson) {
      if (!cf.required) continue;
      if (!booking.customAnswers) booking.customAnswers = {};
      if (booking.customAnswers[cf.id]) continue;
      if (cf.fieldType === 'checkbox' || cf.fieldType === 'yes_no') {
        if (/\b(yes|yep|yeah|no|nope)\b/i.test(latest)) {
          booking.customAnswers[cf.id] = /\bno\b/i.test(latest) ? 'no' : 'yes';
        }
      }
    }
  }

  private readCore(booking: AisbpBookingStateV1, key: (typeof BOOKING_CORE_FIELD_KEYS)[number]): string | undefined {
    switch (key) {
      case 'name':
        return booking.customerName;
      case 'phone':
        return booking.phone;
      case 'email':
        return booking.email;
      case 'service':
        return booking.service;
      case 'preferred_date':
        return booking.preferredDate;
      case 'preferred_time':
        return booking.preferredTime;
      case 'first_visit':
        return booking.firstVisit;
      default:
        return undefined;
    }
  }

  private nextMissingAskField(
    settings: {
      coreFieldsJson: Record<string, CoreFieldToggle>;
      customFieldsJson: CustomBookingFieldDto[];
    },
    booking: AisbpBookingStateV1,
  ): string | null {
    for (const key of BOOKING_CORE_FIELD_KEYS) {
      const t = settings.coreFieldsJson[key];
      if (!t?.enabled) continue;
      if (key === 'preferred_time' && !t.required) continue;
      const v = this.readCore(booking, key);
      if (v && v.trim()) continue;
      return this.promptForCoreField(key, t.required);
    }
    for (const cf of settings.customFieldsJson) {
      if (!cf.required) continue;
      const ans = booking.customAnswers?.[cf.id];
      if (ans && ans.trim()) continue;
      return `Quick one: ${cf.label}?`;
    }
    return null;
  }

  private promptForCoreField(key: (typeof BOOKING_CORE_FIELD_KEYS)[number], required: boolean): string {
    const suffix = required ? '' : ' (optional)';
    switch (key) {
      case 'name':
        return `What name should I put on the booking?${suffix}`;
      case 'phone':
        return `What's the best phone number for your booking?${suffix}`;
      case 'email':
        return `What's your email address for the booking?${suffix}`;
      case 'service':
        return `What service would you like to book?${suffix}`;
      case 'preferred_date':
        return `What date works best for you?${suffix}`;
      case 'preferred_time':
        return `Do you have a preferred time of day? (If not, I'll suggest the earliest openings.)${suffix}`;
      case 'first_visit':
        return `Is this your first visit with us? (yes/no)${suffix}`;
      default:
        return `Could you share a bit more detail for your booking?${suffix}`;
    }
  }
}
