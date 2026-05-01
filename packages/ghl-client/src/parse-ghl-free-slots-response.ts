function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

const YMD_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Civil ISO-like instant (widget free-slots often returns offset datetimes). */
const ISO_SLOT_START_LIKE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function isLikelySlotIsoInstant(s: string): boolean {
  const t = s.trim();
  if (!ISO_SLOT_START_LIKE.test(t)) return false;
  const ms = Date.parse(t);
  return Number.isFinite(ms);
}

export interface GhlFreeSlot {
  startTime: string;
  /** Omitted when CRM only returns start instants (e.g. widget ISO string arrays). */
  endTime?: string;
}

export interface GhlFreeSlotsParseOptions {
  /** When set, ISO-only slots get an end instant derived from calendar slot length (never new starts). */
  slotDurationMinutes?: number | null;
}

export interface GhlFreeSlotsParseResult {
  slots: GhlFreeSlot[];
  dateKeys: string[];
  /** Parser classification / extraction path. */
  shapeSummary: string;
  /** Coarse HTTP body classification (before slot extraction). */
  rawResponseShape: string;
  /** Count of string elements in the primary array or list field that look like ISO slot instants. */
  rawIsoStringCount: number;
}

function classifyRawFreeSlotsPayload(raw: unknown): string {
  if (raw === null || raw === undefined) return 'nullish';
  if (Array.isArray(raw)) return `array(len=${raw.length})`;
  if (isRecord(raw)) return 'object';
  return typeof raw;
}

function countIsoLikeStringsInArray(arr: unknown[]): number {
  let n = 0;
  for (const x of arr) {
    if (typeof x === 'string' && isLikelySlotIsoInstant(x)) n += 1;
  }
  return n;
}

function pushIsoSlot(slots: GhlFreeSlot[], iso: string, slotDurationMinutes?: number | null): void {
  const st = iso.trim();
  if (!isLikelySlotIsoInstant(st)) return;
  const dur =
    slotDurationMinutes !== undefined && slotDurationMinutes !== null && slotDurationMinutes > 0
      ? Math.min(slotDurationMinutes, 24 * 60)
      : null;
  if (dur !== null) {
    const startMs = Date.parse(st);
    const endMs = startMs + dur * 60_000;
    if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
      slots.push({ startTime: st, endTime: new Date(endMs).toISOString() });
      return;
    }
  }
  slots.push({ startTime: st });
}

function pushSlotFromRecord(o: Record<string, unknown>, slots: GhlFreeSlot[]): void {
  let start =
    typeof o['startTime'] === 'string'
      ? o['startTime']
      : typeof o['start'] === 'string'
        ? o['start']
        : typeof o['slotStart'] === 'string'
          ? o['slotStart']
          : '';
  let end =
    typeof o['endTime'] === 'string'
      ? o['endTime']
      : typeof o['end'] === 'string'
        ? o['end']
        : typeof o['slotEnd'] === 'string'
          ? o['slotEnd']
          : '';
  if (!start && typeof o['start'] === 'number' && Number.isFinite(o['start'])) {
    start = new Date(o['start']).toISOString();
  }
  if (!end && typeof o['end'] === 'number' && Number.isFinite(o['end'])) {
    end = new Date(o['end']).toISOString();
  }
  if (start && end) slots.push({ startTime: start, endTime: end });
  else if (start) slots.push({ startTime: start });
}

function ingestIsoStringArray(
  arr: unknown[],
  slots: GhlFreeSlot[],
  slotDurationMinutes: number | null | undefined,
): { rawIsoStringCount: number } {
  const rawIsoStringCount = countIsoLikeStringsInArray(arr);
  for (const x of arr) {
    if (typeof x === 'string' && isLikelySlotIsoInstant(x)) pushIsoSlot(slots, x, slotDurationMinutes);
    else if (isRecord(x)) pushSlotFromRecord(x, slots);
  }
  return { rawIsoStringCount };
}

/**
 * GHL free-slots returns many shapes: date-keyed maps, nested arrays, and widget-style flat ISO string arrays.
 */
export function parseGhlFreeSlotsResponse(
  raw: unknown,
  options?: GhlFreeSlotsParseOptions,
): GhlFreeSlotsParseResult {
  const slots: GhlFreeSlot[] = [];
  const dateKeys: string[] = [];
  const rawResponseShape = classifyRawFreeSlotsPayload(raw);
  const slotDur = options?.slotDurationMinutes;

  if (raw === null || raw === undefined) {
    return { slots, dateKeys, shapeSummary: 'nullish', rawResponseShape, rawIsoStringCount: 0 };
  }

  if (Array.isArray(raw)) {
    const isoCount = countIsoLikeStringsInArray(raw);
    const allStrings = raw.every((x) => typeof x === 'string');
    if (allStrings && isoCount === raw.length && raw.length > 0) {
      for (const x of raw) {
        if (typeof x === 'string') pushIsoSlot(slots, x, slotDur);
      }
      return {
        slots,
        dateKeys,
        shapeSummary: 'topLevelIsoStringArray',
        rawResponseShape,
        rawIsoStringCount: isoCount,
      };
    }
    if (isoCount > 0) {
      const { rawIsoStringCount } = ingestIsoStringArray(raw, slots, slotDur);
      return {
        slots,
        dateKeys,
        shapeSummary: 'topLevelMixedIsoStringArray',
        rawResponseShape,
        rawIsoStringCount,
      };
    }
    for (const x of raw) {
      if (isRecord(x)) pushSlotFromRecord(x, slots);
    }
    return {
      slots,
      dateKeys,
      shapeSummary: 'topLevelArray',
      rawResponseShape,
      rawIsoStringCount: 0,
    };
  }

  if (!isRecord(raw)) {
    return {
      slots,
      dateKeys,
      shapeSummary: `primitive:${typeof raw}`,
      rawResponseShape,
      rawIsoStringCount: 0,
    };
  }

  let dateKeyedIsoCount = 0;
  for (const [k, v] of Object.entries(raw)) {
    const dayPrefix = /^(\d{4}-\d{2}-\d{2})/.exec(k);
    if (!dayPrefix) continue;
    dateKeys.push(YMD_KEY.test(k) ? k : dayPrefix[1]!);
    if (Array.isArray(v)) {
      for (const x of v) {
        if (typeof x === 'string' && isLikelySlotIsoInstant(x)) {
          dateKeyedIsoCount += 1;
          pushIsoSlot(slots, x, slotDur);
        } else if (isRecord(x)) pushSlotFromRecord(x, slots);
      }
    } else if (isRecord(v)) {
      const inner = v['slots'] ?? v['freeSlots'] ?? v['data'] ?? v['items'];
      if (Array.isArray(inner)) {
        for (const x of inner) {
          if (typeof x === 'string' && isLikelySlotIsoInstant(x)) {
            dateKeyedIsoCount += 1;
            pushIsoSlot(slots, x, slotDur);
          } else if (isRecord(x)) pushSlotFromRecord(x, slots);
        }
      }
    }
  }
  if (dateKeys.length > 0) {
    return {
      slots,
      dateKeys,
      shapeSummary: 'dateKeyedMap',
      rawResponseShape,
      rawIsoStringCount: dateKeyedIsoCount,
    };
  }

  if (isRecord(raw['calendar'])) {
    return parseGhlFreeSlotsResponse(raw['calendar'], options);
  }

  const list = raw['slots'] ?? raw['availableSlots'] ?? raw['data'] ?? raw['events'] ?? raw['freeSlots'];
  if (Array.isArray(list)) {
    const rawIsoStringCount = countIsoLikeStringsInArray(list);
    const allStrings = list.every((x) => typeof x === 'string');
    if (allStrings && rawIsoStringCount === list.length && list.length > 0) {
      for (const x of list) {
        if (typeof x === 'string') pushIsoSlot(slots, x, slotDur);
      }
      const keyHint =
        Array.isArray(raw['slots'])
          ? 'nestedField:slots'
          : Array.isArray(raw['availableSlots'])
            ? 'nestedField:availableSlots'
            : Array.isArray(raw['data'])
              ? 'nestedField:data'
              : 'nestedField:list';
      return {
        slots,
        dateKeys,
        shapeSummary: 'nestedIsoStringArray',
        rawResponseShape: `${rawResponseShape}|${keyHint}`,
        rawIsoStringCount,
      };
    }
    for (const x of list) {
      if (typeof x === 'string' && isLikelySlotIsoInstant(x)) pushIsoSlot(slots, x, slotDur);
      else if (isRecord(x)) pushSlotFromRecord(x, slots);
    }
    const keyHint =
      Array.isArray(raw['slots'])
        ? 'nestedField:slots'
        : Array.isArray(raw['availableSlots'])
          ? 'nestedField:availableSlots'
          : Array.isArray(raw['data'])
            ? 'nestedField:data'
            : 'nestedField:list';
    return {
      slots,
      dateKeys,
      shapeSummary: rawIsoStringCount > 0 ? 'nestedIsoStringArrayMixed' : 'nestedArrayField',
      rawResponseShape: `${rawResponseShape}|${keyHint}`,
      rawIsoStringCount,
    };
  }

  return {
    slots,
    dateKeys,
    shapeSummary: 'objectUnrecognized',
    rawResponseShape,
    rawIsoStringCount: 0,
  };
}
