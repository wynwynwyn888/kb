import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ACTIVE_HOURS_DAY_KEYS,
  BOOKING_CORE_FIELD_KEYS,
  BOOKING_MODES,
  CONFIDENCE_THRESHOLDS,
  CUSTOM_FIELD_TYPES,
  FOLLOW_UP_DELAY_UNITS,
  FOLLOW_UP_STEP_MODES,
  FOLLOW_UP_ACTIVE_HOURS_TIMEZONE_MODES,
  TAG_MATCH_MODES,
  type BookingMode,
  type ConfidenceThreshold,
  type FollowUpActiveHoursTimezoneMode,
  type TagMatchMode,
} from './tenant-automation-constants';

export type CoreFieldToggle = { enabled: boolean; required: boolean };

export function parseCoreFieldsJson(raw: unknown): Record<string, CoreFieldToggle> {
  const allowed = new Set<string>(BOOKING_CORE_FIELD_KEYS);
  const out: Record<string, CoreFieldToggle> = {};
  for (const k of BOOKING_CORE_FIELD_KEYS) {
    out[k] = { enabled: false, required: false };
  }
  if (raw === undefined || raw === null) return out;
  if (typeof raw !== 'object') throw new BadRequestException('coreFieldsJson must be a JSON object');
  const o = raw as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (!allowed.has(key)) throw new BadRequestException(`Unknown core field key: ${key}`);
    const v = o[key];
    if (!v || typeof v !== 'object') throw new BadRequestException(`Invalid core field entry: ${key}`);
    const vo = v as Record<string, unknown>;
    out[key] = {
      enabled: Boolean(vo['enabled']),
      required: Boolean(vo['required']),
    };
  }
  return out;
}

/** @deprecated legacy array-only shape — used only when migrating old rows in services */
export function parseCoreRequiredFieldsJson(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new BadRequestException('coreRequiredFieldsJson must be a JSON array of field keys');
  }
  const allowed = new Set<string>(BOOKING_CORE_FIELD_KEYS);
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== 'string' || !x.trim()) {
      throw new BadRequestException('coreRequiredFieldsJson must contain only non-empty strings');
    }
    const k = x.trim();
    if (!allowed.has(k)) throw new BadRequestException(`Unknown core field key: ${k}`);
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

export interface CustomBookingFieldDto {
  id: string;
  label: string;
  helpText?: string;
  fieldType: string;
  options?: string[];
  required: boolean;
  /** When false, field is not collected and is omitted from staff booking summaries. Default true. */
  enabled?: boolean;
  displayOrder: number;
}

export function parseCustomFieldsJson(raw: unknown): CustomBookingFieldDto[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new BadRequestException('customFieldsJson must be a JSON array');
  }
  const out: CustomBookingFieldDto[] = [];
  const seenIds = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') throw new BadRequestException('Each custom field must be an object');
    const o = item as Record<string, unknown>;
    const id = typeof o['id'] === 'string' && o['id'].trim() ? o['id'].trim() : randomUUID();
    if (seenIds.has(id)) throw new BadRequestException(`Duplicate custom field id: ${id}`);
    seenIds.add(id);
    const label = typeof o['label'] === 'string' ? o['label'].trim() : '';
    if (!label) throw new BadRequestException('Each custom field needs a label');
    const fieldType = typeof o['fieldType'] === 'string' ? o['fieldType'].trim() : '';
    if (!CUSTOM_FIELD_TYPES.includes(fieldType as (typeof CUSTOM_FIELD_TYPES)[number])) {
      throw new BadRequestException(`Invalid fieldType: ${fieldType}`);
    }
    const needsOptions = fieldType === 'single_choice' || fieldType === 'single_select';
    const options = Array.isArray(o['options'])
      ? (o['options'] as unknown[])
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .map((s) => s.trim())
      : undefined;
    if (needsOptions && (!options || options.length === 0)) {
      throw new BadRequestException('single_select / single_choice fields require options');
    }
    const required = Boolean(o['required']);
    const enabled = o['enabled'] === undefined ? true : Boolean(o['enabled']);
    const displayOrder =
      typeof o['displayOrder'] === 'number' && Number.isFinite(o['displayOrder'])
        ? Math.floor(o['displayOrder'])
        : out.length;
    const helpText = typeof o['helpText'] === 'string' ? o['helpText'].trim() : undefined;
    out.push({
      id,
      label,
      helpText: helpText || undefined,
      fieldType,
      options,
      required,
      enabled,
      displayOrder,
    });
  }
  out.sort((a, b) => a.displayOrder - b.displayOrder);
  return out;
}

export function parseBookingMode(raw: unknown): BookingMode {
  if (typeof raw !== 'string' || !BOOKING_MODES.includes(raw as BookingMode)) {
    throw new BadRequestException(`bookingMode must be one of: ${BOOKING_MODES.join(', ')}`);
  }
  return raw as BookingMode;
}

export function parseMatchMode(raw: unknown): TagMatchMode {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new BadRequestException(`matchMode must be one of: ${TAG_MATCH_MODES.join(', ')}`);
  }
  const u = raw.trim().toUpperCase();
  if (TAG_MATCH_MODES.includes(u as TagMatchMode)) return u as TagMatchMode;
  throw new BadRequestException(`matchMode must be one of: ${TAG_MATCH_MODES.join(', ')} (or lowercase)`);
}

export function parseConfidenceThreshold(raw: unknown): ConfidenceThreshold {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new BadRequestException(`confidenceThreshold must be one of: ${CONFIDENCE_THRESHOLDS.join(', ')}`);
  }
  const u = raw.trim().toUpperCase();
  if (CONFIDENCE_THRESHOLDS.includes(u as ConfidenceThreshold)) return u as ConfidenceThreshold;
  throw new BadRequestException(`confidenceThreshold must be one of: ${CONFIDENCE_THRESHOLDS.join(', ')} (or lowercase)`);
}

export function parseKeywordsJson(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new BadRequestException('keywords must be an array of strings');
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== 'string' || !x.trim()) continue;
    const t = x.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  if (out.length > 64) throw new BadRequestException('At most 64 keywords');
  return out;
}

export function parseFollowUpActiveHoursTimezoneMode(raw: unknown): FollowUpActiveHoursTimezoneMode {
  if (raw === undefined || raw === null) return 'BUSINESS';
  if (typeof raw !== 'string' || !raw.trim()) return 'BUSINESS';
  const u = raw.trim().toUpperCase();
  if (FOLLOW_UP_ACTIVE_HOURS_TIMEZONE_MODES.includes(u as FollowUpActiveHoursTimezoneMode)) return u as FollowUpActiveHoursTimezoneMode;
  throw new BadRequestException('activeHoursTimezoneMode must be BUSINESS or CONTACT');
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseActiveHoursWindowsJson(raw: unknown): Record<string, { enabled: boolean; start: string; end: string }> {
  const base: Record<string, { enabled: boolean; start: string; end: string }> = {};
  for (const d of ACTIVE_HOURS_DAY_KEYS) {
    base[d] = { enabled: false, start: '09:00', end: '17:00' };
  }
  if (raw === undefined || raw === null) return base;
  if (typeof raw !== 'object' || raw === null) throw new BadRequestException('activeHoursWindows must be an object');
  const o = raw as Record<string, unknown>;
  for (const d of ACTIVE_HOURS_DAY_KEYS) {
    const v = o[d];
    if (v === undefined) continue;
    if (!v || typeof v !== 'object') throw new BadRequestException(`Invalid window for ${d}`);
    const vo = v as Record<string, unknown>;
    const enabled = Boolean(vo['enabled']);
    const start = typeof vo['start'] === 'string' ? vo['start'].trim() : '09:00';
    const end = typeof vo['end'] === 'string' ? vo['end'].trim() : '17:00';
    if (!HHMM_RE.test(start) || !HHMM_RE.test(end)) throw new BadRequestException(`Invalid time for ${d} (use HH:MM)`);
    base[d] = { enabled, start, end };
  }
  return base;
}

export interface TagRulePatchInput {
  enabled?: boolean;
  autoApply?: boolean;
  ruleName?: string;
  ruleDescription?: string;
  keywords?: string[];
  crmTagId?: string | null;
  crmTagName?: string;
  matchMode?: TagMatchMode;
  confidenceThreshold?: ConfidenceThreshold;
  priority?: number;
}

export function parseTagRulePatch(raw: unknown, opts: { partial: boolean }): TagRulePatchInput {
  if (!raw || typeof raw !== 'object') {
    throw new BadRequestException('Invalid rule body');
  }
  const o = raw as Record<string, unknown>;
  const out: TagRulePatchInput = {};

  if (o['enabled'] !== undefined) out.enabled = Boolean(o['enabled']);
  if (o['autoApply'] !== undefined) out.autoApply = Boolean(o['autoApply']);
  if (o['ruleName'] !== undefined) {
    if (typeof o['ruleName'] !== 'string') throw new BadRequestException('ruleName must be a string');
    out.ruleName = o['ruleName'];
  }
  if (o['ruleDescription'] !== undefined) {
    if (typeof o['ruleDescription'] !== 'string') throw new BadRequestException('ruleDescription must be a string');
    out.ruleDescription = o['ruleDescription'];
  }
  if (o['keywords'] !== undefined) {
    out.keywords = parseKeywordsJson(o['keywords']);
  }
  if (o['crmTagId'] !== undefined) {
    out.crmTagId = o['crmTagId'] === null ? null : String(o['crmTagId']);
  }
  if (o['crmTagName'] !== undefined) {
    if (typeof o['crmTagName'] !== 'string') throw new BadRequestException('crmTagName must be a string');
    out.crmTagName = o['crmTagName'];
  }
  if (o['matchMode'] !== undefined) out.matchMode = parseMatchMode(o['matchMode']);
  if (o['confidenceThreshold'] !== undefined) out.confidenceThreshold = parseConfidenceThreshold(o['confidenceThreshold']);
  if (o['priority'] !== undefined) {
    const p = o['priority'];
    if (typeof p !== 'number' || !Number.isFinite(p)) throw new BadRequestException('priority must be a number');
    out.priority = Math.floor(p);
  }

  if (!opts.partial) {
    if (!out.ruleName?.trim()) throw new BadRequestException('ruleName is required');
    if (!out.ruleDescription?.trim()) throw new BadRequestException('ruleDescription is required');
    if (!out.crmTagName?.trim()) throw new BadRequestException('crmTagName is required');
  }

  return out;
}

export interface FollowUpStepDto {
  stepNumber: number;
  delayAmount: number;
  delayUnit: string;
  mode: string;
  fixedMessage?: string;
  aiInstruction?: string;
  enabled: boolean;
}

export function parseFollowUpSteps(raw: unknown): FollowUpStepDto[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new BadRequestException('steps must be an array');
  if (raw.length > 10) throw new BadRequestException('At most 10 follow-up steps');
  const out: FollowUpStepDto[] = [];
  let n = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') throw new BadRequestException('Each step must be an object');
    const o = item as Record<string, unknown>;
    n += 1;
    const delayRaw = o['delayAmount'];
    if (typeof delayRaw !== 'number' || !Number.isFinite(delayRaw) || delayRaw <= 0) {
      throw new BadRequestException(`Step ${n}: delayAmount must be a positive number`);
    }
    const delayAmount = Math.floor(delayRaw);
    const delayUnit = typeof o['delayUnit'] === 'string' ? o['delayUnit'].trim() : 'hours';
    if (!FOLLOW_UP_DELAY_UNITS.includes(delayUnit as (typeof FOLLOW_UP_DELAY_UNITS)[number])) {
      throw new BadRequestException('delayUnit must be minutes, hours, or days');
    }
    const modeRaw = typeof o['mode'] === 'string' ? o['mode'].trim() : '';
    const modeLower = modeRaw.toLowerCase();
    // Accept legacy values on input, but normalize to canonical API values.
    const mode =
      modeLower === 'fixed' || modeLower === 'fixed_message'
        ? 'fixed_message'
        : modeLower === 'ai' || modeLower === 'ai_decides'
          ? 'ai_decides'
          : '';
    if (!FOLLOW_UP_STEP_MODES.includes(mode as (typeof FOLLOW_UP_STEP_MODES)[number])) {
      throw new BadRequestException('step mode must be fixed_message or ai_decides');
    }
    const enabled = Boolean(o['enabled']);
    const fixedMessage = typeof o['fixedMessage'] === 'string' ? o['fixedMessage'] : undefined;
    const aiInstruction = typeof o['aiInstruction'] === 'string' ? o['aiInstruction'] : undefined;
    if (mode === 'fixed_message' && enabled && !(fixedMessage ?? '').trim()) {
      throw new BadRequestException(`Step ${n}: fixed message required when enabled`);
    }
    if (mode === 'ai_decides' && enabled && !(aiInstruction ?? '').trim()) {
      // Defaulting is applied in the follow-up settings service (so GET-after-PATCH is deterministic).
      throw new BadRequestException(`Step ${n}: AI instruction required when enabled`);
    }
    out.push({
      stepNumber: typeof o['stepNumber'] === 'number' ? Math.floor(o['stepNumber']) : n,
      delayAmount,
      delayUnit,
      mode,
      fixedMessage,
      aiInstruction,
      enabled,
    });
  }
  return out;
}
