import { Injectable, Logger, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import {
  mergeConversationMetadataForPersist,
  readConversationMetadataField,
} from '../../lib/conversation-metadata-merge';
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
  addCalendarDaysUtcYmd,
  detectLiveBookingInterest,
  extractEmail,
  extractFirstVisit,
  extractNameGuess,
  extractPhone,
  extractPreferredTime,
  extractPreferredTimeWindow,
  findExactSlotMatchingPreferredHm,
  matchOfferedByHm,
  normalizedHmToMinutes,
  parseExactSlotReservationAffirmative,
  parseExactSlotReservationNegative,
  parseFirstVisitNaturalReply,
  parseSlotSelectionOrTimeRevision,
  rankSlotsForBookingOffer,
  resolveBookingCalendarDay,
  resolveRelativeDayPhrase,
  isoStartToLocalHm,
  isAmbiguousSlashDate,
  shouldSuppressImplicitSlotPickFromFrustration,
  slotStartLocalMinutes,
  stripBookingFrustrationForParse,
  userCombinedMessageAskedAvailabilityQuestion,
} from './booking-intent-and-parse';
import {
  customSelectAnswerIsWholeOptionList,
  isAcceptedBookingServiceValue,
  matchUserLineToMenuOption,
  resolveServiceFromBookingIntake,
} from './booking-service-intake';
import { BookingNluInterpreterService } from './booking-nlu-interpreter.service';
import { BookingReplyComposerService } from './booking-reply-composer.service';
import {
  BOOKING_NLU_MIN_MERGE_CONFIDENCE,
  bookingUserTextHasExplicitFourDigitYear,
  mergeValidatedNluIntoBooking,
} from './booking-nlu-merge';
import {
  planBookingTurnFromNlu,
  userMessageImpliesAvailabilityDiscovery,
  type BookingNluTurnAction,
} from './booking-nlu-planner';
import type { BookingNluInterpretInput, BookingNluOutput } from './booking-nlu.schema';
import type { BookingReplyComposerNextStep } from './booking-reply-composer.types';
import {
  buildBookingReplyComposerNextStepForAsk,
  buildOfferSlotsComposerStep,
} from './booking-reply-composer-step';
import { applyPendingFieldAnswer, isOptionalSkipIntent } from './booking-pending-field';
import {
  BATCH_DETAILS_PENDING_ID,
  PRE_SCHEDULING_ASK_PRIORITY,
  applyBatchDetailsFromInbound,
  finalizeBatchDetailsPending,
  isSchedulingTimeLocked,
  listBatchDetailsMissingFieldIds,
  toBatchBookingDetailFields,
} from './booking-batch-details';
import {
  canCollectContactDetailsInBatch,
  clearSlotOfferState,
  mayOfferLiveSlots,
} from './booking-flow-guards';
import { buildAppointmentCreateNotes, customFieldIncludedInSummary } from './booking-summary';
import { BookingPostConfirmService } from './booking-post-confirm.service';
import { AppCacheService } from '../../lib/app-cache.service';
import {
  bookingCreatingLockKey,
  isBookingCreatingInFlight,
} from './booking-creating-lock';
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
  copyFrustrationAcknowledgeExactSlotAvailable,
  copyNoSlotsInWindow,
  copyRequiredFieldCannotSkip,
  copyRequiredFieldPoliteFinal,
  copySingleExactTimeAvailable,
  copySlotsOfferedWithHumanDate,
  buildPreferredDateNeedAsk,
  formatCustomFieldBookingQuestion,
  formatHumanDateFromYmd,
  formatPreferredHmForDisplay,
  formatServiceAskWithOptionalMenu,
  timeWindowDisplayLabel,
  buildBatchBookingDetailsAsk,
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
    @Optional() private readonly bookingNluInterpreter?: BookingNluInterpreterService,
    @Optional() private readonly bookingReplyComposer?: BookingReplyComposerService,
    @Optional() private readonly appCache?: AppCacheService,
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
    const tenantCrmTz = (await this.bookingSettings.resolveTenantCrmTimezone(params.tenantId))?.trim();
    const crmTz = tenantCrmTz || params.tenantTimeZone?.trim() || resolveAppTimeZone();
    const todayYmd = getBusinessLocalNow(crmTz).localIso.slice(0, 10);
    const crmTodayYmd = todayYmd;

    const prevMeta =
      params.metadata && typeof params.metadata === 'object' && !Array.isArray(params.metadata)
        ? { ...params.metadata }
        : {};
    let booking = parseAisbpBookingState(prevMeta);

    if (booking?.status === 'failed') {
      const startIso = booking.selectedSlot?.startIso?.trim() ?? '';
      const calId = booking.calendarId?.trim() ?? '';
      const alreadyBooked =
        Boolean(booking.appointmentId?.trim()) ||
        (startIso && calId
          ? await this.hasRecentExecutedBooking(
              params.tenantId,
              params.conversationId,
              startIso,
              calId,
            )
          : false);
      if (alreadyBooked) {
        booking = {
          ...booking,
          status: 'confirmed',
          lastError: undefined,
          lastCreateError: undefined,
        };
      } else {
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
    }

    if (isBookingCreatingInFlight(booking)) {
      this.logger.log(`bookingFlowSkipped ${JSON.stringify({ reason: 'creating_in_flight' })}`);
      return {
        handled: true,
        persistMetadata: prevMeta,
        replyPlan: plan(
          "I'm already securing that time for you — one moment. If you don't hear back shortly, just send another message.",
          'booking_in_flight',
        ),
        routing: stubRouting(),
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

    const crmTzForBookingDay = booking.offeredSlotsCrmTimeZone?.trim() || crmTz;

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
      const wantsNewBooking = detectLiveBookingInterest(combined);
      const wantsReschedule = /\b(reschedule|rebook|change\s+my\s+appointment|cancel(\s+my)?\s+appointment)\b/i.test(
        combined,
      );
      if (!wantsNewBooking && !wantsReschedule) {
        return { handled: false };
      }
      const priorAppointmentId = booking.appointmentId?.trim();
      if (priorAppointmentId && wantsReschedule) {
        await this.cancelGhlAppointmentBestEffort(params.tenantId, priorAppointmentId);
      }
      booking = {
        ...emptyBookingState(),
        calendarId: settings.defaultGhlCalendarId!.trim(),
        version: (booking.version ?? 1) + 1,
        bookingMode: settings.bookingMode,
      };
      this.applyContactSnapshot(booking, params.contactSnapshot);
    }

    const snapshotBefore = this.snapshotBookingCore(booking);

    const stripLatestFr = stripBookingFrustrationForParse(latest);
    const stripCombinedFr = stripBookingFrustrationForParse(combined);
    const deterministicHadFrustration =
      stripLatestFr.hadFrustration || stripCombinedFr.hadFrustration;

    const bareSlotSkip =
      booking.status === 'offered_slots' &&
      Boolean(booking.offeredSlots?.length) &&
      this.isBareOfferedSlotIndexLine(latest, booking.offeredSlots);

    const skipBookingNlu = !latest.trim() || !this.bookingNluInterpreter || bareSlotSkip;

    if (latest.trim() && !this.bookingNluInterpreter && !bareSlotSkip) {
      this.logger.log(
        `bookingNluUnavailable ${JSON.stringify({
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          reason: 'interpreter_not_configured',
        })}`,
      );
    }

    let clearedPendingFieldId: string | undefined;
    let nluUserFrustrated = false;
    let nluOut: BookingNluOutput | null = null;
    let nluPlan: BookingNluTurnAction = { type: 'none' };
    if (!skipBookingNlu) {
      const input = this.buildBookingNluInterpretInput({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        latest,
        combined,
        booking,
        settings,
        crmTimezone: crmTzForBookingDay,
      });
      const out = await this.bookingNluInterpreter.interpret(input);
      if (out) {
        nluOut = out;
        nluUserFrustrated = Boolean(out.userFrustrated);
        const mergeResult = mergeValidatedNluIntoBooking(booking, settings, out, {
          minConfidence: BOOKING_NLU_MIN_MERGE_CONFIDENCE,
          intent: out.intent,
          pendingFieldId: booking.pendingFieldId,
          crmTodayYmd,
          latestInboundText: latest,
          combinedInboundText: combined,
        });
        nluPlan = planBookingTurnFromNlu({ nlu: out, booking, latestInboundText: latest });
        this.logger.log(
          `bookingNluPlan ${JSON.stringify({
            tenantId: params.tenantId,
            conversationId: params.conversationId,
            intent: out.intent,
            confidence: out.confidence,
            action: nluPlan.type,
          })}`,
        );
        const res = this.resolvePendingIfBookingValuesFilled(booking, settings);
        if (res.clearedPendingFieldId) clearedPendingFieldId = res.clearedPendingFieldId;
        if (mergeResult.dateRepair) {
          this.logger.log(
            `bookingNluDateRepaired ${JSON.stringify({
              tenantId: params.tenantId,
              conversationId: params.conversationId,
              oldDate: mergeResult.dateRepair.oldDate,
              newDate: mergeResult.dateRepair.newDate,
              sourceText: mergeResult.dateRepair.sourceText,
            })}`,
          );
        }
        if (mergeResult.mergedFieldKeys.length > 0) {
          this.logger.log(
            `bookingNluMergeApplied ${JSON.stringify({
              tenantId: params.tenantId,
              conversationId: params.conversationId,
              mergedFieldKeys: mergeResult.mergedFieldKeys,
              ...(clearedPendingFieldId ? { clearedPendingFieldId } : {}),
            })}`,
          );
        } else if (mergeResult.skipReason) {
          this.logger.log(
            `bookingNluMergeSkipped ${JSON.stringify({
              tenantId: params.tenantId,
              conversationId: params.conversationId,
              reason: mergeResult.skipReason,
            })}`,
          );
        }
      }
    }

    if (
      nluOut &&
      nluOut.intent === 'cancel' &&
      nluOut.confidence >= BOOKING_NLU_MIN_MERGE_CONFIDENCE
    ) {
      const apptId = booking.appointmentId?.trim();
      if (apptId) {
        await this.cancelGhlAppointmentBestEffort(params.tenantId, apptId);
      }
      const reset = {
        ...emptyBookingState(),
        calendarId: settings.defaultGhlCalendarId!.trim(),
        version: (booking.version ?? 1) + 1,
        bookingMode: settings.bookingMode,
      };
      this.applyContactSnapshot(reset, params.contactSnapshot);
      const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, reset);
      return {
        handled: true,
        persistMetadata: nextMeta,
        replyPlan: plan(
          apptId
            ? "I've cancelled your appointment. If you'd like to book again, just tell me the service and when works for you."
            : "No problem — I've stopped the booking. Tell me when you'd like to try again.",
          'booking_cancelled',
        ),
        routing: stubRouting(),
      };
    }

    this.tryApplySuggestedPreferredDateConfirmation(booking, latest, combined, crmTodayYmd);

    const hadFrustration = deterministicHadFrustration || nluUserFrustrated;

    this.applyRichFieldExtraction(booking, settings, combined, latest, todayYmd);

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
      customFieldsJson: settings.customFieldsJson,
      coreFieldsJson: settings.coreFieldsJson,
      isFieldRequired: (fieldId: string) => this.isAskFieldRequired(settings, fieldId),
    });
    if (clearedPendingFieldId) {
      booking.pendingParseFailureCount = 0;
      booking.sameFieldPromptCount = 0;
    }
    if (pendingAns.answered) {
      booking.pendingParseFailureCount = 0;
      booking.sameFieldPromptCount = 0;
      if (pendingAns.fieldId === 'preferred_date') {
        booking.pendingSuggestedDateYmd = undefined;
      }
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

    this.syncNoSlotsFollowUpState(booking);
    this.stripImplicitPastPreferredDateIfNeeded(booking, crmTodayYmd, latest, combined);
    this.sanitizeBookingIntake(booking, settings);
    this.applyCommaSeparatedBatchCatchUp(settings, booking, latest, combined);

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
    if ((pendingAns.answered || clearedPendingFieldId) && hadFrustration) {
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
      const composedSkip = await this.composeBookingCustomerReply({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        latestInboundText: latest,
        combinedTranscript: combined,
        booking,
        nextStep: buildBookingReplyComposerNextStepForAsk(pid, settings, outQ),
        userFrustrated: hadFrustration,
        businessName: params.tenantDisplayName,
      });
      return {
        handled: true,
        persistMetadata: nextMeta,
        replyPlan: plan(withTone(composedSkip), 'booking_required_not_skippable'),
        routing: stubRouting(),
      };
    }

    if (booking.status === 'offered_slots' && nluPlan.type === 'refetch_slots_after_schedule_change') {
      booking.offeredSlots = undefined;
      booking.offeredSlotsCrmTimeZone = undefined;
      booking.lastOfferedAt = undefined;
      booking.selectedSlot = undefined;
      booking.status = 'collecting_details';
    }

    if (booking.status === 'offered_slots' && booking.offeredSlots?.length) {
      booking.pendingFieldId = undefined;
      booking.pendingFieldLabel = undefined;
      booking.pendingFieldRequired = undefined;

      let crmTzForPick = booking.offeredSlotsCrmTimeZone?.trim();
      if (!crmTzForPick) {
        this.stripImplicitPastPreferredDateIfNeeded(booking, crmTodayYmd, latest, combined);
        const tzPeek = await this.bookingSettings.fetchFreeSlotsForAutomation(params.tenantId, {
          calendarId: booking.calendarId,
          selectedDate: booking.preferredDate!,
          selectedTime: booking.preferredTime,
        });
        crmTzForPick = tzPeek.crmTimezoneUsed?.trim() || 'UTC';
      }

      if (booking.offeredSlots.length === 1 && parseExactSlotReservationNegative(latest)) {
        booking.offeredSlots = undefined;
        booking.offeredSlotsCrmTimeZone = undefined;
        booking.lastOfferedAt = undefined;
        booking.selectedSlot = undefined;
        booking.preferredTime = undefined;
        booking.preferredTimeWindow = undefined;
        const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, { ...booking, status: 'collecting_details' });
        const baseQ = copyAskPreferredTime();
        const composedNeg = await this.composeBookingCustomerReply({
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          latestInboundText: latest,
          combinedTranscript: combined,
          booking,
          nextStep: buildBookingReplyComposerNextStepForAsk('preferred_time', settings, baseQ),
          userFrustrated: hadFrustration,
          businessName: params.tenantDisplayName,
        });
        return {
          handled: true,
          persistMetadata: nextMeta,
          replyPlan: plan(withTone(composedNeg), 'booking_decline_exact_offer'),
          routing: stubRouting(),
        };
      }

      let rev = parseSlotSelectionOrTimeRevision(
        latest,
        combined,
        booking.offeredSlots,
        crmTzForPick,
        booking.preferredDate!,
        todayYmd,
      );
      if (nluPlan.type === 'confirm_single_slot' && booking.offeredSlots.length === 1) {
        const latestClean = stripBookingFrustrationForParse(latest.replace(/\s+/g, ' ').trim()).cleaned;
        if (parseExactSlotReservationAffirmative(latest) && !extractPreferredTime(latestClean)) {
          rev = { kind: 'selected_slot', slot: booking.offeredSlots[0]! };
        }
      } else if (nluPlan.type === 'select_slot_from_nlu') {
        if (nluPlan.option != null) {
          const slot = booking.offeredSlots.find(o => o.option === nluPlan.option);
          if (slot) rev = { kind: 'selected_slot', slot };
        } else if (nluPlan.timeHm) {
          const matched = matchOfferedByHm(booking.offeredSlots, nluPlan.timeHm, crmTzForPick);
          if (matched) rev = { kind: 'selected_slot', slot: matched };
          else rev = { kind: 'time_revision', preferredTime: nluPlan.timeHm };
        }
      } else if (nluOut?.intent === 'confirm_offer' && booking.offeredSlots.length === 1) {
        const latestClean = stripBookingFrustrationForParse(latest.replace(/\s+/g, ' ').trim()).cleaned;
        const latestHm = extractPreferredTime(latestClean);
        if (parseExactSlotReservationAffirmative(latest) && !latestHm) {
          rev = { kind: 'selected_slot', slot: booking.offeredSlots[0]! };
        } else if (latestHm) {
          const matched = matchOfferedByHm(booking.offeredSlots, latestHm, crmTzForPick);
          if (matched) rev = { kind: 'selected_slot', slot: matched };
        }
      }

      const wantsSlotRefresh =
        nluPlan.type === 'discover_availability' ||
        nluPlan.type === 'refetch_slots_after_schedule_change' ||
        userMessageImpliesAvailabilityDiscovery(latest) ||
        userMessageImpliesAvailabilityDiscovery(combined);

      if (
        rev.kind === 'time_revision' ||
        rev.kind === 'time_window_revision' ||
        rev.kind === 'date_time_revision' ||
        (rev.kind === 'unparseable' && wantsSlotRefresh)
      ) {
        if (rev.kind === 'unparseable' && wantsSlotRefresh) {
          booking.preferredTime = undefined;
          booking.preferredTimeWindow = undefined;
        } else if (rev.kind === 'time_revision') {
          booking.preferredTime = rev.preferredTime;
          booking.preferredTimeWindow = undefined;
        } else if (rev.kind === 'time_window_revision') {
          booking.preferredTimeWindow = rev.preferredTimeWindow;
          booking.preferredTime = undefined;
        } else if (rev.kind === 'date_time_revision') {
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

        this.stripImplicitPastPreferredDateIfNeeded(booking, crmTodayYmd, latest, combined);
        let slotFetch = await this.bookingSettings.fetchFreeSlotsForAutomation(params.tenantId, {
          calendarId: booking.calendarId,
          selectedDate: booking.preferredDate!,
          selectedTime: booking.preferredTime,
        });
        if (!slotFetch.error && slotFetch.slots.length === 0 && booking.preferredTime?.trim()) {
          const dayWide = await this.bookingSettings.fetchFreeSlotsForAutomation(params.tenantId, {
            calendarId: booking.calendarId,
            selectedDate: booking.preferredDate!,
          });
          if (!dayWide.error && dayWide.slots.length > 0) {
            this.logger.log(
              `bookingSlotsDayWideRetry ${JSON.stringify({
                tenantId: params.tenantId,
                conversationId: params.conversationId,
                preferredTime: booking.preferredTime,
                slotsReturned: dayWide.slots.length,
                reason: 'offered_slots_revision',
              })}`,
            );
            slotFetch = dayWide;
          }
        }

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
          booking.noSlotsForDateYmd = booking.preferredDate!.trim();
          booking.noSlotsWideSearchDone = false;
          const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, { ...booking, status: 'collecting_details' });
          const noSlotMsg =
            "I couldn't find open slots for that date in the live calendar. Want to try another date or time?";
          const composedNo = await this.composeBookingCustomerReply({
            tenantId: params.tenantId,
            conversationId: params.conversationId,
            latestInboundText: latest,
            combinedTranscript: combined,
            booking,
            nextStep: { type: 'no_slots', safeBaseMessage: noSlotMsg },
            userFrustrated: hadFrustration,
            businessName: params.tenantDisplayName,
          });
          return {
            handled: true,
            persistMetadata: nextMeta,
            replyPlan: plan(withTone(composedNo), 'booking_no_slots'),
            routing: stubRouting(),
          };
        }

        const humanDate = formatHumanDateFromYmd(booking.preferredDate!.trim());
        const prefHm = booking.preferredTime?.trim();
        const hasExactInFull =
          Boolean(prefHm) &&
          slotFetch.slots.some(s => {
            const sm = slotStartLocalMinutes(s.startTime, crmTz2);
            const tm = normalizedHmToMinutes(prefHm!);
            return sm !== undefined && tm !== undefined && sm === tm;
          });

        let offered: AisbpOfferedSlot[];
        let body: string;
        if (prefHm && hasExactInFull) {
          const exact = findExactSlotMatchingPreferredHm(slotFetch.slots, prefHm, crmTz2);
          if (!exact) {
            offered = top.map((s, i) => ({
              option: i + 1,
              startIso: s.startTime,
              endIso: slotEndIso(s, booking.slotDurationMinutes ?? 30),
              displayText: formatSlotLabel(s.startTime, slotFetch.crmTimezoneUsed),
              calendarId: booking.calendarId,
            }));
            body = copySlotsOfferedWithHumanDate(humanDate, offered.map(o => o.displayText));
          } else {
            offered = [
              {
                option: 1,
                startIso: exact.startTime,
                endIso: slotEndIso(exact, booking.slotDurationMinutes ?? 30),
                displayText: formatSlotLabel(exact.startTime, slotFetch.crmTimezoneUsed),
                calendarId: booking.calendarId,
              },
            ];
            body = copySingleExactTimeAvailable(humanDate, offered[0]!.displayText, {
              availabilityQuestionTone: userCombinedMessageAskedAvailabilityQuestion(combined),
            });
          }
        } else {
          offered = top.map((s, i) => ({
            option: i + 1,
            startIso: s.startTime,
            endIso: slotEndIso(s, booking.slotDurationMinutes ?? 30),
            displayText: formatSlotLabel(s.startTime, slotFetch.crmTimezoneUsed),
            calendarId: booking.calendarId,
          }));
          const displayLines = offered.map(o => o.displayText);
          if (prefHm && !hasExactInFull && top.length > 0) {
            body = copyClosestSlotsWhenPreferredUnavailable(humanDate, formatPreferredHmForDisplay(prefHm), displayLines);
          } else if (usedWindowFallback && win && win !== 'exact') {
            body = copyNoSlotsInWindow(humanDate, timeWindowDisplayLabel(win), displayLines);
          } else {
            body = copySlotsOfferedWithHumanDate(humanDate, displayLines);
          }
        }

        this.logger.log(
          `bookingSlotsOffered ${JSON.stringify({
            tenantId: params.tenantId,
            conversationId: params.conversationId,
            count: offered.length,
            date: booking.preferredDate,
            reason: 'time_preference_revision',
          })}`,
        );

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
          noSlotsForDateYmd: undefined,
          noSlotsWideSearchDone: undefined,
        });

        const composedOffer = await this.composeBookingCustomerReply({
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          latestInboundText: latest,
          combinedTranscript: combined,
          booking,
          nextStep: buildOfferSlotsComposerStep(body, offered),
          userFrustrated: hadFrustration,
          businessName: params.tenantDisplayName,
        });

        return {
          handled: true,
          persistMetadata: nextMeta,
          replyPlan: plan(withTone(composedOffer), 'booking_slots_offered'),
          routing: stubRouting(),
        };
      }

      if (rev.kind !== 'selected_slot') {
        const prefHmRecovery = booking.preferredTime?.trim();
        const exactForPref =
          prefHmRecovery && booking.offeredSlots?.length
            ? matchOfferedByHm(booking.offeredSlots, prefHmRecovery, crmTzForPick)
            : undefined;
        if (rev.kind === 'unparseable' && exactForPref && shouldSuppressImplicitSlotPickFromFrustration(latest)) {
          const fullSlot = booking.offeredSlots!.find(o => o.startIso === exactForPref.startIso)!;
          const humanDateFr = formatHumanDateFromYmd(booking.preferredDate!.trim());
          const bodyFr = copyFrustrationAcknowledgeExactSlotAvailable(humanDateFr, fullSlot.displayText);
          const offeredSingle: AisbpOfferedSlot[] = [
            {
              ...fullSlot,
              option: 1,
              calendarId: fullSlot.calendarId ?? booking.calendarId,
            },
          ];
          const nextMetaFr = mergeBookingIntoConversationMetadata(prevMeta, {
            ...booking,
            status: 'offered_slots',
            offeredSlots: offeredSingle,
            offeredSlotsCrmTimeZone: crmTzForPick,
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
          const composedFr = await this.composeBookingCustomerReply({
            tenantId: params.tenantId,
            conversationId: params.conversationId,
            latestInboundText: latest,
            combinedTranscript: combined,
            booking,
            nextStep: buildOfferSlotsComposerStep(bodyFr, offeredSingle),
            userFrustrated: true,
            businessName: params.tenantDisplayName,
          });
          return {
            handled: true,
            persistMetadata: nextMetaFr,
            replyPlan: plan(composedFr, 'booking_slots_offered'),
            routing: stubRouting(),
          };
        }

        const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, { ...booking });
        const humanDateRelist = formatHumanDateFromYmd(booking.preferredDate!.trim());
        const offeredRelist = booking.offeredSlots!;
        const relistBody = copySlotsOfferedWithHumanDate(
          humanDateRelist,
          offeredRelist.map(o => o.displayText),
        );
        const composedPick = await this.composeBookingCustomerReply({
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          latestInboundText: latest,
          combinedTranscript: combined,
          booking,
          nextStep: buildOfferSlotsComposerStep(relistBody, offeredRelist),
          userFrustrated: hadFrustration,
          businessName: params.tenantDisplayName,
        });
        return {
          handled: true,
          persistMetadata: nextMeta,
          replyPlan: plan(withTone(composedPick), 'booking_pick_slot'),
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
      const tzGuess = booking.offeredSlotsCrmTimeZone?.trim() || crmTzForBookingDay;
      const pickedHm = isoStartToLocalHm(picked.startIso, tzGuess);
      let recheck = await this.bookingSettings.fetchFreeSlotsForAutomation(params.tenantId, {
        calendarId: picked.calendarId,
        selectedDate: ymd,
        ...(pickedHm ? { selectedTime: pickedHm } : {}),
      });

      this.logger.log(
        `bookingSlotRechecked ${JSON.stringify({
          tenantId: params.tenantId,
          slotsReturned: recheck.slots.length,
          hasError: Boolean(recheck.error),
          pickedHm: pickedHm ?? null,
        })}`,
      );

      if (recheck.error) {
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
            "I'm having trouble confirming that time against the live calendar right now. I'll pass your request to the team so they can lock it in for you.",
            'booking_recheck_failed',
          ),
          routing: stubRouting(),
        };
      }

      if (recheck.slots.length === 0) {
        const dayWide = await this.bookingSettings.fetchFreeSlotsForAutomation(params.tenantId, {
          calendarId: picked.calendarId,
          selectedDate: ymd,
        });
        if (!dayWide.error && dayWide.slots.length > 0) {
          recheck = dayWide;
        } else {
          const weekEnd = addCalendarDaysUtcYmd(ymd, 7);
          if (weekEnd) {
            const weekWide = await this.bookingSettings.fetchFreeSlotsForAutomation(params.tenantId, {
              calendarId: picked.calendarId,
              selectedDate: ymd,
              endDate: weekEnd,
            });
            if (!weekWide.error && weekWide.slots.length > 0) {
              recheck = weekWide;
            }
          }
        }
        if (recheck.slots.length === 0) {
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
              "That slot may have just been taken. Tell me another date (or the same date) and I'll fetch fresh times.",
              'booking_recheck_empty',
            ),
            routing: stubRouting(),
          };
        }
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
        const batchReply = await this.tryEmitBatchDetailsAsk({
          params,
          settings,
          booking,
          prevMeta,
          latest,
          combined,
          hadFrustration,
          withTone,
          fieldChanged: true,
          resetOfferedSlots: true,
        });
        if (batchReply) return batchReply;

        const nextAsk: string =
          PRE_SCHEDULING_ASK_PRIORITY.find(k => missingBeforeCreate.includes(k)) ?? missingBeforeCreate[0]!;
        const fieldRequired = this.isAskFieldRequired(settings, nextAsk);
        const baseQ = this.promptForMissingField(nextAsk, settings);
        const fpBase = fingerprintBookingQuestion(baseQ);
        booking.pendingFieldId = nextAsk;
        booking.pendingFieldRequired = fieldRequired;
        booking.lastAskedFieldId = nextAsk;
        booking.lastAskedAt = new Date().toISOString();
        booking.lastQuestionFingerprint = fpBase;
        booking.sameFieldPromptCount = 0;
        clearSlotOfferState(booking);
        const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, {
          ...booking,
          status: 'collecting_details',
        });
        const composedAsk = await this.composeBookingCustomerReply({
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          latestInboundText: latest,
          combinedTranscript: combined,
          booking,
          nextStep: buildBookingReplyComposerNextStepForAsk(nextAsk, settings, baseQ),
          userFrustrated: hadFrustration,
          businessName: params.tenantDisplayName,
        });
        return {
          handled: true,
          persistMetadata: nextMeta,
          replyPlan: plan(withTone(composedAsk), 'booking_required_before_confirm'),
          routing: stubRouting(),
        };
      }

      this.logger.log(`bookingAppointmentCreateStarted ${JSON.stringify({ tenantId: params.tenantId, calendarId: picked.calendarId })}`);

      if (!params.contactId?.trim()) {
        const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, {
          ...booking,
          status: 'offered_slots',
          selectedSlot: picked,
        });
        return {
          handled: true,
          persistMetadata: nextMeta,
          replyPlan: plan(
            "I have that time ready, but I couldn't link your contact in our system to complete the booking automatically. The team will follow up shortly to confirm it for you.",
            'booking_missing_contact',
          ),
          routing: stubRouting(),
        };
      }

      const lock = await this.tryAcquireBookingCreatingLock({
        conversationId: params.conversationId,
        tenantId: params.tenantId,
        booking,
        picked,
        prevMeta,
      });
      if (!lock.acquired) {
        if (lock.reason === 'duplicate' || lock.reason === 'already_confirmed') {
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
        const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, { ...booking, status: 'offered_slots' });
        return {
          handled: true,
          persistMetadata: nextMeta,
          replyPlan: plan(
            "I'm already securing that time for you — one moment. If you don't hear back shortly, just send another message.",
            'booking_in_flight',
          ),
          routing: stubRouting(),
        };
      }

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
      await this.ensureCalendarSlotRulesOnBooking(params.tenantId, booking);
      const endIso =
        picked.endIso?.trim() ||
        slotEndIso({ startTime: picked.startIso, endTime: undefined }, booking.slotDurationMinutes ?? 30);

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
        await this.releaseBookingCreatingLock(params.conversationId, lock.redisHeld);
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
          creatingStartedAt: undefined,
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
          intentPersisted: !insErr,
        })}`,
      );
      await this.releaseBookingCreatingLock(params.conversationId, lock.redisHeld);

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
      const composedConfirm = await this.composeBookingCustomerReply({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        latestInboundText: latest,
        combinedTranscript: combined,
        booking,
        nextStep: { type: 'booking_confirmed', safeBaseMessage: confirmText },
        userFrustrated: hadFrustration,
        businessName: params.tenantDisplayName,
      });

      const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, {
        ...booking,
        status: 'confirmed',
        selectedSlot: picked,
        appointmentId: bookRes.appointmentId,
        bookingConfirmedAt: new Date().toISOString(),
        creatingStartedAt: undefined,
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
        replyPlan: plan(withTone(composedConfirm), 'booking_confirmed'),
        routing: stubRouting(),
      };
    }

    const fieldChanged =
      pendingAns.answered || Boolean(clearedPendingFieldId) || this.snapshotBookingCore(booking) !== snapshotBefore;

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
      const baseQ = this.promptForMissingField(nextAsk, settings);
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
        outQ = this.copyFinalRequiredFieldAsk(nextAsk, settings);
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

      clearSlotOfferState(booking);
      const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, { ...booking, status: 'collecting_details' });
      const composedAsk = await this.composeBookingCustomerReply({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        latestInboundText: latest,
        combinedTranscript: combined,
        booking,
        nextStep: buildBookingReplyComposerNextStepForAsk(nextAsk, settings, outQ),
        userFrustrated: hadFrustration,
        businessName: params.tenantDisplayName,
      });
      return {
        handled: true,
        persistMetadata: nextMeta,
        replyPlan: plan(withTone(composedAsk), suppress ? 'booking_ask_repeat_clarify' : 'booking_collect_field'),
        routing: stubRouting(),
      };
    }

    const batchAsk = await this.tryEmitBatchDetailsAsk({
      params,
      settings,
      booking,
      prevMeta,
      latest,
      combined,
      hadFrustration,
      withTone,
      fieldChanged,
    });
    if (batchAsk) return batchAsk;

    if (!booking.preferredDate?.trim()) {
      const dateAsk = buildPreferredDateNeedAsk({
        combined,
        latest,
        crmTodayYmd,
        service: booking.service,
        customerName: booking.customerName,
        phone: booking.phone,
        preferredTime: booking.preferredTime,
        preferredTimeWindow: booking.preferredTimeWindow,
      });
      const baseQ = dateAsk.baseMessage;
      if (dateAsk.suggestedYmd) {
        booking.pendingSuggestedDateYmd = dateAsk.suggestedYmd;
      } else {
        booking.pendingSuggestedDateYmd = undefined;
      }
      const fpBase = fingerprintBookingQuestion(baseQ);
      const suppress = !fieldChanged && this.shouldSuppressRepeatQuestion(booking, 'preferred_date', fpBase);
      if (suppress) {
        booking.sameFieldPromptCount = (booking.sameFieldPromptCount ?? 0) + 1;
      } else {
        booking.sameFieldPromptCount = 0;
      }
      const sc = booking.sameFieldPromptCount ?? 0;
      const outQ =
        suppress && sc >= 2 ? this.copyFinalRequiredFieldAsk('preferred_date', settings) : suppress ? copyClarifyPreferredDate() : baseQ;
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
      const composedDate = await this.composeBookingCustomerReply({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        latestInboundText: latest,
        combinedTranscript: combined,
        booking,
        nextStep: buildBookingReplyComposerNextStepForAsk('preferred_date', settings, outQ),
        userFrustrated: hadFrustration,
        businessName: params.tenantDisplayName,
      });
      return {
        handled: true,
        persistMetadata: nextMeta,
        replyPlan: plan(withTone(composedDate), suppress ? 'booking_ask_repeat_clarify' : 'booking_need_date'),
        routing: stubRouting(),
      };
    }

    const suggestWide = await this.maybeHandleNoSlotsSuggestWideRange({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      tenantDisplayName: params.tenantDisplayName,
      prevMeta,
      booking,
      settings,
      latest,
      combined,
      hadFrustration,
      withTone,
      forceDiscovery: nluPlan.type === 'discover_availability',
    });
    if (suggestWide) return suggestWide;

    if (!mayOfferLiveSlots(settings, booking)) {
      const batchBeforeSlots = await this.tryEmitBatchDetailsAsk({
        params,
        settings,
        booking,
        prevMeta,
        latest,
        combined,
        hadFrustration,
        withTone,
        fieldChanged,
      });
      if (batchBeforeSlots) return batchBeforeSlots;
      this.logger.log(
        `bookingSlotOfferBlocked ${JSON.stringify({
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          reason: 'contact_intake_incomplete',
          batchPending: listBatchDetailsMissingFieldIds(settings, booking),
        })}`,
      );
      const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, { ...booking, status: 'collecting_details' });
      return {
        handled: true,
        persistMetadata: nextMeta,
        replyPlan: plan(
          withTone('Thanks — I still need a few details before I can check live availability. Please share what I asked for above.'),
          'booking_contact_before_slots',
        ),
        routing: stubRouting(),
      };
    }

    this.sanitizeBookingIntake(booking, settings);
    this.stripImplicitPastPreferredDateIfNeeded(booking, crmTodayYmd, latest, combined);
    await this.ensureCalendarSlotRulesOnBooking(params.tenantId, booking);
    let slotFetch = await this.bookingSettings.fetchFreeSlotsForAutomation(params.tenantId, {
      calendarId: booking.calendarId,
      selectedDate: booking.preferredDate!,
      selectedTime: booking.preferredTime,
    });
    if (!slotFetch.error && slotFetch.slots.length === 0 && booking.preferredTime?.trim()) {
      const dayWide = await this.bookingSettings.fetchFreeSlotsForAutomation(params.tenantId, {
        calendarId: booking.calendarId,
        selectedDate: booking.preferredDate!,
      });
      if (!dayWide.error && dayWide.slots.length > 0) {
        this.logger.log(
          `bookingSlotsDayWideRetry ${JSON.stringify({
            tenantId: params.tenantId,
            conversationId: params.conversationId,
            preferredTime: booking.preferredTime,
            slotsReturned: dayWide.slots.length,
          })}`,
        );
        slotFetch = dayWide;
      }
    }

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

    const crmTzFromFetch = slotFetch.crmTimezoneUsed?.trim() || crmTz;
    const win = booking.preferredTimeWindow;
    const { ranked: top, usedWindowFallback } = rankSlotsForBookingOffer(slotFetch.slots, {
      preferredHm: booking.preferredTime,
      preferredWindow: win && win !== 'exact' ? win : undefined,
      crmTimeZone: crmTzFromFetch,
      max: 3,
    });
    if (top.length === 0) {
      booking.noSlotsForDateYmd = booking.preferredDate!.trim();
      booking.noSlotsWideSearchDone = false;
      const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, { ...booking, status: 'collecting_details' });
      const noSlotMain =
        "I couldn't find open slots for that date in the live calendar. Want to try another date or time?";
      const composedNoMain = await this.composeBookingCustomerReply({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        latestInboundText: latest,
        combinedTranscript: combined,
        booking,
        nextStep: { type: 'no_slots', safeBaseMessage: noSlotMain },
        userFrustrated: hadFrustration,
        businessName: params.tenantDisplayName,
      });
      return {
        handled: true,
        persistMetadata: nextMeta,
        replyPlan: plan(withTone(composedNoMain), 'booking_no_slots'),
        routing: stubRouting(),
      };
    }

    const humanDate = formatHumanDateFromYmd(booking.preferredDate!.trim());
    const prefHmMain = booking.preferredTime?.trim();
    const hasExactInFullMain =
      Boolean(prefHmMain) &&
      slotFetch.slots.some(s => {
        const sm = slotStartLocalMinutes(s.startTime, crmTzFromFetch);
        const tm = normalizedHmToMinutes(prefHmMain!);
        return sm !== undefined && tm !== undefined && sm === tm;
      });

    let offered: AisbpOfferedSlot[];
    let body: string;
    if (prefHmMain && hasExactInFullMain) {
      const exact = findExactSlotMatchingPreferredHm(slotFetch.slots, prefHmMain, crmTzFromFetch);
      if (!exact) {
        offered = top.map((s, i) => ({
          option: i + 1,
          startIso: s.startTime,
          endIso: slotEndIso(s, booking.slotDurationMinutes ?? 30),
          displayText: formatSlotLabel(s.startTime, slotFetch.crmTimezoneUsed),
          calendarId: booking.calendarId,
        }));
        body = copySlotsOfferedWithHumanDate(humanDate, offered.map(o => o.displayText));
      } else {
        offered = [
          {
            option: 1,
            startIso: exact.startTime,
            endIso: slotEndIso(exact, booking.slotDurationMinutes ?? 30),
            displayText: formatSlotLabel(exact.startTime, slotFetch.crmTimezoneUsed),
            calendarId: booking.calendarId,
          },
        ];
        body = copySingleExactTimeAvailable(humanDate, offered[0]!.displayText, {
          availabilityQuestionTone: userCombinedMessageAskedAvailabilityQuestion(combined),
        });
      }
    } else {
      offered = top.map((s, i) => ({
        option: i + 1,
        startIso: s.startTime,
        endIso: slotEndIso(s, booking.slotDurationMinutes ?? 30),
        displayText: formatSlotLabel(s.startTime, slotFetch.crmTimezoneUsed),
        calendarId: booking.calendarId,
      }));
      const displayLines = offered.map(o => o.displayText);
      if (prefHmMain && !hasExactInFullMain && top.length > 0) {
        body = copyClosestSlotsWhenPreferredUnavailable(humanDate, formatPreferredHmForDisplay(prefHmMain), displayLines);
      } else if (usedWindowFallback && win && win !== 'exact') {
        body = copyNoSlotsInWindow(humanDate, timeWindowDisplayLabel(win), displayLines);
      } else {
        body = copySlotsOfferedWithHumanDate(humanDate, displayLines);
      }
    }

    this.logger.log(
      `bookingSlotsOffered ${JSON.stringify({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        count: offered.length,
        date: booking.preferredDate,
      })}`,
    );

    const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, {
      ...booking,
      status: 'offered_slots',
      offeredSlots: offered,
      offeredSlotsCrmTimeZone: crmTzFromFetch,
      lastOfferedAt: new Date().toISOString(),
      pendingFieldId: undefined,
      pendingFieldLabel: undefined,
      pendingFieldRequired: undefined,
      lastAskedFieldId: undefined,
      lastAskedAt: undefined,
      lastQuestionFingerprint: undefined,
      sameFieldPromptCount: undefined,
      pendingParseFailureCount: undefined,
      noSlotsForDateYmd: undefined,
      noSlotsWideSearchDone: undefined,
    });

    const composedMainOffer = await this.composeBookingCustomerReply({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      latestInboundText: latest,
      combinedTranscript: combined,
      booking,
      nextStep: buildOfferSlotsComposerStep(body, offered),
      userFrustrated: hadFrustration,
      businessName: params.tenantDisplayName,
    });

    return {
      handled: true,
      persistMetadata: nextMeta,
      replyPlan: plan(withTone(composedMainOffer), 'booking_slots_offered'),
      routing: stubRouting(),
    };
  }

  private sameMinute(a: string, b: string): boolean {
    const da = Date.parse(a);
    const db = Date.parse(b);
    if (!Number.isFinite(da) || !Number.isFinite(db)) return false;
    return Math.abs(da - db) < 90 * 1000;
  }

  private async tryAcquireBookingCreatingLock(params: {
    conversationId: string;
    tenantId: string;
    booking: AisbpBookingStateV1;
    picked: AisbpOfferedSlot;
    prevMeta: Record<string, unknown>;
  }): Promise<{
    acquired: boolean;
    reason?: 'duplicate' | 'already_confirmed' | 'in_flight' | 'read_failed' | 'update_failed';
    redisHeld?: boolean;
  }> {
    const dup = await this.hasRecentExecutedBooking(
      params.tenantId,
      params.conversationId,
      params.picked.startIso,
      params.picked.calendarId,
    );
    if (dup) return { acquired: false, reason: 'duplicate' };

    const lockKey = bookingCreatingLockKey(params.conversationId);
    let redisHeld = false;
    if (this.appCache) {
      redisHeld = await this.appCache.setIfNotExists(lockKey, { at: Date.now() }, 180);
      if (!redisHeld) return { acquired: false, reason: 'in_flight' };
    }

    const { data, error } = await this.supabase
      .from('conversations')
      .select('metadata, updated_at')
      .eq('id', params.conversationId)
      .maybeSingle();
    if (error) {
      if (redisHeld) await this.appCache?.delete(lockKey);
      return { acquired: false, reason: 'read_failed' };
    }

    const currentMeta = readConversationMetadataField(data?.metadata);
    const currentBooking = parseAisbpBookingState(currentMeta);
    if (currentBooking?.status === 'confirmed' && currentBooking.appointmentId) {
      if (redisHeld) await this.appCache?.delete(lockKey);
      return { acquired: false, reason: 'already_confirmed' };
    }
    if (isBookingCreatingInFlight(currentBooking)) {
      if (redisHeld) await this.appCache?.delete(lockKey);
      return { acquired: false, reason: 'in_flight' };
    }

    const creatingBooking: AisbpBookingStateV1 = {
      ...params.booking,
      status: 'creating',
      selectedSlot: params.picked,
      creatingStartedAt: new Date().toISOString(),
    };
    const incomingMeta = mergeBookingIntoConversationMetadata(params.prevMeta, creatingBooking);
    const merged = mergeConversationMetadataForPersist(currentMeta, incomingMeta);
    const rowUpdatedAt = typeof data?.updated_at === 'string' ? data.updated_at : null;
    const nowIso = new Date().toISOString();

    let updQuery = this.supabase
      .from('conversations')
      .update({ metadata: merged, updated_at: nowIso })
      .eq('id', params.conversationId);
    if (rowUpdatedAt) {
      updQuery = updQuery.eq('updated_at', rowUpdatedAt);
    }
    const { data: updRows, error: updErr } = await updQuery.select('id');
    if (updErr || !updRows?.length) {
      if (redisHeld) await this.appCache?.delete(lockKey);
      return { acquired: false, reason: 'update_failed' };
    }
    return { acquired: true, redisHeld };
  }

  private async releaseBookingCreatingLock(conversationId: string, redisHeld?: boolean): Promise<void> {
    if (redisHeld && this.appCache) {
      await this.appCache.delete(bookingCreatingLockKey(conversationId));
    }
  }

  private async cancelGhlAppointmentBestEffort(tenantId: string, appointmentId: string): Promise<void> {
    const id = appointmentId.trim();
    if (!id) return;
    try {
      const { client } = await this.ghlService.createGhlClientForConnectedTenantWorkerOrThrow(tenantId);
      const res = await client.cancelCalendarEvent(id);
      this.logger.log(
        `bookingAppointmentCancel ${JSON.stringify({
          tenantId,
          appointmentId: id,
          success: res.success,
          error: res.error ?? null,
        })}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`bookingAppointmentCancelFailed ${JSON.stringify({ tenantId, appointmentId: id, message: msg })}`);
    }
  }

  private async ensureCalendarSlotRulesOnBooking(tenantId: string, booking: AisbpBookingStateV1): Promise<void> {
    if (booking.slotDurationMinutes && booking.slotDurationMinutes > 0) return;
    const rules = await this.bookingSettings.loadCalendarBookingRules(tenantId, booking.calendarId);
    if (rules.slotDurationMinutes && rules.slotDurationMinutes > 0) {
      booking.slotDurationMinutes = rules.slotDurationMinutes;
    }
    if (rules.appointmentsPerSlot && rules.appointmentsPerSlot > 0) {
      this.logger.debug(
        `bookingCalendarCapacity ${JSON.stringify({
          tenantId,
          calendarId: booking.calendarId,
          appointmentsPerSlot: rules.appointmentsPerSlot,
        })}`,
      );
    }
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
    for (const key of PRE_SCHEDULING_ASK_PRIORITY) {
      const t = settings.coreFieldsJson[key];
      if (!t?.enabled) continue;
      if (!t.required) continue;
      const v = this.readCore(booking, key);
      if (v?.trim()) continue;
      if (key === 'preferred_time' && booking.preferredTimeWindow?.trim()) continue;
      return key;
    }

    for (const key of PRE_SCHEDULING_ASK_PRIORITY) {
      const t = settings.coreFieldsJson[key];
      if (!t?.enabled || t.required) continue;
      const v = this.readCore(booking, key);
      if (v?.trim()) continue;
      if (key === 'preferred_time' && booking.preferredTimeWindow?.trim()) continue;
      if (this.isFieldSkipped(booking, key)) continue;
      if (this.isOptionalAsked(booking, key)) continue;
      return key;
    }
    return null;
  }

  private async tryEmitBatchDetailsAsk(p: {
    params: {
      tenantId: string;
      conversationId: string;
      tenantDisplayName?: string;
    };
    settings: TenantBookingSettingsDto;
    booking: AisbpBookingStateV1;
    prevMeta: Record<string, unknown>;
    latest: string;
    combined: string;
    hadFrustration: boolean;
    withTone: (msg: string) => string;
    fieldChanged: boolean;
    resetOfferedSlots?: boolean;
  }): Promise<BookingFlowOrchestrationHookResult | null> {
    const { params, settings, booking, prevMeta, latest, combined, hadFrustration, withTone, fieldChanged } = p;
    if (!canCollectContactDetailsInBatch(settings, booking)) return null;

    const missingIds = listBatchDetailsMissingFieldIds(settings, booking);
    if (missingIds.length === 0) return null;

    const fields = toBatchBookingDetailFields(missingIds, settings, id => this.isAskFieldRequired(settings, id));
    const humanDate = booking.preferredDate?.trim() ? formatHumanDateFromYmd(booking.preferredDate.trim()) : undefined;
    const timeLabel = booking.preferredTime?.trim()
      ? formatPreferredHmForDisplay(booking.preferredTime.trim())
      : booking.preferredTimeWindow
        ? timeWindowDisplayLabel(booking.preferredTimeWindow)
        : undefined;
    const baseQ = buildBatchBookingDetailsAsk({ humanDate, timeLabel, fields });
    const fpBase = fingerprintBookingQuestion(baseQ);
    const suppress =
      !fieldChanged && this.shouldSuppressRepeatQuestion(booking, BATCH_DETAILS_PENDING_ID, fpBase);
    const outQ = suppress ? this.clarifyBatchDetailsAsk(fields) : baseQ;

    booking.pendingFieldId = BATCH_DETAILS_PENDING_ID;
    booking.pendingBatchFieldIds = missingIds;
    booking.pendingFieldRequired = fields.some(f => f.required);
    booking.lastAskedFieldId = BATCH_DETAILS_PENDING_ID;
    booking.lastAskedAt = new Date().toISOString();
    booking.lastQuestionFingerprint = fpBase;
    if (!suppress) booking.sameFieldPromptCount = 0;

    this.logger.log(
      `bookingNextStepSelected ${JSON.stringify({
        step: 'ask_batch_details',
        fieldIds: missingIds,
        suppressedDuplicate: suppress,
      })}`,
    );

    const nextMeta = mergeBookingIntoConversationMetadata(prevMeta, {
      ...booking,
      status: 'collecting_details',
      ...(p.resetOfferedSlots
        ? {
            offeredSlots: undefined,
            offeredSlotsCrmTimeZone: undefined,
            lastOfferedAt: undefined,
            selectedSlot: undefined,
          }
        : {}),
    });
    const composedAsk = await this.composeBookingCustomerReply({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      latestInboundText: latest,
      combinedTranscript: combined,
      booking,
      nextStep: { type: 'clarify_unknown', fieldId: BATCH_DETAILS_PENDING_ID, safeBaseMessage: outQ },
      userFrustrated: hadFrustration,
      businessName: params.tenantDisplayName,
    });
    return {
      handled: true,
      persistMetadata: nextMeta,
      replyPlan: plan(withTone(composedAsk), suppress ? 'booking_ask_repeat_clarify' : 'booking_collect_batch_details'),
      routing: stubRouting(),
    };
  }

  private clarifyBatchDetailsAsk(fields: Array<{ label: string }>): string {
    const list = fields.map(f => `- ${f.label}`).join('\n');
    return `Please share the following in one message:\n\n${list}`;
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

  private promptForMissingField(fieldId: string, settings: TenantBookingSettingsDto): string {
    if (fieldId.startsWith('custom:')) {
      const id = fieldId.slice('custom:'.length);
      const cf = settings.customFieldsJson.find(c => c.id === id);
      return cf ? formatCustomFieldBookingQuestion(cf, false) : copyAskService();
    }
    const key = fieldId as BookingCoreFieldKey;
    switch (key) {
      case 'name':
        return copyAskBookingName();
      case 'phone':
        return copyAskBookingPhone();
      case 'email':
        return copyAskEmail();
      case 'service':
        return formatServiceAskWithOptionalMenu(settings.serviceMenuOptions);
      case 'preferred_date':
        return copyAskPreferredDate();
      case 'preferred_time':
        return copyAskPreferredTime();
      case 'first_visit':
        return copyAskFirstVisit();
      default:
        return copyAskService();
    }
  }

  /** When metadata lost `pendingBatchFieldIds`, still parse comma-separated batch replies. */
  private applyCommaSeparatedBatchCatchUp(
    settings: TenantBookingSettingsDto,
    booking: AisbpBookingStateV1,
    latest: string,
    combined: string,
  ): void {
    if (!latest.includes(',')) return;
    if (!canCollectContactDetailsInBatch(settings, booking)) return;
    const missing = listBatchDetailsMissingFieldIds(settings, booking);
    if (missing.length === 0) return;
    applyBatchDetailsFromInbound({
      booking,
      latest,
      combinedHint: combined,
      settings: { customFieldsJson: settings.customFieldsJson, serviceMenuOptions: settings.serviceMenuOptions },
      pendingFieldIds: missing,
    });
    finalizeBatchDetailsPending({
      booking,
      pendingFieldIds: missing,
      isFieldRequired: (fieldId: string) => this.isAskFieldRequired(settings, fieldId),
    });
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
      if (!customFieldIncludedInSummary(cf)) continue;
      if (!booking.customAnswers) booking.customAnswers = {};
      if (booking.customAnswers[cf.id]?.trim()) continue;
      if (cf.fieldType === 'single_select' || cf.fieldType === 'single_choice') {
        const segments = latest
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length > 0);
        const candidates = [latest, ...segments];
        for (const seg of candidates) {
          const hit = matchUserLineToMenuOption(seg, cf.options ?? []);
          if (hit) {
            booking.customAnswers[cf.id] = hit;
            break;
          }
        }
        continue;
      }
      if (!cf.required) continue;
      if (cf.fieldType === 'checkbox' || cf.fieldType === 'yes_no') {
        if (/\b(yes|yep|yeah|no|nope)\b/i.test(latest)) {
          booking.customAnswers[cf.id] = /\bno\b/i.test(latest) ? 'no' : 'yes';
        }
      }
    }
  }

  private isSuggestAlternativesAfterNoSlotsInbound(latest: string): boolean {
    const t = latest.trim().toLowerCase();
    if (!t) return false;
    return /\b(suggest|suggestions?|recommend|alternatives?|other\s+(day|date|time)s?|next\s+available|what\s+(dates|times)|any\s+openings?|show\s+(me\s+)?(times|dates|slots)?)\b/.test(
      t,
    );
  }

  private syncNoSlotsFollowUpState(booking: AisbpBookingStateV1): void {
    const d = booking.preferredDate?.trim();
    const ns = booking.noSlotsForDateYmd?.trim();
    if (d && ns && d !== ns) {
      booking.noSlotsForDateYmd = undefined;
      booking.noSlotsWideSearchDone = undefined;
    }
  }

  private tryApplySuggestedPreferredDateConfirmation(
    booking: AisbpBookingStateV1,
    latest: string,
    combined: string,
    crmTodayYmd: string,
  ): void {
    const sug = booking.pendingSuggestedDateYmd?.trim();
    if (!sug || !latest.trim()) return;
    const pid = booking.pendingFieldId?.trim();
    if (pid && pid !== 'preferred_date') return;

    const line = stripBookingFrustrationForParse(latest).cleaned.trim();
    if (!line) return;

    const wide = `${combined}\n${latest}`.trim();
    const alt = resolveBookingCalendarDay(wide, crmTodayYmd) ?? resolveRelativeDayPhrase(wide, crmTodayYmd);
    if (alt && alt !== sug) {
      booking.pendingSuggestedDateYmd = undefined;
      return;
    }

    if (!this.isAffirmativeBookingDateConfirm(line)) return;

    booking.preferredDate = sug;
    booking.pendingSuggestedDateYmd = undefined;
    if (booking.pendingFieldId === 'preferred_date') {
      booking.pendingFieldId = undefined;
      booking.pendingFieldLabel = undefined;
      booking.pendingFieldRequired = undefined;
    }
  }

  private isAffirmativeBookingDateConfirm(line: string): boolean {
    const s = line.trim().toLowerCase().replace(/[.!?…]+$/g, '').trim();
    if (!s) return false;
    return /^(yes|yeah|yep|yup|correct|that'?s\s+right|sure|ok|okay|please\s+do|go\s+ahead)$/.test(s);
  }

  private stripImplicitPastPreferredDateIfNeeded(
    booking: AisbpBookingStateV1,
    crmTodayYmd: string,
    latest: string,
    combined: string,
  ): void {
    const ymd = booking.preferredDate?.trim();
    if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;
    if (ymd >= crmTodayYmd) return;
    if (bookingUserTextHasExplicitFourDigitYear(latest) || bookingUserTextHasExplicitFourDigitYear(combined)) return;
    this.logger.log(
      `bookingSlotFetchBlocked ${JSON.stringify({ reason: 'implicit_past_date', ymd, crmTodayYmd })}`,
    );
    booking.preferredDate = undefined;
    booking.pendingSuggestedDateYmd = undefined;
    booking.noSlotsForDateYmd = undefined;
    booking.noSlotsWideSearchDone = undefined;
  }

  private async maybeHandleNoSlotsSuggestWideRange(p: {
    tenantId: string;
    conversationId: string;
    tenantDisplayName?: string;
    prevMeta: Record<string, unknown>;
    booking: AisbpBookingStateV1;
    settings: TenantBookingSettingsDto;
    latest: string;
    combined: string;
    hadFrustration: boolean;
    withTone: (msg: string) => string;
    /** NLU `request_availability` — skip phrase-regex gate. */
    forceDiscovery?: boolean;
  }): Promise<BookingFlowOrchestrationHookResult | null> {
    const forceDiscovery = Boolean(p.forceDiscovery);
    if (!forceDiscovery && !this.isSuggestAlternativesAfterNoSlotsInbound(p.latest)) return null;
    const pd = p.booking.preferredDate?.trim();
    const ns = p.booking.noSlotsForDateYmd?.trim();
    if (!pd) return null;
    if (!forceDiscovery && (!ns || pd !== ns)) return null;
    if (p.booking.noSlotsWideSearchDone) return null;

    p.booking.noSlotsWideSearchDone = true;
    const endWide = addCalendarDaysUtcYmd(pd, 14);
    if (!endWide) return null;

    this.logger.log(
      `bookingNoSlotsWideSearch ${JSON.stringify({
        tenantId: p.tenantId,
        conversationId: p.conversationId,
        fromDate: pd,
        toDate: endWide,
      })}`,
    );

    const slotFetch = await this.bookingSettings.fetchFreeSlotsForAutomation(p.tenantId, {
      calendarId: p.booking.calendarId,
      selectedDate: pd,
      endDate: endWide,
    });

    const honestNoWide =
      "I checked a wider window in the live calendar but still couldn't find openings to list. I can check another date for you. What date would you like me to try?";

    if (slotFetch.error || slotFetch.slots.length === 0) {
      const nextMeta = mergeBookingIntoConversationMetadata(p.prevMeta, { ...p.booking, status: 'collecting_details' });
      const composed = await this.composeBookingCustomerReply({
        tenantId: p.tenantId,
        conversationId: p.conversationId,
        latestInboundText: p.latest,
        combinedTranscript: p.combined,
        booking: p.booking,
        nextStep: { type: 'no_slots', safeBaseMessage: honestNoWide },
        userFrustrated: p.hadFrustration,
        businessName: p.tenantDisplayName,
      });
      return {
        handled: true,
        persistMetadata: nextMeta,
        replyPlan: plan(p.withTone(composed), 'booking_no_slots_wide_empty'),
        routing: stubRouting(),
      };
    }

    const crmTz = slotFetch.crmTimezoneUsed?.trim() || 'UTC';
    const { ranked: top } = rankSlotsForBookingOffer(slotFetch.slots, {
      crmTimeZone: crmTz,
      max: 5,
    });
    const top3 = top.slice(0, 3);
    if (top3.length === 0) {
      const nextMeta = mergeBookingIntoConversationMetadata(p.prevMeta, { ...p.booking, status: 'collecting_details' });
      const composed = await this.composeBookingCustomerReply({
        tenantId: p.tenantId,
        conversationId: p.conversationId,
        latestInboundText: p.latest,
        combinedTranscript: p.combined,
        booking: p.booking,
        nextStep: { type: 'no_slots', safeBaseMessage: honestNoWide },
        userFrustrated: p.hadFrustration,
        businessName: p.tenantDisplayName,
      });
      return {
        handled: true,
        persistMetadata: nextMeta,
        replyPlan: plan(p.withTone(composed), 'booking_no_slots_wide_empty'),
        routing: stubRouting(),
      };
    }

    const offered: AisbpOfferedSlot[] = top3.map((s, i) => ({
      option: i + 1,
      startIso: s.startTime,
      endIso: slotEndIso(s, p.booking.slotDurationMinutes ?? 30),
      displayText: formatSlotLabel(s.startTime, slotFetch.crmTimezoneUsed),
      calendarId: p.booking.calendarId,
    }));

    p.booking.noSlotsForDateYmd = undefined;
    p.booking.noSlotsWideSearchDone = undefined;

    const displayLines = offered.map(o => o.displayText);
    const body = `I looked a bit further ahead in the live calendar and found these next openings:\n\n${displayLines
      .map((ln, i) => `${i + 1}. ${ln}`)
      .join('\n')}\n\nWhich one would you like me to reserve?`;

    this.logger.log(
      `bookingSlotsOffered ${JSON.stringify({
        tenantId: p.tenantId,
        conversationId: p.conversationId,
        count: offered.length,
        date: pd,
        reason: 'no_slots_wide_followup',
      })}`,
    );

    const nextMeta = mergeBookingIntoConversationMetadata(p.prevMeta, {
      ...p.booking,
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

    const composedOffer = await this.composeBookingCustomerReply({
      tenantId: p.tenantId,
      conversationId: p.conversationId,
      latestInboundText: p.latest,
      combinedTranscript: p.combined,
      booking: p.booking,
      nextStep: buildOfferSlotsComposerStep(body, offered),
      userFrustrated: p.hadFrustration,
      businessName: p.tenantDisplayName,
    });

    return {
      handled: true,
      persistMetadata: nextMeta,
      replyPlan: plan(p.withTone(composedOffer), 'booking_slots_offered_wide'),
      routing: stubRouting(),
    };
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

  private isBareOfferedSlotIndexLine(latestInboundText: string, offeredSlots?: AisbpOfferedSlot[]): boolean {
    if (!offeredSlots?.length) return false;
    const latestClean = stripBookingFrustrationForParse(latestInboundText.replace(/\s+/g, ' ').trim()).cleaned;
    if (!/^[123]$/.test(latestClean)) return false;
    const n = parseInt(latestClean, 10);
    return offeredSlots.some(o => o.option === n);
  }

  private async composeBookingCustomerReply(p: {
    tenantId: string;
    conversationId: string;
    latestInboundText: string;
    combinedTranscript: string;
    booking: AisbpBookingStateV1;
    nextStep: BookingReplyComposerNextStep;
    userFrustrated: boolean;
    businessName?: string;
  }): Promise<string> {
    if (p.nextStep.fieldId === BATCH_DETAILS_PENDING_ID) {
      return p.nextStep.safeBaseMessage;
    }
    if (p.nextStep.type === 'confirm_slot') {
      return p.nextStep.safeBaseMessage;
    }
    if (!this.bookingReplyComposer) return p.nextStep.safeBaseMessage;
    return this.bookingReplyComposer.compose({
      tenantId: p.tenantId,
      conversationId: p.conversationId,
      latestInboundText: p.latestInboundText,
      recentTranscript: p.combinedTranscript,
      currentBookingState: this.bookingStateForNluPayload(p.booking),
      nextStep: p.nextStep,
      businessName: p.businessName,
      personaPrompt: undefined,
      userFrustrated: p.userFrustrated,
    });
  }

  private bookingStateForNluPayload(booking: AisbpBookingStateV1): Record<string, unknown> {
    return {
      status: booking.status,
      service: booking.service ?? null,
      preferredDate: booking.preferredDate ?? null,
      preferredTime: booking.preferredTime ?? null,
      preferredTimeWindow: booking.preferredTimeWindow ?? null,
      firstVisit: booking.firstVisit ?? null,
      customAnswerKeys: booking.customAnswers ? Object.keys(booking.customAnswers) : [],
      hasCustomerName: Boolean(booking.customerName?.trim()),
      hasPhone: Boolean(booking.phone?.trim()),
      hasEmail: Boolean(booking.email?.trim()),
    };
  }

  private buildBookingNluInterpretInput(params: {
    tenantId: string;
    conversationId: string;
    latest: string;
    combined: string;
    booking: AisbpBookingStateV1;
    settings: TenantBookingSettingsDto;
    crmTimezone: string;
  }): BookingNluInterpretInput {
    const { tenantId, conversationId, latest, combined, booking, settings, crmTimezone } = params;
    const requiredMissing = this.listRequiredMissingFieldIds(settings, booking);
    const customFieldDefs = settings.customFieldsJson.map(cf => ({
      id: cf.id,
      label: cf.label,
      fieldType: cf.fieldType,
      required: cf.required,
      options: cf.options,
    }));
    return {
      tenantId,
      conversationId,
      latestInboundText: latest,
      transcript: combined,
      booking: this.bookingStateForNluPayload(booking),
      settingsSummary: {
        bookingMode: settings.bookingMode,
        coreRequired: requiredMissing,
        customFieldDefs,
      },
      pendingFieldId: booking.pendingFieldId ?? null,
      requiredMissing,
      serviceMenuOptions: settings.serviceMenuOptions,
      crmTimezone,
      offeredSlots:
        booking.status === 'offered_slots' && booking.offeredSlots?.length
          ? booking.offeredSlots.map(o => ({
              option: o.option,
              displayText: o.displayText,
              startIso: o.startIso,
            }))
          : undefined,
    };
  }

  private clearBookingAskPending(booking: AisbpBookingStateV1): void {
    booking.pendingFieldId = undefined;
    booking.pendingFieldLabel = undefined;
    booking.pendingFieldRequired = undefined;
    booking.pendingBatchFieldIds = undefined;
  }

  /** When NLU (or prior state) already satisfies the pending ask, clear pending so deterministic parse failure does not increment retries. */
  private resolvePendingIfBookingValuesFilled(
    booking: AisbpBookingStateV1,
    settings: TenantBookingSettingsDto,
  ): { cleared: boolean; clearedPendingFieldId?: string } {
    const pid = booking.pendingFieldId?.trim();
    if (!pid) return { cleared: false };
    const cleared = (fid: string) => {
      this.clearBookingAskPending(booking);
      return { cleared: true as const, clearedPendingFieldId: fid };
    };
    if (pid === 'service' && isAcceptedBookingServiceValue(booking.service, settings.serviceMenuOptions)) {
      return cleared(pid);
    }
    if (pid === 'preferred_date' && booking.preferredDate?.trim()) {
      return cleared(pid);
    }
    if (pid === 'preferred_time') {
      const hm = booking.preferredTime?.trim();
      const win = booking.preferredTimeWindow?.trim();
      if (hm || (win && win !== 'exact')) {
        return cleared(pid);
      }
    }
    if (pid === 'name' && booking.customerName?.trim()) {
      return cleared(pid);
    }
    if (pid === 'phone' && booking.phone?.trim()) {
      return cleared(pid);
    }
    if (pid === 'email' && booking.email?.trim()) {
      return cleared(pid);
    }
    if (pid === 'first_visit' && booking.firstVisit?.trim()) {
      return cleared(pid);
    }
    if (pid === BATCH_DETAILS_PENDING_ID) {
      if (listBatchDetailsMissingFieldIds(settings, booking).length === 0) {
        return cleared(pid);
      }
      return { cleared: false };
    }
    if (pid.startsWith('custom:')) {
      const id = pid.slice('custom:'.length);
      const ans = booking.customAnswers?.[id]?.trim();
      if (!ans) return { cleared: false };
      const cf = settings.customFieldsJson.find(c => c.id === id);
      if (cf?.fieldType === 'single_select' || cf?.fieldType === 'single_choice') {
        const m = matchUserLineToMenuOption(ans, cf.options);
        if (m && !customSelectAnswerIsWholeOptionList(m, cf.options)) {
          return cleared(pid);
        }
        return { cleared: false };
      }
      return cleared(pid);
    }
    return { cleared: false };
  }

  private copyFinalRequiredFieldAsk(nextAsk: string, settings: TenantBookingSettingsDto): string {
    if (nextAsk.startsWith('custom:')) {
      const cid = nextAsk.slice('custom:'.length);
      const cf = settings.customFieldsJson.find(c => c.id === cid);
      return copyRequiredFieldPoliteFinal(cf?.label);
    }
    switch (nextAsk as BookingCoreFieldKey) {
      case 'name':
        return copyRequiredFieldPoliteFinal('the booking name');
      case 'phone':
        return copyRequiredFieldPoliteFinal('a contact number');
      case 'email':
        return copyRequiredFieldPoliteFinal('your email address');
      case 'service':
        return copyRequiredFieldPoliteFinal('the service you want');
      case 'preferred_date':
        return copyRequiredFieldPoliteFinal('the date you prefer');
      case 'preferred_time':
        return copyRequiredFieldPoliteFinal('your preferred time');
      case 'first_visit':
        return copyRequiredFieldPoliteFinal('whether this is your first visit');
      default:
        return copyRequiredFieldCannotSkip();
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
