import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  BOOKING_CORE_FIELD_KEYS,
  BOOKING_MODES,
  CONFIDENCE_THRESHOLDS,
  CUSTOM_FIELD_TYPES,
  FOLLOW_UP_DELAY_UNITS,
  FOLLOW_UP_STEP_MODES,
  TAG_MATCH_MODES,
  type BookingMode,
  type ConfidenceThreshold,
  type TagMatchMode,
} from './tenant-automation-constants';

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
    const options = Array.isArray(o['options'])
      ? (o['options'] as unknown[])
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .map((s) => s.trim())
      : undefined;
    if (fieldType === 'single_choice' && (!options || options.length === 0)) {
      throw new BadRequestException('single_choice fields require options');
    }
    const required = Boolean(o['required']);
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

export interface TagRulePatchInput {
  enabled?: boolean;
  autoApply?: boolean;
  ruleName?: string;
  ruleDescription?: string;
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
  if (raw.length > 5) throw new BadRequestException('At most 5 follow-up steps');
  const out: FollowUpStepDto[] = [];
  let n = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') throw new BadRequestException('Each step must be an object');
    const o = item as Record<string, unknown>;
    n += 1;
    const delayAmount = typeof o['delayAmount'] === 'number' && o['delayAmount'] > 0 ? Math.floor(o['delayAmount']) : 1;
    const delayUnit = typeof o['delayUnit'] === 'string' ? o['delayUnit'].trim() : 'hours';
    if (!FOLLOW_UP_DELAY_UNITS.includes(delayUnit as (typeof FOLLOW_UP_DELAY_UNITS)[number])) {
      throw new BadRequestException('delayUnit must be minutes, hours, or days');
    }
    const mode = typeof o['mode'] === 'string' ? o['mode'].trim() : 'fixed';
    if (!FOLLOW_UP_STEP_MODES.includes(mode as (typeof FOLLOW_UP_STEP_MODES)[number])) {
      throw new BadRequestException('step mode must be fixed or ai');
    }
    const enabled = Boolean(o['enabled']);
    const fixedMessage = typeof o['fixedMessage'] === 'string' ? o['fixedMessage'] : undefined;
    const aiInstruction = typeof o['aiInstruction'] === 'string' ? o['aiInstruction'] : undefined;
    if (mode === 'fixed' && enabled && !(fixedMessage ?? '').trim()) {
      throw new BadRequestException(`Step ${n}: fixed message required when enabled`);
    }
    if (mode === 'ai' && enabled && !(aiInstruction ?? '').trim()) {
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
