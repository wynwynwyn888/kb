import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { formatPostgrestError } from '../../lib/format-postgrest-error';
import { getSupabaseService } from '../../lib/supabase';
import { getBusinessLocalNow, resolveAppTimeZone } from '../../lib/business-time';
import type { BookingCoreFieldKey } from '../../lib/tenant-automation-constants';
import { BOOKING_CORE_FIELD_KEYS, type BookingMode } from '../../lib/tenant-automation-constants';
import type { CoreFieldToggle } from '../../lib/tenant-automation-validation';
import type { CustomBookingFieldDto } from '../../lib/tenant-automation-validation';
import { BookingSettingsService, type TenantBookingSettingsDto } from '../booking-settings/booking-settings.service';
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
  extractPreferredTimeWindow,
  normalizedHmToMinutes,
  parseFirstVisitNaturalReply,
  parseSlotSelectionOrTimeRevision,
  rankSlotsForBookingOffer,
  resolveBookingCalendarDay,
  resolveRelativeDayPhrase,
  slotStartLocalMinutes,
  stripBookingFrustrationForParse,
} from './booking-intent-and-parse';
import {
  customSelectAnswerIsWholeOptionList,
  isAcceptedBookingServiceValue,
  resolveServiceFromBookingIntake,
} from './booking-service-intake';
import { applyPendingFieldAnswer, isOptionalSkipIntent } from './booking-pending-field';
import { buildAppointmentCreateNotes } from './booking-summary';
import { BookingPostConfirmService } from './booking-post-confirm.service';
import { maskPhoneForLog } from './booking-contact-enrichment';
import {
  copyAskBookingName,
  copyAskBookingPhone,
  copyAskEmail,
  copyAskFirstVisit,
  copyAskPreferredDate,
  copyAskPreferredTime,
  copyAskService,
  copyBookingConfirmed,
  copyClarifyCustomField,
  copyClarifyEmail,
  copyClarifyFirstVisit,
  copyClarifyName,
  copyClarifyPhone,
  copyClarifyPreferredDate,
  copyClarifyPreferredTime,
  copyClarifyService,
  copyClosestSlotsWhenPreferredUnavailable,
  copyFrustrationRecoveryContinue,
  copyFrustrationRecoveryWithWindow,
  copyNoSlotsInWindow,
  copyPickSlotHelpSofter,
  copyRequiredFieldCannotSkip,
  copyRequiredFieldPoliteFinal,
  copySingleExactTimeAvailable,
  copySlotsAroundRequestedTime,
  copySlotsOfferedWithHumanDate,
  formatCustomFieldBookingQuestion,
  formatHumanDateFromYmd,
  formatPreferredHmForDisplay,
  formatServiceAskWithOptionalMenu,
  timeWindowDisplayLabel,
} from './booking-conversation-copy';

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
    /** True when contact snapshot fields used alternate GHL webhook keys (see NormalizedWebhookPayload). */
    contactFieldsFromExtendedWebhook?: boolean;
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
        offeredSlotsCrmTimeZone: undefined,
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

    const hadFrustration =
      stripBookingFrustrationForParse(latest).hadFrustration || stripBookingFrustrationForParse(combined).hadFrustration;

    const pendingCustomId = booking.pendingFieldId?.startsWith('custom:')
      ? booking.pendingFieldId.slice('custom:'.length)
      : undefined;
    const pendingCf = pendingCustomId
      ? settings.customFieldsJson.find(c => c.id === pendingCustomId)
      : undefined;

    const pendingAns = applyPendingFieldAnswer({
      booking,
      latest,
      combinedHint: combined,
      todayYmd,
      customFieldDef: pendingCf,
      serviceMenuOptions: settings.serviceMenuOptions,
    });
    if (pendingAns.answered) {
      booking.pendingParseFailureCount = 0;
      booking.sameFieldPromptCount = 0;
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
      if (pendingAns.fieldId === 'first_visit') {
        const fvRaw = booking.firstVisit?.trim().toLowerCase() ?? '';
        let value: 'yes' | 'no' | null = null;
        if (pendingAns.parsedValue === true) {
          if (fvRaw === 'yes' || fvRaw === 'y' || fvRaw === 'yeah' || fvRaw === 'yup' || fvRaw === 'yep') value = 'yes';
          else if (fvRaw === 'no' || fvRaw === 'n' || fvRaw === 'nope' || fvRaw === 'nah') value = 'no';
        }
        this.logger.log(
          `bookingFirstVisitParsed ${JSON.stringify({
            parsed: pendingAns.parsedValue === true,
            value,
          })}`,
        );
      }
    }

    if (booking.pendingFieldId && !pendingAns.answered && latest.trim()) {
      booking.pendingParseFailureCount = (booking.pendingParseFailureCount ?? 0) + 1;
    }

    this.applyRichFieldExtraction(booking, settings, combined, latest, todayYmd);
    this.sanitizeBookingIntake(booking, settings);

    const pidAuto = booking.pendingFieldId?.trim();
    if (
      pidAuto?.startsWith('custom:') &&
      !this.isAskFieldRequired(settings, pidAuto) &&
      (booking.pendingParseFailureCount ?? 0) >= 2
    ) {
      booking.skippedFieldIds = this.appendUniqueId(booking.skippedFieldIds, pidAuto);
      booking.optionalAskedFieldIds = this.appendUniqueId(booking.optionalAskedFieldIds, pidAuto);
      booking.pendingFieldId = undefined;
      booking.pendingFieldLabel = undefined;
      booking.pendingFieldRequired = undefined;
      booking.pendingParseFailureCount = 0;
    }

    let frustrationRecoveryPrefix: string | undefined;
    if (pendingAns.answered && hadFrustration) {
      if (
        pendingAns.fieldId === 'preferred_date' &&
        booking.preferredTimeWindow &&
        booking.preferredTimeWindow !== 'exact' &&
        booking.preferredDate?.trim()
      ) {
        frustrationRecoveryPrefix = copyFrustrationRecoveryWithWindow(
          formatHumanDateFromYmd(booking.preferredDate.trim()),
          timeWindowDisplayLabel(booking.preferredTimeWindow),
        );
      } else if (pendingAns.fieldId === 'preferred_time' && booking.preferredTimeWindow && booking.preferredDate?.trim()) {
        frustrationRecoveryPrefix = copyFrustrationRecoveryWithWindow(
          formatHumanDateFromYmd(booking.preferredDate.trim()),
          timeWindowDisplayLabel(booking.preferredTimeWindow),
        );
      } else if (hadFrustration) {
        frustrationRecoveryPrefix = copyFrustrationRecoveryContinue();
      }
    }

    const withTone = (msg: string) => (frustrationRecoveryPrefix ? `${frustrationRecoveryPrefix}\n\n${msg}` : msg);

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
        replyPlan: plan(withTone(outQ), 'booking_required_not_skippable'),
        routing: stubRouting(),
      };
    }

    if (booking.status === 'offered_slots' && booking.offeredSlots?.length) {
      booking.pendingFieldId = undefined;
      booking.pendingFieldLabel = undefined;
      booking.pendingFieldRequired = undefined;

      let crmTzForPick = booking.offeredSlotsCrmTimeZone?.trim();
      if (!crmTzForPick) {
        const tzPeek = await this.bookingSettings.fetchFreeSlotsForAutomation(params.tenantId, {
          calendarId: booking.calendarId,
          selectedDate: booking.preferredDate!,
          selectedTime: booking.preferredTime,
        });
        crmTzForPick = tzPeek.crmTimezoneUsed?.trim() || 'UTC';
      }

      const rev = parseSlotSelectionOrTimeRevision(
        latest,
        combined,
        booking.offeredSlots,
        crmTzForPick,
        booking.preferredDate!,
        todayYmd,
      );

      if (rev.kind === 'time_revision' || rev.kind === 'time_window_revision' || rev.kind === 'date_time_revision') {
        if (rev.kind === 'time_revision') {
          booking.preferredTime = rev.preferredTime;
          booking.preferredTimeWindow = undefined;
        } else if (rev.kind === 'time_window_revision') {
          booking.preferredTimeWindow = rev.preferredTimeWindow;
          booking.preferredTime = undefined;
        } else {
          booking.preferredDate = rev.preferredDate;
          if (rev.preferredTime) {
            booking.preferredTime = rev.preferredTime;
            booking.preferredTimeWindow = undefined;
          } else if (rev.preferredTimeWindow) {
            booking.preferredTimeWindow = rev.preferredTimeWindow;
            booking.preferredTime = undefined;
          }
        }
        booking.offeredSlots = undefined;
        booking.lastOfferedAt = undefined;
        booking.offeredSlotsCrmTimeZone = undefined;

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

        const crmTz2 = slotFetch.crmTimezoneUsed?.trim() || crmTzForPick;
        const win = booking.preferredTimeWindow;
        const { ranked: top, usedWindowFallback } = rankSlotsForBookingOffer(slotFetch.slots, {
          preferredHm: booking.preferredTime,
          preferredWindow: win && win !== 'exact' ? win : undefined,
          crmTimeZone: crmTz2,
          max: 3,
        });

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
            reason: 'time_preference_revision',
          })}`,
        );

        const humanDate = formatHumanDateFromYmd(booking.preferredDate!.trim());
        const displayLines = offered.map(o => o.displayText);
        const prefHm = booking.preferredTime?.trim();
        const hasExactInFull =
          Boolean(prefHm) &&
          slotFetch.slots.some(s => {
            const sm = slotStartLocalMinutes(s.startTime, crmTz2);
            const tm = normalizedHmToMinutes(prefHm!);
            return sm !== undefined && tm !== undefined && sm === tm;
          });

        let body: string;
        if (prefHm && hasExactInFull && top.length === 1) {
          body = copySingleExactTimeAvailable(humanDate, displayLines[0]!);
        } else if (prefHm && hasExactInFull && top.length > 1) {
          body = copySlotsAroundRequestedTime(humanDate, formatPreferredHmForDisplay(prefHm), displayLines);
        } else if (prefHm && !hasExactInFull && top.length > 0) {
          body = copyClosestSlotsWhenPreferredUnavailable(humanDate, formatPreferredHmForDisplay(prefHm), displayLines);
        } else if (usedWindowFallback && win && win !== 'exact') {
          body = copyNoSlotsInWindow(humanDate, timeWindowDisplayLabel(win), displayLines);
        } else {
          body = copySlotsOfferedWithHumanDate(humanDate, displayLines);
        }

        const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, {
          ...booking,
          status: 'offered_slots',
          offeredSlots: offered,
          offeredSlotsCrmTimeZone: crmTz2,
          lastOfferedAt: new Date().toISOString(),
          pendingFieldId: undefined,
          pendingFieldLabel: undefined,
          pendingFieldRequired: undefined,
          lastAskedFieldId: undefined,
          lastAskedAt: undefined,
          lastQuestionFingerprint: undefined,
          sameFieldPromptCount: undefined,
          pendingParseFailureCount: undefined,
        });

        return {
          handled: true,
          persistMetadata: nextMeta,
          replyPlan: plan(withTone(body), 'booking_slots_offered'),
          routing: stubRouting(),
        };
      }

      if (rev.kind !== 'selected_slot') {
        const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, { ...booking });
        return {
          handled: true,
          persistMetadata: nextMeta,
          replyPlan: plan(withTone(copyPickSlotHelpSofter()), 'booking_pick_slot'),
          routing: stubRouting(),
        };
      }

      const picked =
        booking.offeredSlots.find(o => o.option === rev.slot.option && o.startIso === rev.slot.startIso) ??
        booking.offeredSlots.find(o => o.option === rev.slot.option) ??
        (rev.slot as AisbpOfferedSlot);

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
          offeredSlotsCrmTimeZone: undefined,
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
          offeredSlotsCrmTimeZone: undefined,
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

      this.sanitizeBookingIntake(booking, settings);
      const missingBeforeCreate = this.listRequiredMissingFieldIds(settings, booking);
      if (missingBeforeCreate.length > 0) {
        const first = missingBeforeCreate[0]!;
        const fieldRequired = this.isAskFieldRequired(settings, first);
        booking.pendingFieldId = first;
        booking.pendingFieldRequired = fieldRequired;
        booking.lastAskedFieldId = first;
        booking.lastAskedAt = new Date().toISOString();
        booking.lastQuestionFingerprint = undefined;
        booking.sameFieldPromptCount = 0;
        const baseQ = this.promptForMissingField(first, settings, !fieldRequired);
        const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, {
          ...booking,
          status: 'collecting_details',
          offeredSlots: undefined,
          offeredSlotsCrmTimeZone: undefined,
          lastOfferedAt: undefined,
          selectedSlot: undefined,
        });
        return {
          handled: true,
          persistMetadata: nextMeta,
          replyPlan: plan(withTone(baseQ), 'booking_required_before_confirm'),
          routing: stubRouting(),
        };
      }

      this.logger.log(`bookingAppointmentCreateStarted ${JSON.stringify({ tenantId: params.tenantId, calendarId: picked.calendarId })}`);

      const { client, ghlLocationId } = await this.ghlService.createGhlClientForConnectedTenantWorkerOrThrow(params.tenantId);
      const resolvedConversationContact = await this.resolveStaffContactSnapshotForAlert({
        tenantId: params.tenantId,
        contactId: params.contactId,
        hint: params.contactSnapshot,
        inboundContactFromExtendedWebhook: params.contactFieldsFromExtendedWebhook === true,
      });
      this.logger.log(
        `bookingConversationContactSnapshotResolved ${JSON.stringify({
          source: resolvedConversationContact.source,
          hasName: Boolean(resolvedConversationContact.displayName?.trim()),
          hasPhone: Boolean(resolvedConversationContact.phone?.trim()),
          hasContactId: Boolean(params.contactId?.trim()),
          phoneLogged: resolvedConversationContact.phone?.trim()
            ? maskPhoneForLog(resolvedConversationContact.phone.trim())
            : undefined,
        })}`,
      );

      const title = booking.service?.trim() || 'Appointment';
      const notes = buildAppointmentCreateNotes({
        bookingStatusLabel: 'Confirming',
        booking,
        coreFieldsJson: settings.coreFieldsJson,
        customFieldsJson: settings.customFieldsJson,
        serviceMenuOptions: settings.serviceMenuOptions,
        conversationContactSnapshot: {
          displayName: resolvedConversationContact.displayName,
          phone: resolvedConversationContact.phone,
        },
        calendarName: settings.defaultGhlCalendarName ?? undefined,
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
        contactSnapshot: {
          displayName: resolvedConversationContact.displayName,
          phone: resolvedConversationContact.phone,
          email: resolvedConversationContact.email,
        },
      });

      const biz = params.tenantDisplayName?.trim() || 'us';
      const calLabel = settings.defaultGhlCalendarName?.trim() || biz;
      const confirmText = copyBookingConfirmed(
        formatHumanDateFromYmd(booking.preferredDate!.trim()),
        picked.displayText,
        calLabel,
      );

      const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, {
        ...booking,
        status: 'confirmed',
        selectedSlot: picked,
        appointmentId: bookRes.appointmentId,
        bookingConfirmedAt: new Date().toISOString(),
        offeredSlots: undefined,
        offeredSlotsCrmTimeZone: undefined,
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
        replyPlan: plan(withTone(confirmText), 'booking_confirmed'),
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
        hasPreferredTime: Boolean(booking.preferredTime?.trim() || booking.preferredTimeWindow),
      })}`,
    );

    const nextAsk = this.selectNextAskFieldId(settings, booking);
    if (nextAsk) {
      const fieldRequired = this.isAskFieldRequired(settings, nextAsk);
      const baseQ = this.promptForMissingField(nextAsk, settings, !fieldRequired);
      const fpBase = fingerprintBookingQuestion(baseQ);
      const suppress = !fieldChanged && this.shouldSuppressRepeatQuestion(booking, nextAsk, fpBase);
      if (suppress) {
        booking.sameFieldPromptCount = (booking.sameFieldPromptCount ?? 0) + 1;
      } else {
        booking.sameFieldPromptCount = 0;
      }
      const sc = booking.sameFieldPromptCount ?? 0;
      const finalRequired = suppress && fieldRequired && sc >= 2;
      let outQ: string;
      if (finalRequired) {
        if (nextAsk.startsWith('custom:')) {
          const cid = nextAsk.slice('custom:'.length);
          const cf = settings.customFieldsJson.find(c => c.id === cid);
          outQ = copyRequiredFieldPoliteFinal(cf?.label);
        } else {
          outQ = copyRequiredFieldPoliteFinal();
        }
      } else if (suppress) {
        outQ = this.clarifyRepeatedAsk(nextAsk, settings);
      } else {
        outQ = baseQ;
      }

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
        replyPlan: plan(withTone(outQ), suppress ? 'booking_ask_repeat_clarify' : 'booking_collect_field'),
        routing: stubRouting(),
      };
    }

    if (!booking.preferredDate?.trim()) {
      const baseQ = copyAskPreferredDate();
      const fpBase = fingerprintBookingQuestion(baseQ);
      const suppress = !fieldChanged && this.shouldSuppressRepeatQuestion(booking, 'preferred_date', fpBase);
      if (suppress) {
        booking.sameFieldPromptCount = (booking.sameFieldPromptCount ?? 0) + 1;
      } else {
        booking.sameFieldPromptCount = 0;
      }
      const sc = booking.sameFieldPromptCount ?? 0;
      const outQ = suppress && sc >= 2 ? copyRequiredFieldPoliteFinal() : suppress ? copyClarifyPreferredDate() : baseQ;
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
        replyPlan: plan(withTone(outQ), suppress ? 'booking_ask_repeat_clarify' : 'booking_need_date'),
        routing: stubRouting(),
      };
    }

    this.sanitizeBookingIntake(booking, settings);
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

    const crmTz = slotFetch.crmTimezoneUsed?.trim() || 'UTC';
    const win = booking.preferredTimeWindow;
    const { ranked: top, usedWindowFallback } = rankSlotsForBookingOffer(slotFetch.slots, {
      preferredHm: booking.preferredTime,
      preferredWindow: win && win !== 'exact' ? win : undefined,
      crmTimeZone: crmTz,
      max: 3,
    });
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

    const humanDate = formatHumanDateFromYmd(booking.preferredDate!.trim());
    const displayLines = offered.map(o => o.displayText);
    const body =
      usedWindowFallback && win && win !== 'exact'
        ? copyNoSlotsInWindow(humanDate, timeWindowDisplayLabel(win), displayLines)
        : copySlotsOfferedWithHumanDate(humanDate, displayLines);

    const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, {
      ...booking,
      status: 'offered_slots',
      offeredSlots: offered,
      offeredSlotsCrmTimeZone: crmTz,
      lastOfferedAt: new Date().toISOString(),
      pendingFieldId: undefined,
      pendingFieldLabel: undefined,
      pendingFieldRequired: undefined,
      lastAskedFieldId: undefined,
      lastAskedAt: undefined,
      lastQuestionFingerprint: undefined,
      sameFieldPromptCount: undefined,
      pendingParseFailureCount: undefined,
    });

    return {
      handled: true,
      persistMetadata: nextMeta,
      replyPlan: plan(withTone(body), 'booking_slots_offered'),
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

  private snapshotFromGhlContactRecord(c: Record<string, unknown>): {
    displayName?: string;
    phone?: string;
    email?: string;
  } {
    const fn = typeof c['firstName'] === 'string' ? c['firstName'].trim() : '';
    const ln = typeof c['lastName'] === 'string' ? c['lastName'].trim() : '';
    const composed = [fn, ln].filter(Boolean).join(' ').trim();
    const displayName =
      (typeof c['name'] === 'string' && c['name'].trim()) ||
      (typeof c['contactName'] === 'string' && c['contactName'].trim()) ||
      composed ||
      undefined;
    const phone =
      (typeof c['phone'] === 'string' && c['phone'].trim()) ||
      (typeof c['phoneNumber'] === 'string' && c['phoneNumber'].trim()) ||
      undefined;
    const email = typeof c['email'] === 'string' ? c['email'].trim() : undefined;
    return { displayName, phone, email };
  }

  /**
   * Read-only CRM contact snapshot for staff alert / appointment notes (never booking intake).
   * Uses inbound hint first; fills gaps with GHL getContact when contactId is known.
   */
  private async resolveStaffContactSnapshotForAlert(params: {
    tenantId: string;
    contactId: string;
    hint?: { displayName?: string; phone?: string; email?: string };
    inboundContactFromExtendedWebhook?: boolean;
  }): Promise<{
    displayName?: string;
    phone?: string;
    email?: string;
    source: 'params' | 'webhook' | 'ghl_contact_lookup' | 'missing';
  }> {
    const hintDn = params.hint?.displayName?.trim();
    const hintPh = params.hint?.phone?.trim();
    const hintEm = params.hint?.email?.trim();
    let displayName = hintDn;
    let phone = hintPh;
    let email = hintEm;
    const cid = params.contactId?.trim();
    const needLookup = Boolean(cid) && (!displayName || !phone);
    let usedGhl = false;

    if (needLookup) {
      try {
        const { client } = await this.ghlService.createGhlClientForConnectedTenantWorkerOrThrow(params.tenantId);
        const gc = await client.getContact(cid);
        if (gc.success && gc.contact && typeof gc.contact === 'object') {
          const snap = this.snapshotFromGhlContactRecord(gc.contact as Record<string, unknown>);
          if (!displayName && snap.displayName?.trim()) displayName = snap.displayName.trim();
          if (!phone && snap.phone?.trim()) phone = snap.phone.trim();
          if (!email && snap.email?.trim()) email = snap.email.trim();
          usedGhl = true;
        }
      } catch {
        // non-fatal — booking confirmation must proceed
      }
    }

    const hasName = Boolean(displayName);
    const hasPhone = Boolean(phone);
    let source: 'params' | 'webhook' | 'ghl_contact_lookup' | 'missing';
    if (!hasName && !hasPhone) {
      source = 'missing';
    } else if (usedGhl) {
      source = 'ghl_contact_lookup';
    } else if (params.inboundContactFromExtendedWebhook) {
      source = 'webhook';
    } else {
      source = 'params';
    }

    return { displayName, phone, email, source };
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
      fw: booking.preferredTimeWindow ?? '',
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
      return cf ? copyRequiredFieldPoliteFinal(cf.label) : copyRequiredFieldCannotSkip();
    }
    switch (fieldId as BookingCoreFieldKey) {
      case 'name':
      case 'phone':
      case 'email':
      case 'service':
      case 'preferred_date':
      case 'preferred_time':
      case 'first_visit':
        return copyRequiredFieldCannotSkip();
      default:
        return copyRequiredFieldCannotSkip();
    }
  }

  private shouldSuppressRepeatQuestion(
    booking: AisbpBookingStateV1,
    nextFieldId: string,
    _canonicalQuestionFp: string,
  ): boolean {
    if (!booking.lastAskedAt || !booking.lastAskedFieldId) return false;
    if (booking.lastAskedFieldId !== nextFieldId) return false;
    const ageMs = Date.now() - Date.parse(booking.lastAskedAt);
    if (!Number.isFinite(ageMs) || ageMs > 120_000) return false;
    return true;
  }

  private clarifyRepeatedAsk(
    fieldId: string,
    _settings: { coreFieldsJson: Record<string, CoreFieldToggle>; customFieldsJson: CustomBookingFieldDto[] },
  ): string {
    switch (fieldId) {
      case 'phone':
        return copyClarifyPhone();
      case 'email':
        return copyClarifyEmail();
      case 'preferred_date':
        return copyClarifyPreferredDate();
      case 'name':
        return copyClarifyName();
      case 'service':
        return copyClarifyService();
      case 'preferred_time':
        return copyClarifyPreferredTime();
      case 'first_visit':
        return copyClarifyFirstVisit();
      default:
        if (fieldId.startsWith('custom:')) {
          return copyClarifyCustomField();
        }
        return copyClarifyPreferredDate();
    }
  }

  private promptForMissingField(
    fieldId: string,
    settings: TenantBookingSettingsDto,
    optionalAllowSkipHint: boolean,
  ): string {
    if (fieldId.startsWith('custom:')) {
      const id = fieldId.slice('custom:'.length);
      const cf = settings.customFieldsJson.find(c => c.id === id);
      return cf ? formatCustomFieldBookingQuestion(cf, optionalAllowSkipHint) : copyAskService();
    }
    const key = fieldId as BookingCoreFieldKey;
    switch (key) {
      case 'name':
        return copyAskBookingName() + (optionalAllowSkipHint ? ' You can skip this if you prefer.' : '');
      case 'phone':
        return copyAskBookingPhone() + (optionalAllowSkipHint ? ' You can skip this if you prefer.' : '');
      case 'email':
        return copyAskEmail() + (optionalAllowSkipHint ? ' You can skip this if you prefer.' : '');
      case 'service':
        return formatServiceAskWithOptionalMenu(settings.serviceMenuOptions) + (optionalAllowSkipHint ? ' You can skip this if you prefer.' : '');
      case 'preferred_date':
        return copyAskPreferredDate() + (optionalAllowSkipHint ? ' You can skip this if you prefer.' : '');
      case 'preferred_time':
        return copyAskPreferredTime() + (optionalAllowSkipHint ? ' You can skip this if you prefer.' : '');
      case 'first_visit':
        return copyAskFirstVisit();
      default:
        return copyAskService();
    }
  }

  private applyRichFieldExtraction(
    booking: AisbpBookingStateV1,
    settings: TenantBookingSettingsDto,
    combined: string,
    latest: string,
    todayYmd: string,
  ): void {
    const text = `${combined}\n${latest}`;
    if (!booking.service) {
      const g = resolveServiceFromBookingIntake(combined, latest, settings.serviceMenuOptions);
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
      const d =
        resolveRelativeDayPhrase(text, todayYmd) ||
        resolveBookingCalendarDay(text, todayYmd) ||
        resolveRelativeDayPhrase(combined, todayYmd) ||
        resolveBookingCalendarDay(combined, todayYmd) ||
        resolveRelativeDayPhrase(latest, todayYmd) ||
        resolveBookingCalendarDay(latest, todayYmd);
      if (d) booking.preferredDate = d;
    }
    if (!booking.preferredTime) {
      const t =
        extractPreferredTime(text) || extractPreferredTime(combined) || extractPreferredTime(latest);
      if (t) {
        booking.preferredTime = t;
        booking.preferredTimeWindow = 'exact';
      }
    }
    if (!booking.preferredTime && !booking.preferredTimeWindow) {
      const tw =
        extractPreferredTimeWindow(text) ||
        extractPreferredTimeWindow(combined) ||
        extractPreferredTimeWindow(latest);
      if (tw) booking.preferredTimeWindow = tw;
    }
    if (!booking.firstVisit) {
      const fv =
        parseFirstVisitNaturalReply(latest) ||
        parseFirstVisitNaturalReply(combined) ||
        parseFirstVisitNaturalReply(text) ||
        extractFirstVisit(text);
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

  private sanitizeBookingIntake(booking: AisbpBookingStateV1, settings: TenantBookingSettingsDto): void {
    const menu = settings.serviceMenuOptions;
    if (booking.service?.trim() && !isAcceptedBookingServiceValue(booking.service, menu)) {
      booking.service = undefined;
    }
    if (!booking.customAnswers) return;
    for (const cf of settings.customFieldsJson) {
      if (cf.fieldType !== 'single_select' && cf.fieldType !== 'single_choice') continue;
      const a = booking.customAnswers[cf.id]?.trim();
      if (!a) continue;
      if (customSelectAnswerIsWholeOptionList(a, cf.options)) {
        delete booking.customAnswers[cf.id];
      }
    }
    if (Object.keys(booking.customAnswers).length === 0) {
      booking.customAnswers = undefined;
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
        return booking.preferredTime?.trim() || booking.preferredTimeWindow?.trim();
      case 'first_visit':
        return booking.firstVisit;
      default:
        return undefined;
    }
  }
}
