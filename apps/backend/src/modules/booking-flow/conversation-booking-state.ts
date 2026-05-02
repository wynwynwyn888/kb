/** Live booking state in `conversations.metadata.aisbp_booking` (channel-agnostic). */

export const AISBP_BOOKING_METADATA_KEY = 'aisbp_booking';

export type AisbpBookingStatus =
  | 'collecting_details'
  | 'offered_slots'
  | 'creating'
  | 'confirmed'
  | 'failed';

export interface AisbpOfferedSlot {
  option: number;
  startIso: string;
  endIso: string;
  displayText: string;
  calendarId: string;
}

export type AisbpCustomAnswers = Record<string, string>;

export interface AisbpBookingStateV1 {
  status: AisbpBookingStatus;
  version: number;
  calendarId: string;
  /** Mirrors tenant booking mode when session started (observability). */
  bookingMode?: string;
  service?: string;
  customerName?: string;
  phone?: string;
  email?: string;
  firstVisit?: string;
  preferredDate?: string;
  preferredTime?: string;
  customAnswers?: AisbpCustomAnswers;
  /** Next inbound line is interpreted as an answer to this field (`name`, `preferred_date`, or `custom:<id>`). */
  pendingFieldId?: string;
  pendingFieldLabel?: string | null;
  pendingFieldRequired?: boolean;
  lastAskedFieldId?: string | null;
  lastAskedAt?: string | null;
  /** Hash of the last outbound booking question (duplicate suppression). */
  lastQuestionFingerprint?: string | null;
  offeredSlots?: AisbpOfferedSlot[];
  lastOfferedAt?: string;
  selectedSlot?: AisbpOfferedSlot;
  appointmentId?: string;
  bookingConfirmedAt?: string;
  /** Slot duration minutes observed from calendar (optional). */
  slotDurationMinutes?: number;
  /** Last appointment create error (customer-safe string). */
  lastError?: string;
  /** @deprecated use lastError — still read for older persisted sessions */
  lastCreateError?: string;
  /** Core keys or `custom:<id>` for optional Ask fields we have already prompted once. */
  optionalAskedFieldIds?: string[];
  /** Core keys or `custom:<id>` the user explicitly skipped (optional Ask only). */
  skippedFieldIds?: string[];
}

export function emptyBookingState(): AisbpBookingStateV1 {
  return {
    status: 'collecting_details',
    version: 1,
    calendarId: '',
  };
}

export function parseAisbpBookingState(metadata: Record<string, unknown> | undefined): AisbpBookingStateV1 | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = metadata[AISBP_BOOKING_METADATA_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const pendingRawEarly = typeof o['pendingFieldId'] === 'string' ? o['pendingFieldId'].trim() : '';
  const status = o['status'];
  const statusOk =
    status === 'collecting_details' ||
    status === 'offered_slots' ||
    status === 'creating' ||
    status === 'confirmed' ||
    status === 'failed';
  const calendarId = typeof o['calendarId'] === 'string' ? o['calendarId'].trim() : '';
  if (!calendarId) return null;
  /** Tolerate missing/legacy `status` while a pending field answer is expected (short replies must still resume the session). */
  let statusResolved: AisbpBookingStatus;
  if (statusOk) {
    statusResolved = status as AisbpBookingStatus;
  } else if (pendingRawEarly) {
    statusResolved = 'collecting_details';
  } else {
    return null;
  }
  const version = typeof o['version'] === 'number' && Number.isFinite(o['version']) ? Math.floor(o['version']) : 1;

  const offeredSlots = Array.isArray(o['offeredSlots'])
    ? (o['offeredSlots'] as unknown[])
        .map((row, i): AisbpOfferedSlot | null => {
          if (!row || typeof row !== 'object') return null;
          const r = row as Record<string, unknown>;
          const startIso = typeof r['startIso'] === 'string' ? r['startIso'] : '';
          const endIso = typeof r['endIso'] === 'string' ? r['endIso'] : '';
          const displayText = typeof r['displayText'] === 'string' ? r['displayText'] : '';
          const cal = typeof r['calendarId'] === 'string' ? r['calendarId'] : calendarId;
          if (!startIso || !displayText) return null;
          const option =
            typeof r['option'] === 'number' && Number.isFinite(r['option']) ? Math.floor(r['option']) : i + 1;
          return {
            option,
            startIso,
            endIso: endIso || startIso,
            displayText,
            calendarId: cal || calendarId,
          };
        })
        .filter((x): x is AisbpOfferedSlot => x !== null)
    : undefined;

  const selected =
    o['selectedSlot'] && typeof o['selectedSlot'] === 'object' && !Array.isArray(o['selectedSlot'])
      ? (() => {
          const r = o['selectedSlot'] as Record<string, unknown>;
          const startIso = typeof r['startIso'] === 'string' ? r['startIso'] : '';
          const endIso = typeof r['endIso'] === 'string' ? r['endIso'] : '';
          const displayText = typeof r['displayText'] === 'string' ? r['displayText'] : '';
          const cal = typeof r['calendarId'] === 'string' ? r['calendarId'] : calendarId;
          const option =
            typeof r['option'] === 'number' && Number.isFinite(r['option']) ? Math.floor(r['option']) : 1;
          if (!startIso || !displayText) return undefined;
          return {
            option,
            startIso,
            endIso: endIso || startIso,
            displayText,
            calendarId: cal || calendarId,
          };
        })()
      : undefined;

  const customAnswers =
    o['customAnswers'] && typeof o['customAnswers'] === 'object' && !Array.isArray(o['customAnswers'])
      ? (o['customAnswers'] as AisbpCustomAnswers)
      : undefined;

  const parseIdList = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const xs = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map(x => x.trim());
    return xs.length ? xs : undefined;
  };
  const optionalAskedFieldIds = parseIdList(o['optionalAskedFieldIds']);
  const skippedFieldIds = parseIdList(o['skippedFieldIds']);

  return {
    status: statusResolved,
    version,
    calendarId,
    service: typeof o['service'] === 'string' ? o['service'] : undefined,
    customerName: typeof o['customerName'] === 'string' ? o['customerName'] : undefined,
    phone: typeof o['phone'] === 'string' ? o['phone'] : undefined,
    email: typeof o['email'] === 'string' ? o['email'] : undefined,
    firstVisit: typeof o['firstVisit'] === 'string' ? o['firstVisit'] : undefined,
    preferredDate: typeof o['preferredDate'] === 'string' ? o['preferredDate'] : undefined,
    preferredTime: typeof o['preferredTime'] === 'string' ? o['preferredTime'] : undefined,
    customAnswers,
    bookingMode: typeof o['bookingMode'] === 'string' ? o['bookingMode'] : undefined,
    pendingFieldId: typeof o['pendingFieldId'] === 'string' ? o['pendingFieldId'] : undefined,
    pendingFieldLabel: typeof o['pendingFieldLabel'] === 'string' ? o['pendingFieldLabel'] : undefined,
    pendingFieldRequired: typeof o['pendingFieldRequired'] === 'boolean' ? o['pendingFieldRequired'] : undefined,
    lastAskedFieldId: typeof o['lastAskedFieldId'] === 'string' ? o['lastAskedFieldId'] : undefined,
    lastAskedAt: typeof o['lastAskedAt'] === 'string' ? o['lastAskedAt'] : undefined,
    lastQuestionFingerprint: typeof o['lastQuestionFingerprint'] === 'string' ? o['lastQuestionFingerprint'] : undefined,
    offeredSlots,
    lastOfferedAt: typeof o['lastOfferedAt'] === 'string' ? o['lastOfferedAt'] : undefined,
    selectedSlot: selected,
    appointmentId: typeof o['appointmentId'] === 'string' ? o['appointmentId'] : undefined,
    bookingConfirmedAt: typeof o['bookingConfirmedAt'] === 'string' ? o['bookingConfirmedAt'] : undefined,
    slotDurationMinutes:
      typeof o['slotDurationMinutes'] === 'number' && Number.isFinite(o['slotDurationMinutes'])
        ? Math.floor(o['slotDurationMinutes'])
        : undefined,
    lastError: typeof o['lastError'] === 'string' ? o['lastError'] : typeof o['lastCreateError'] === 'string' ? o['lastCreateError'] : undefined,
    lastCreateError:
      typeof o['lastCreateError'] === 'string'
        ? o['lastCreateError']
        : typeof o['lastError'] === 'string'
          ? o['lastError']
          : undefined,
    optionalAskedFieldIds,
    skippedFieldIds,
  };
}

/**
 * Raw metadata indicates an in-progress live booking session that should accept short replies
 * (yes/no/skip/name/phone) without fresh booking keywords in the inbound text.
 */
export function hasAisbpBookingFlowContinuation(metadata: Record<string, unknown> | undefined): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  const raw = metadata[AISBP_BOOKING_METADATA_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  const calendarId = typeof o['calendarId'] === 'string' ? o['calendarId'].trim() : '';
  if (!calendarId) return false;
  const status = o['status'];
  const okStatus =
    status === 'collecting_details' || status === 'offered_slots' || status === 'creating';
  const pid = typeof o['pendingFieldId'] === 'string' ? o['pendingFieldId'].trim() : '';
  return okStatus || Boolean(pid);
}

export function mergeBookingIntoConversationMetadata(
  prev: Record<string, unknown>,
  booking: AisbpBookingStateV1,
): Record<string, unknown> {
  return {
    ...prev,
    [AISBP_BOOKING_METADATA_KEY]: { ...booking },
  };
}

export function stripAisbpBookingFromMetadata(prev: Record<string, unknown>): Record<string, unknown> {
  const next = { ...prev };
  delete next[AISBP_BOOKING_METADATA_KEY];
  return next;
}
