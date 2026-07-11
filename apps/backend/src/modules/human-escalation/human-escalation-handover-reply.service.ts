import { Injectable, Logger } from '@nestjs/common';
import type { MemoryEntry } from '../orchestration/dto/memory-entry';
import { GenerationService } from '../generation/generation.service';

export type HandoverActiveReplyType = 'waiting_time' | 'extra_context' | 'frustration' | 'default';

export type HandoverActiveAiResult = {
  type: HandoverActiveReplyType;
  reply: string;
  confidence: number;
  reason: string;
};

const FALLBACKS: Record<HandoverActiveReplyType, string> = {
  waiting_time: '',
  extra_context: '',
  frustration: '',
  default: '',
};

const MAX_WORDS = 35;
const MIN_CONFIDENCE = 0.65;

const RE_FORBIDDEN = [
  /\bprice(s)?\b/i,
  /\bcost\b/i,
  /\brefund\b/i,
  /\bpolicy\b/i,
  /\bdiagnos(e|is)\b/i,
  /\btreat(ment)?\b/i,
  /\brecommend\b/i,
  /\byou should\b/i,
  /\bbook(ing)?\b/i,
  /\bappointment\b/i,
  /\bpackage\b/i,
  /\bwithin\s+\d+\s*(minute|minutes|min|hour|hours|hr|hrs)\b/i,
  /\bin\s+\d+\s*(minute|minutes|min|hour|hours|hr|hrs)\b/i,
  /\b\d+\s*(minute|minutes|min|hour|hours|hr|hrs)\b/i,
  /\bimmediately\b/i,
  /\bright now\b/i,
  /\bASAP\b/i,
  /\bas an ai\b/i,
  /\bGHL\b/i,
  /\btag\b/i,
  /\bescalat(e|ion)\b/i,
  /\bautomation\b/i,
];

const RE_TEAM_MENTION = /\b(team|someone)\b/i;
const RE_SENT_OR_FLAGGED = /\b(sent|passed|pass\s+this|flagged|notified)\b/i;
const RE_NO_EXACT_TIME = /\b(\d+\s*(minute|minutes|min|hour|hours|hr|hrs)|within|immediately|right now)\b/i;

function safeTrim(s: unknown): string {
  return typeof s === 'string' ? s.trim() : '';
}

function countWords(s: string): number {
  const parts = s.trim().split(/\s+/).filter(Boolean);
  return parts.length;
}

function normalizeTextForNearDup(s: string): string {
  return s
    .toLowerCase()
    .replace(/[“”"]/g, '')
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isNearDuplicate(a: string, b: string): boolean {
  const na = normalizeTextForNearDup(a);
  const nb = normalizeTextForNearDup(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // simple containment / high overlap heuristic
  if (na.length >= 20 && (na.includes(nb) || nb.includes(na))) return true;
  const aSet = new Set(na.split(' '));
  const bSet = new Set(nb.split(' '));
  let inter = 0;
  for (const w of aSet) if (bSet.has(w)) inter++;
  const union = aSet.size + bSet.size - inter;
  const j = union ? inter / union : 0;
  return j >= 0.92;
}

/** Strip latest duplicate customer line so RECENT_CONTEXT excludes LATEST_CUSTOMER_MESSAGE. */
export function buildRecentConversationContextForHandover(
  entries: MemoryEntry[],
  latestInboundText: string,
  maxChars = 4500,
): string {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const target = norm(latestInboundText);
  const copy = [...entries];
  if (target.length > 0 && copy.length > 0) {
    const last = copy[copy.length - 1]!;
    if (last.role === 'user' && norm(last.content) === target) {
      copy.pop();
    }
  }
  const lines: string[] = [];
  for (const e of copy) {
    const raw = (e.content ?? '').trim();
    if (!raw) continue;
    lines.push(`${e.role === 'user' ? 'Customer' : 'Assistant'}: ${raw}`);
  }
  let out = lines.join('\n');
  if (out.length > maxChars) out = out.slice(-maxChars);
  return out;
}

function parseAiJson(raw: string): HandoverActiveAiResult | null {
  const t = raw.trim();
  if (!t) return null;
  const jsonStr = t.startsWith('{') ? t : extractFirstJsonObject(t);
  if (!jsonStr) return null;
  try {
    const obj = JSON.parse(jsonStr) as Partial<HandoverActiveAiResult>;
    const type = obj.type;
    if (type !== 'waiting_time' && type !== 'extra_context' && type !== 'frustration' && type !== 'default') return null;
    const reply = safeTrim(obj.reply);
    const reason = safeTrim(obj.reason) || 'n/a';
    const confidence = typeof obj.confidence === 'number' ? obj.confidence : Number.NaN;
    if (!reply) return null;
    return { type, reply, reason, confidence: Number.isNaN(confidence) ? 0 : confidence };
  } catch {
    return null;
  }
}

function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

function validateReplyText(text: string): { ok: true } | { ok: false; reason: string } {
  const t = text.trim();
  if (!t) return { ok: false, reason: 'empty' };
  if (countWords(t) > MAX_WORDS) return { ok: false, reason: 'too_long' };
  if (RE_NO_EXACT_TIME.test(t)) return { ok: false, reason: 'exact_timing' };
  for (const re of RE_FORBIDDEN) {
    if (re.test(t)) return { ok: false, reason: `forbidden:${String(re)}` };
  }
  // Must indicate team has been notified / request passed
  if (!(RE_TEAM_MENTION.test(t) && RE_SENT_OR_FLAGGED.test(t))) {
    return { ok: false, reason: 'missing_team_notified' };
  }
  return { ok: true };
}

@Injectable()
export class HumanEscalationHandoverReplyService {
  private readonly logger = new Logger(HumanEscalationHandoverReplyService.name);

  constructor(private readonly generation: GenerationService) {}

  getFallback(type: HandoverActiveReplyType): string {
    return FALLBACKS[type];
  }

  /**
   * Controlled AI classification + composition.
   * Returns validated content, or a fallback with reasons.
   */
  async classifyAndCompose(params: {
    tenantId: string;
    conversationId: string;
    latestInboundText: string;
    /** Prior transcript only — latest customer message must be separate for NLU. */
    recentConversationContext?: string;
  }): Promise<{
    selectedType: HandoverActiveReplyType;
    replyText: string;
    confidence: number;
    aiReason: string;
    usedFallback: boolean;
    fallbackReason?: string;
  }> {
    const { tenantId, conversationId, latestInboundText, recentConversationContext } = params;
    this.logger.log(
      `humanEscalationHandoverReplyStarted ${JSON.stringify({
        tenantId,
        conversationId,
      })}`,
    );

    const systemPrompt =
      'You are a handover-active responder. The customer already asked for a human. ' +
      'You must NOT answer the customer’s problem or give advice, pricing, booking, or exact timing. ' +
      'Return JSON only. No markdown.';

    const recentTrimmed = (recentConversationContext ?? '').trim().slice(0, 4500);
    const latestTrimmed = latestInboundText.trim().slice(0, 800);

    const incomingMessage = [
      'Return JSON only with keys: type, reply, confidence, reason.',
      'type must be one of: waiting_time, extra_context, frustration, default.',
      `reply must be <= ${MAX_WORDS} words, calm/patient, and MUST confirm the request was sent/passed/flagged to the team.`,
      'reply MUST NOT: give advice, diagnose, recommend services/treatments, discuss pricing/refunds/policy, ask many questions, promise exact timing.',
      'reply MUST NOT mention AI, automation, tags, GHL, internal systems.',
      '',
      'CLASSIFICATION RULES (critical):',
      '- Choose type based primarily on LATEST_CUSTOMER_MESSAGE below — not on older human-request lines inside RECENT_CONTEXT.',
      '- RECENT_CONTEXT is background only and may include a prior “talk to human” request; ignore it when deciding type.',
      '- If LATEST_CUSTOMER_MESSAGE adds product/service/problem/symptom/preference/detail while waiting → extra_context.',
      '- If LATEST_CUSTOMER_MESSAGE asks how long / ETA / when someone responds / waiting → waiting_time.',
      '- Simple greetings or check-ins while waiting (e.g. “hello?”, “anyone there?”) → waiting_time.',
      '- Anger/frustration/rude complaints → frustration.',
      '- Use default only when LATEST_CUSTOMER_MESSAGE is vague or not materially useful (e.g. “ok”, “thanks”).',
      '- If LATEST_CUSTOMER_MESSAGE is code, a terminal/shell command (docker/npm/git), SQL, or server/DevOps jargon → default only; never explain or run it.',
      '',
      `LATEST_CUSTOMER_MESSAGE:\n${latestTrimmed || '(empty)'}`,
      '',
      `RECENT_CONTEXT:\n${recentTrimmed || '(none)'}`,
    ].join('\n');

    let raw: string | null = null;
    try {
      const gen = await this.generation.generateDraft({
        tenantId,
        incomingMessage,
        systemPrompt,
        memory: [],
        kbContext: [],
        temperature: 0,
        maxTokens: 140,
      });
      raw = gen.content ?? null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `humanEscalationHandoverReplyFallback ${JSON.stringify({
          tenantId,
          conversationId,
          reason: 'ai_failure',
          message: msg.slice(0, 120),
        })}`,
      );
      return {
        selectedType: 'default',
        replyText: FALLBACKS.default,
        confidence: 0,
        aiReason: 'ai_failure',
        usedFallback: true,
        fallbackReason: 'ai_failure',
      };
    }

    const parsed = raw ? parseAiJson(raw) : null;
    if (!parsed) {
      this.logger.warn(
        `humanEscalationHandoverReplyFallback ${JSON.stringify({
          tenantId,
          conversationId,
          reason: 'invalid_json',
        })}`,
      );
      return {
        selectedType: 'default',
        replyText: FALLBACKS.default,
        confidence: 0,
        aiReason: 'invalid_json',
        usedFallback: true,
        fallbackReason: 'invalid_json',
      };
    }

    this.logger.log(
      `humanEscalationHandoverReplyAiResult ${JSON.stringify({
        tenantId,
        conversationId,
        type: parsed.type,
        confidence: Number(parsed.confidence.toFixed(3)),
        reason: parsed.reason.slice(0, 80),
      })}`,
    );

    const validation = validateReplyText(parsed.reply);
    if (!validation.ok) {
      this.logger.warn(
        `humanEscalationHandoverReplyFallback ${JSON.stringify({
          tenantId,
          conversationId,
          type: parsed.type,
          confidence: Number(parsed.confidence.toFixed(3)),
          reason: `validation:${validation.reason}`,
        })}`,
      );
      return {
        selectedType: parsed.type,
        replyText: FALLBACKS[parsed.type],
        confidence: parsed.confidence,
        aiReason: parsed.reason,
        usedFallback: true,
        fallbackReason: `validation:${validation.reason}`,
      };
    }

    const lowConfidence = parsed.confidence < MIN_CONFIDENCE;
    if (lowConfidence && parsed.type === 'default') {
      this.logger.warn(
        `humanEscalationHandoverReplyFallback ${JSON.stringify({
          tenantId,
          conversationId,
          type: parsed.type,
          confidence: Number(parsed.confidence.toFixed(3)),
          reason: 'low_confidence_default',
        })}`,
      );
      return {
        selectedType: 'default',
        replyText: FALLBACKS.default,
        confidence: parsed.confidence,
        aiReason: parsed.reason,
        usedFallback: true,
        fallbackReason: 'low_confidence_default',
      };
    }

    if (lowConfidence && (parsed.type === 'extra_context' || parsed.type === 'frustration')) {
      // allowed when it passes strict safety (already validated)
    } else if (lowConfidence) {
      return {
        selectedType: 'default',
        replyText: FALLBACKS.default,
        confidence: parsed.confidence,
        aiReason: parsed.reason,
        usedFallback: true,
        fallbackReason: 'low_confidence',
      };
    }

    this.logger.log(
      `humanEscalationHandoverReplyValidated ${JSON.stringify({
        tenantId,
        conversationId,
        type: parsed.type,
        confidence: Number(parsed.confidence.toFixed(3)),
      })}`,
    );

    return {
      selectedType: parsed.type,
      replyText: parsed.reply.trim(),
      confidence: parsed.confidence,
      aiReason: parsed.reason,
      usedFallback: false,
    };
  }
}
