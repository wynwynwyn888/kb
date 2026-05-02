import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { getSupabaseService } from '../../lib/supabase';
import { getBusinessLocalNow, resolveAppTimeZone } from '../../lib/business-time';
import type { BookingCoreFieldKey } from '../../lib/tenant-automation-constants';
import { BOOKING_CORE_FIELD_KEYS, type BookingMode } from '../../lib/tenant-automation-constants';
import type { CoreFieldToggle } from '../../lib/tenant-automation-validation';
import type { CustomBookingFieldDto } from '../../lib/tenant-automation-validation';
import { BookingSettingsService } from '../booking-settings/booking-settings.service';
import { GhlService } from '../ghl/ghl.service';
import type { GhlFreeSlot } from '@aisbp/ghl-client';
import type { ReplyDecision } from '../reply-planning/dto';
import type { RoutingResponse } from '../orchestration/dto';
import {
  emptyBookingState,
  hasAisbpBookingFlowContinuation,
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
  extractServiceFromBookingMessage,
  extractServiceGuess,
  matchOfferedByHm,
  parseSlotSelection,
  resolveRelativeDayPhrase,
} from './booking-intent-and-parse';
import { applyPendingFieldAnswer, isOptionalSkipIntent } from './booking-pending-field';
import { buildAppointmentCreateNotes } from './booking-summary';
import { BookingPostConfirmService } from './booking-post-confirm.service';

/**
 * Live booking path map (single owner: this service):
 * - Booking detection: orchestration calls here when inbound text + tenant live booking enabled; `detectLiveBookingInterest` / active `aisbp_booking` session.
 * - Detail collection + slot offer + GHL create: all in `maybeHandleConversationBookingTurn`.
 * - `action_intents` EXECUTED row: written only after successful `client.bookSlot` (audit + OutboundSafetyGovernor).
 * - Confirmation wording guard: OutboundSafetyGovernorService + EXECUTED `bookSlotIntent` rows with trusted `source` prefixes (see outbound-safety-governor.ts).
 * - Deferred BOOK_SLOT execution: disabled by default in ActionIntentExecutorService (env AISBP_EXECUTE_DEFERRED_BOOK_SLOT); reply planner does not emit BOOK_SLOT.
 */

export type BookingFlowOrchestrationHookResult =
  | { handled: false }
  | {
      handled: true;
      persistMetadata: Record<string, unknown>;
      replyPlan: ReplyDecision;
      routing: RoutingResponse;
    };

const LIVE_MODES: BookingMode[] = ['CHECK_AVAILABILITY', 'BOOK_AFTER_CONFIRMATION'];

/** Ask order for live booking (service/date/time first; then contact fields). */
const CORE_ASK_PRIORITY: readonly BookingCoreFieldKey[] = [
  'service',
  'preferred_date',
  'preferred_time',
  'name',
  'phone',
  'email',
  'first_visit',
];

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

function fingerprintBookingQuestion(text: string): string {
  return createHash('sha256').update(text.trim().toLowerCase()).digest('hex').slice(0, 20);
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
    private readonly bookingPostConfirm: BookingPostConfirmService,
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
    /** GHL webhook / inbound job hints — prefill when present; never inferred from contactId alone. */
    contactSnapshot?: { displayName?: string; phone?: string; email?: string };
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
        lastError: undefined,
        lastCreateError: undefined,
      };
    }

    const interest = detectLiveBookingInterest(combined);
    const activeSession =
      booking &&
      (booking.status === 'collecting_details' ||
        booking.status === 'offered_slots' ||
        booking.status === 'creating');
    const bookingFlowContinuation = hasAisbpBookingFlowContinuation(prevMeta);

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

    if (!interest && !activeSession && !bookingFlowContinuation) {
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
        bookingMode: settings.bookingMode,
      };
    }
    booking = {
      ...booking,
      calendarId: settings.defaultGhlCalendarId!.trim(),
      bookingMode: settings.bookingMode,
    };

    this.applyContactSnapshot(booking, params.contactSnapshot);

    if (booking.status === 'confirmed') {
      const ack = /^(thanks|thank\s+you|ok+|okay|great|perfect|cheers)\b/i.test(latest);
      if (ack) {
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

    const snapshotBefore = this.snapshotBookingCore(booking);

    const pendingAns = applyPendingFieldAnswer({ booking, latest, todayYmd });
    if (pendingAns.answered) {
      const nextRequiredMissing = this.listRequiredMissingFieldIds(settings, booking);
      const nextOptionalPending = this.listOptionalAskPendingFieldIds(settings, booking);
      this.logger.log(
        `bookingPendingFieldAnswered ${JSON.stringify({
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          fieldId: pendingAns.fieldId,
          parsed: pendingAns.parsedValue === true,
          skipped: Boolean(pendingAns.skippedOptional),
          nextRequiredMissing,
          nextOptionalPending,
        })}`,
      );
    }

    this.applyRichFieldExtraction(booking, settings, combined, latest, todayYmd);

    const stuckClear = this.clearStuckOptionalPendingAsk({
      booking,
      latest,
      pendingAnswered: pendingAns.answered,
      settings,
    });
    if (stuckClear.clearedWithoutParse && stuckClear.fieldId) {
      const nextRequiredMissing = this.listRequiredMissingFieldIds(settings, booking);
      const nextOptionalPending = this.listOptionalAskPendingFieldIds(settings, booking);
      this.logger.log(
        `bookingPendingFieldAnswered ${JSON.stringify({
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          fieldId: stuckClear.fieldId,
          parsed: false,
          skipped: false,
          nextRequiredMissing,
          nextOptionalPending,
        })}`,
      );
    }

    if (
      booking.pendingFieldId &&
      booking.pendingFieldRequired &&
      latest.trim() &&
      isOptionalSkipIntent(latest)
    ) {
      const pid = booking.pendingFieldId;
      const outQ = this.requiredFieldSkipRefusalCopy(pid, settings);
      this.logger.log(
        `bookingNextStepSelected ${JSON.stringify({ step: 'required_skip_refused', fieldId: pid })}`,
      );
      const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, { ...booking, status: 'collecting_details' });
      return {
        handled: true,
        persistMetadata: nextMeta,
        replyPlan: plan(outQ, 'booking_required_not_skippable'),
        routing: stubRouting(),
      };
    }

    if (booking.status === 'offered_slots' && booking.offeredSlots?.length) {
      booking.pendingFieldId = undefined;
      booking.pendingFieldLabel = undefined;
      booking.pendingFieldRequired = undefined;
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

      const ymd = booking.preferredDate!.trim();
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
      const title = booking.service?.trim() || 'Appointment';
      const notes = buildAppointmentCreateNotes({
        bookingStatusLabel: 'Confirming',
        booking,
        coreFieldsJson: settings.coreFieldsJson,
        customFieldsJson: settings.customFieldsJson,
        conversationId: params.conversationId,
        calendarName: settings.defaultGhlCalendarName ?? undefined,
        appointmentOwner: undefined,
        contactPhoneFallback: params.contactSnapshot?.phone,
        selectedSlot: picked,
        crmTimeZone: recheck.crmTimezoneUsed,
      });
      const endIso = picked.endIso;

      const bookRes = await client.bookSlot({
        locationId: ghlLocationId,
        calendarId: picked.calendarId,
        contactId: params.contactId,
        startTime: picked.startIso,
        endTime: endIso,
        title,
        notes,
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
          lastError: bookRes.error ?? 'unknown',
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

      await this.bookingPostConfirm.runAfterLiveBookingConfirmed({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        customerContactId: params.contactId,
        appointmentId: bookRes.appointmentId,
        booking,
        settings,
        picked,
        crmTimeZone: recheck.crmTimezoneUsed,
        contactSnapshot: params.contactSnapshot,
      });

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
        lastError: undefined,
        pendingFieldId: undefined,
        pendingFieldLabel: undefined,
        pendingFieldRequired: undefined,
        lastAskedFieldId: undefined,
        lastAskedAt: undefined,
        lastQuestionFingerprint: undefined,
      });

      return {
        handled: true,
        persistMetadata: nextMeta,
        replyPlan: plan(confirmText, 'booking_confirmed'),
        routing: stubRouting(),
      };
    }

    const fieldChanged =
      pendingAns.answered || this.snapshotBookingCore(booking) !== snapshotBefore;

    const requiredMissing = this.listRequiredMissingFieldIds(settings, booking);
    const optionalPending = this.listOptionalAskPendingFieldIds(settings, booking);
    const askedFields = [...(booking.optionalAskedFieldIds ?? [])];
    const optionalSkipped = [...(booking.skippedFieldIds ?? [])];

    this.logger.log(
      `bookingDetailsUpdated ${JSON.stringify({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        pendingFieldId: booking.pendingFieldId ?? null,
        askedFields,
        requiredMissing,
        optionalPending,
        optionalSkipped,
        hasName: Boolean(booking.customerName),
        hasPhone: Boolean(booking.phone),
        hasEmail: Boolean(booking.email),
        hasService: Boolean(booking.service),
        hasPreferredDate: Boolean(booking.preferredDate),
        hasPreferredTime: Boolean(booking.preferredTime),
      })}`,
    );

    const nextAsk = this.selectNextAskFieldId(settings, booking);
    if (nextAsk) {
      const fieldRequired = this.isAskFieldRequired(settings, nextAsk);
      const baseQ = this.promptForMissingField(nextAsk, settings, !fieldRequired);
      const fpBase = fingerprintBookingQuestion(baseQ);
      const suppress = fieldRequired && !fieldChanged && this.shouldSuppressRepeatQuestion(booking, nextAsk, fpBase);
      const outQ = suppress ? this.clarifyRepeatedAsk(nextAsk) : baseQ;

      booking.pendingFieldId = nextAsk;
      booking.pendingFieldRequired = fieldRequired;
      booking.lastAskedFieldId = nextAsk;
      booking.lastAskedAt = new Date().toISOString();
      booking.lastQuestionFingerprint = fpBase;
      if (!fieldRequired) {
        booking.optionalAskedFieldIds = this.appendUniqueId(booking.optionalAskedFieldIds, nextAsk);
      }

      this.logger.log(
        `bookingNextStepSelected ${JSON.stringify({
          step: fieldRequired ? 'ask_required' : 'ask_optional',
          fieldId: nextAsk,
          suppressedDuplicate: suppress,
        })}`,
      );

      const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, { ...booking, status: 'collecting_details' });
      return {
        handled: true,
        persistMetadata: nextMeta,
        replyPlan: plan(outQ, suppress ? 'booking_ask_repeat_clarify' : 'booking_collect_field'),
        routing: stubRouting(),
      };
    }

    if (!booking.preferredDate?.trim()) {
      const baseQ =
        'What date should I check for available times? You can say a date like 21 May, or today / tomorrow.';
      const fpBase = fingerprintBookingQuestion(baseQ);
      const suppress = !fieldChanged && this.shouldSuppressRepeatQuestion(booking, 'preferred_date', fpBase);
      const outQ = suppress ? this.clarifyRepeatedAsk('preferred_date') : baseQ;
      booking.pendingFieldId = 'preferred_date';
      booking.pendingFieldRequired = true;
      booking.lastAskedFieldId = 'preferred_date';
      booking.lastAskedAt = new Date().toISOString();
      booking.lastQuestionFingerprint = fpBase;
      this.logger.log(
        `bookingNextStepSelected ${JSON.stringify({
          step: 'need_date_for_slots',
          suppressedDuplicate: suppress,
        })}`,
      );
      const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, { ...booking, status: 'collecting_details' });
      return {
        handled: true,
        persistMetadata: nextMeta,
        replyPlan: plan(outQ, suppress ? 'booking_ask_repeat_clarify' : 'booking_need_date'),
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

    this.logger.log(
      `bookingSlotsFetched ${JSON.stringify({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        slotCount: slotFetch.slots.length,
        hasError: Boolean(slotFetch.error),
      })}`,
    );

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
      pendingFieldId: undefined,
      pendingFieldLabel: undefined,
      pendingFieldRequired: undefined,
      lastAskedFieldId: undefined,
      lastAskedAt: undefined,
      lastQuestionFingerprint: undefined,
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

  private applyContactSnapshot(
    booking: AisbpBookingStateV1,
    hint?: { displayName?: string; phone?: string; email?: string },
  ): void {
    if (!hint) return;
    if (!booking.phone?.trim() && hint.phone?.trim()) {
      const parsed = extractPhone(hint.phone);
      const raw = hint.phone.replace(/\s+/g, ' ').trim();
      const v = (parsed ?? raw).trim();
      if (v.length >= 8 && /\d/.test(v)) booking.phone = v;
    }
    if (!booking.email?.trim() && hint.email?.trim()) {
      const e = extractEmail(hint.email) ?? (/^\S+@\S+\.\S+$/.test(hint.email.trim()) ? hint.email.trim() : undefined);
      if (e) booking.email = e;
    }
    if (!booking.customerName?.trim() && hint.displayName?.trim()) {
      const raw = hint.displayName.replace(/\s+/g, ' ').trim();
      if (raw.length >= 1 && raw.length <= 80 && !/^\d+$/.test(raw)) {
        booking.customerName = raw;
      }
    }
  }

  private snapshotBookingCore(booking: AisbpBookingStateV1): string {
    return JSON.stringify({
      n: booking.customerName ?? '',
      p: booking.phone ?? '',
      e: booking.email ?? '',
      s: booking.service ?? '',
      fd: booking.preferredDate ?? '',
      ft: booking.preferredTime ?? '',
      fv: booking.firstVisit ?? '',
      ca: booking.customAnswers ?? {},
      oa: booking.optionalAskedFieldIds ?? [],
      sk: booking.skippedFieldIds ?? [],
    });
  }

  private appendUniqueId(list: string[] | undefined, id: string): string[] {
    const cur = list ? [...list] : [];
    if (!cur.includes(id)) cur.push(id);
    return cur;
  }

  private isFieldSkipped(booking: AisbpBookingStateV1, fieldId: string): boolean {
    return (booking.skippedFieldIds ?? []).includes(fieldId);
  }

  private isOptionalAsked(booking: AisbpBookingStateV1, fieldId: string): boolean {
    return (booking.optionalAskedFieldIds ?? []).includes(fieldId);
  }

  private sortedCustomFields(customFieldsJson: CustomBookingFieldDto[]): CustomBookingFieldDto[] {
    return [...customFieldsJson].sort((a, b) => a.displayOrder - b.displayOrder);
  }

  private isAskFieldRequired(
    settings: { coreFieldsJson: Record<string, CoreFieldToggle>; customFieldsJson: CustomBookingFieldDto[] },
    fieldId: string,
  ): boolean {
    if (fieldId.startsWith('custom:')) {
      const id = fieldId.slice('custom:'.length);
      return settings.customFieldsJson.some(c => c.id === id && c.required);
    }
    const t = settings.coreFieldsJson[fieldId as BookingCoreFieldKey];
    return Boolean(t?.required);
  }

  private clearStuckOptionalPendingAsk(params: {
    booking: AisbpBookingStateV1;
    latest: string;
    pendingAnswered: boolean;
    settings: { coreFieldsJson: Record<string, CoreFieldToggle>; customFieldsJson: CustomBookingFieldDto[] };
  }): { clearedWithoutParse: boolean; fieldId?: string } {
    const { booking, latest, pendingAnswered, settings } = params;
    if (pendingAnswered) return { clearedWithoutParse: false };
    const pid = booking.pendingFieldId?.trim();
    if (!pid || !latest.trim()) return { clearedWithoutParse: false };
    if (this.isAskFieldRequired(settings, pid)) return { clearedWithoutParse: false };

    const asked = this.isOptionalAsked(booking, pid);
    const lastAskedAtMs = booking.lastAskedAt ? Date.parse(booking.lastAskedAt) : NaN;
    const recentLastAsk =
      booking.lastAskedFieldId === pid &&
      Number.isFinite(lastAskedAtMs) &&
      Date.now() - lastAskedAtMs < 30 * 60 * 1000;

    if (!asked && !recentLastAsk) return { clearedWithoutParse: false };

    if (!asked && recentLastAsk) {
      booking.optionalAskedFieldIds = this.appendUniqueId(booking.optionalAskedFieldIds, pid);
    }
    booking.pendingFieldId = undefined;
    booking.pendingFieldLabel = undefined;
    booking.pendingFieldRequired = undefined;
    return { clearedWithoutParse: true, fieldId: pid };
  }

  private listRequiredMissingFieldIds(
    settings: { coreFieldsJson: Record<string, CoreFieldToggle>; customFieldsJson: CustomBookingFieldDto[] },
    booking: AisbpBookingStateV1,
  ): string[] {
    const out: string[] = [];
    for (const key of CORE_ASK_PRIORITY) {
      const t = settings.coreFieldsJson[key];
      if (!t?.enabled || !t.required) continue;
      const v = this.readCore(booking, key);
      if (v?.trim()) continue;
      out.push(key);
    }
    for (const cf of this.sortedCustomFields(settings.customFieldsJson)) {
      if (!cf.required) continue;
      const ans = booking.customAnswers?.[cf.id];
      if (ans?.trim()) continue;
      out.push(`custom:${cf.id}`);
    }
    return out;
  }

  private listOptionalAskPendingFieldIds(
    settings: { coreFieldsJson: Record<string, CoreFieldToggle>; customFieldsJson: CustomBookingFieldDto[] },
    booking: AisbpBookingStateV1,
  ): string[] {
    const out: string[] = [];
    for (const key of CORE_ASK_PRIORITY) {
      const t = settings.coreFieldsJson[key];
      if (!t?.enabled || t.required) continue;
      const v = this.readCore(booking, key);
      if (v?.trim()) continue;
      if (this.isFieldSkipped(booking, key)) continue;
      if (this.isOptionalAsked(booking, key)) continue;
      out.push(key);
    }
    for (const cf of this.sortedCustomFields(settings.customFieldsJson)) {
      if (cf.required) continue;
      const id = `custom:${cf.id}`;
      const ans = booking.customAnswers?.[cf.id];
      if (ans?.trim()) continue;
      if (this.isFieldSkipped(booking, id)) continue;
      if (this.isOptionalAsked(booking, id)) continue;
      out.push(id);
    }
    return out;
  }

  private selectNextAskFieldId(
    settings: { coreFieldsJson: Record<string, CoreFieldToggle>; customFieldsJson: CustomBookingFieldDto[] },
    booking: AisbpBookingStateV1,
  ): string | null {
    for (const key of CORE_ASK_PRIORITY) {
      const t = settings.coreFieldsJson[key];
      if (!t?.enabled) continue;
      if (!t.required) continue;
      const v = this.readCore(booking, key);
      if (v?.trim()) continue;
      return key;
    }
    for (const cf of this.sortedCustomFields(settings.customFieldsJson)) {
      if (!cf.required) continue;
      const id = `custom:${cf.id}`;
      const ans = booking.customAnswers?.[cf.id];
      if (ans?.trim()) continue;
      return id;
    }

    for (const key of CORE_ASK_PRIORITY) {
      const t = settings.coreFieldsJson[key];
      if (!t?.enabled || t.required) continue;
      const v = this.readCore(booking, key);
      if (v?.trim()) continue;
      if (this.isFieldSkipped(booking, key)) continue;
      if (this.isOptionalAsked(booking, key)) continue;
      return key;
    }
    for (const cf of this.sortedCustomFields(settings.customFieldsJson)) {
      if (cf.required) continue;
      const id = `custom:${cf.id}`;
      const ans = booking.customAnswers?.[cf.id];
      if (ans?.trim()) continue;
      if (this.isFieldSkipped(booking, id)) continue;
      if (this.isOptionalAsked(booking, id)) continue;
      return id;
    }
    return null;
  }

  private requiredFieldSkipRefusalCopy(
    fieldId: string,
    settings: { coreFieldsJson: Record<string, CoreFieldToggle>; customFieldsJson: CustomBookingFieldDto[] },
  ): string {
    if (fieldId.startsWith('custom:')) {
      const id = fieldId.slice('custom:'.length);
      const cf = settings.customFieldsJson.find(c => c.id === id);
      return cf
        ? `I need an answer for "${cf.label}" to complete the booking — it can't be skipped.`
        : "I need that detail to complete the booking — it can't be skipped.";
    }
    switch (fieldId as BookingCoreFieldKey) {
      case 'name':
        return "Can I have your name for the booking? This one can't be skipped — a first name is fine.";
      case 'phone':
        return 'I need a phone number we can use for the booking — please share your best number (with country code if outside your country).';
      case 'email':
        return 'I need an email address for the booking — please send a valid one (like name@example.com).';
      case 'service':
        return 'Which service would you like? I need that to continue — for example colour, haircut, or treatment.';
      case 'preferred_date':
        return 'Which day would you like? Please share a date (for example 21 May, or today / tomorrow).';
      case 'preferred_time':
        return 'What time of day works best? Please share morning, afternoon, or a specific time.';
      case 'first_visit':
        return 'Is this your first visit with us? Please answer yes or no — I need that for the booking.';
      default:
        return "I still need that detail to complete the booking — it can't be skipped.";
    }
  }

  private shouldSuppressRepeatQuestion(
    booking: AisbpBookingStateV1,
    nextFieldId: string,
    canonicalQuestionFp: string,
  ): boolean {
    if (!booking.lastAskedAt || !booking.lastQuestionFingerprint || !booking.lastAskedFieldId) return false;
    if (booking.lastAskedFieldId !== nextFieldId) return false;
    if (booking.lastQuestionFingerprint !== canonicalQuestionFp) return false;
    const ageMs = Date.now() - Date.parse(booking.lastAskedAt);
    if (!Number.isFinite(ageMs) || ageMs > 120_000) return false;
    return true;
  }

  private clarifyRepeatedAsk(fieldId: string): string {
    switch (fieldId) {
      case 'phone':
        return 'I still need a mobile number with digits (for example +61 400 000 000) so we can confirm your booking.';
      case 'email':
        return 'Could you send a valid email address (something like name@example.com)?';
      case 'preferred_date':
        return 'Which day works for you? You can say a date like 21 May, or today / tomorrow.';
      case 'name':
        return 'Thanks — what name should I use on the booking? A first name is fine.';
      case 'service':
        return 'What service would you like — for example colour, haircut, or treatment?';
      case 'preferred_time':
        return 'Do you prefer morning, afternoon, or a specific time (like 2:30pm)?';
      case 'first_visit':
        return 'Is this your first visit with us? A quick yes or no is perfect.';
      default:
        if (fieldId.startsWith('custom:')) {
          return "I've got that — could you answer the previous question one more time?";
        }
        return "I've got that. Let me check available slots now.";
    }
  }

  private promptForMissingField(
    fieldId: string,
    settings: { coreFieldsJson: Record<string, CoreFieldToggle>; customFieldsJson: CustomBookingFieldDto[] },
    optionalAllowSkipHint: boolean,
  ): string {
    const suffix = optionalAllowSkipHint ? ' You can skip this if you prefer.' : '';
    if (fieldId.startsWith('custom:')) {
      const id = fieldId.slice('custom:'.length);
      const cf = settings.customFieldsJson.find(c => c.id === id);
      return (cf ? `Quick one: ${cf.label}?` : 'Could you share a bit more detail for your booking?') + suffix;
    }
    const key = fieldId as BookingCoreFieldKey;
    let base: string;
    switch (key) {
      case 'name':
        base = 'Can I have your name for the booking?';
        break;
      case 'phone':
        base = 'Can I have the best phone number for the booking?';
        break;
      case 'email':
        base = 'What email should we use for your booking?';
        break;
      case 'service':
        base = 'Sure — what service would you like to book?';
        break;
      case 'preferred_date':
        base = 'What date works best for you?';
        break;
      case 'preferred_time':
        base = 'Do you prefer morning, afternoon, or a specific time?';
        break;
      case 'first_visit':
        base = 'Is this your first visit with us?';
        break;
      default:
        base = 'Could you share a bit more detail for your booking?';
    }
    return base + suffix;
  }

  private applyRichFieldExtraction(
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
      const g =
        extractServiceFromBookingMessage(combined) ||
        extractServiceFromBookingMessage(latest) ||
        extractServiceFromBookingMessage(text) ||
        extractServiceGuess(text);
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
      const t = extractPreferredTime(latest) || extractPreferredTime(combined) || extractPreferredTime(text);
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
}
