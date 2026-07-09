import { createHash } from 'node:crypto';
import type { RichTextChunkSpec } from './kb-section-chunking';

export const WEBSITE_KNOWLEDGE_CARD_VERSION = 1;

export const WEBSITE_KNOWLEDGE_CARD_CHUNK_TYPES = [
  'product_overview',
  'faq',
  'feature',
  'objection_handling',
  'industry_use_case',
  'roi_claim',
  'pricing_claim',
  'cta',
  'process',
  'comparison',
  'qualification',
  'policy',
  'unknown',
] as const;

export type WebsiteKnowledgeCardChunkType = typeof WEBSITE_KNOWLEDGE_CARD_CHUNK_TYPES[number];

export interface WebsiteKnowledgeCard {
  tenantId?: string;
  sourceUrl: string;
  pageTitle: string;
  section: string;
  chunkType: WebsiteKnowledgeCardChunkType;
  title: string;
  canonicalQuestion?: string;
  directAnswer: string;
  supportingPoints: string[];
  doSay: string[];
  doNotSay: string[];
  claimsOrNumbers: string[];
  disclaimers: string[];
  intentTags: string[];
  audienceTags: string[];
  priority: number;
  confidence: number;
  sourceHash: string;
  lastCrawledAt: string;
  qualityScore: number;
}

export interface WebsiteKnowledgeCardBuildResult {
  cards: WebsiteKnowledgeCard[];
  rejected: Array<{ reason: string; title: string; chunkType: WebsiteKnowledgeCardChunkType; hash: string }>;
  cleanedLineCount: number;
}

const MARKETING_CLAIM_DISCLAIMER =
  'Treat as a marketing claim or scenario assumption; results vary depending on industry, offer, traffic quality, and implementation.';

const UI_LINE_RE = /\b(menu|login|log in|sign in|sign up|privacy policy|terms|cookie|accept all|reject all|subscribe|copyright|all rights reserved|follow us|facebook|instagram|linkedin|youtube|skip to|toggle|search|close|open|back to top)\b/i;
const CTA_RE = /\b(book (a )?(demo|call|appointment|consultation)|get started|start now|contact us|talk to|try it|request demo|schedule|enquire|enquiry|learn more)\b/i;
const QUESTION_RE = /\?\s*$/;

function hashText(input: string): string {
  return createHash('sha256').update(normalizeForHash(input), 'utf8').digest('hex');
}

function normalizeForHash(input: string): string {
  return input
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^a-z0-9%$]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueStrings(values: string[], max = values.length): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.replace(/\s+/g, ' ').trim();
    if (!trimmed) continue;
    const key = normalizeForHash(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

function isMostlyUiLine(line: string): boolean {
  const text = line.trim();
  if (!text) return true;
  if (UI_LINE_RE.test(text)) return true;
  if (text.length <= 2) return true;
  if (/^[\W_]+$/.test(text)) return true;
  if (/^\d+\s*$/.test(text)) return true;
  return false;
}

export function cleanWebsiteTextForKnowledgeCards(text: string): string[] {
  const raw = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of raw) {
    if (isMostlyUiLine(line)) continue;
    const key = normalizeForHash(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

function looksLikeHeading(line: string, next?: string): boolean {
  if (!line || QUESTION_RE.test(line)) return true;
  if (line.length > 90) return false;
  if (line.endsWith(':')) return true;
  const words = line.split(/\s+/).length;
  if (words <= 7 && next && next.length > 70) return true;
  if (words <= 6 && /^[A-Z0-9 &+/-]+$/.test(line)) return true;
  return false;
}

function sectionize(lines: string[]): Array<{ title: string; body: string[] }> {
  const sections: Array<{ title: string; body: string[] }> = [];
  let current: { title: string; body: string[] } | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const next = lines[i + 1];
    if (looksLikeHeading(line, next)) {
      if (current && current.body.length > 0) sections.push(current);
      current = { title: line.replace(/:$/, '').trim(), body: [] };
      continue;
    }
    if (!current) current = { title: 'Overview', body: [] };
    current.body.push(line);
  }
  if (current && current.body.length > 0) sections.push(current);
  return sections;
}

function classifyChunkType(title: string, body: string): WebsiteKnowledgeCardChunkType {
  const text = `${title}\n${body}`.toLowerCase();
  if (CTA_RE.test(text) && /\b(next|interested|get started|book|contact|demo|enquire|enquiry)\b/.test(text)) return 'cta';
  if (QUESTION_RE.test(title)) return 'faq';
  if (/\b(price|pricing|cost|package|plan|fee|subscription|\$|rm|sgd|usd)\b/.test(text)) return 'pricing_claim';
  if (/\b(roi|return on investment|calculator|%|x\b|increase|reduce|save|missed leads|24\/7|seconds?|minutes?)\b/.test(text)) return 'roi_claim';
  if (CTA_RE.test(text)) return 'cta';
  if (/\b(not just|chatbot|human|handover|escalat|compare|comparison|instead of)\b/.test(text)) return 'objection_handling';
  if (/\b(industry|industries|clinic|salon|real estate|education|fitness|agency|restaurant|retail|use case)\b/.test(text)) return 'industry_use_case';
  if (/\b(how it works|setup|step|process|workflow|integrat|connect|install|onboard)\b/.test(text)) return 'process';
  if (/\b(qualif|lead score|budget|timeline|requirements?|fit)\b/.test(text)) return 'qualification';
  if (/\b(refund|guarantee|policy|privacy|terms|contract|compliance)\b/.test(text)) return 'policy';
  if (/\b(whatsapp|sms|follow[- ]?up|appointment|booking|calendar|reply|automation|crm|inbox|feature|support)\b/.test(text)) return 'feature';
  if (/\b(what is|about|platform|software|agent|assistant|sales bot|ai sales)\b/.test(text)) return 'product_overview';
  return 'unknown';
}

function extractClaimsOrNumbers(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  return uniqueStrings(
    sentences.filter((s) => /\b(\d+%|\d+x|\$[\d,]+|rm\s*\d+|sgd\s*\d+|usd\s*\d+|\d+\s*(seconds?|minutes?|hours?|days?)|24\/7|roi)\b/i.test(s)),
    5,
  );
}

function tagsForCard(chunkType: WebsiteKnowledgeCardChunkType, title: string, body: string): string[] {
  const text = `${title} ${body}`.toLowerCase();
  const tags: string[] = [chunkType];
  if (text.includes('whatsapp')) tags.push('whatsapp');
  if (text.includes('sms')) tags.push('sms');
  if (/follow[- ]?up/.test(text)) tags.push('follow_up');
  if (/book|appointment|calendar/.test(text)) tags.push('booking');
  if (/missed lead|lead/.test(text)) tags.push('lead_capture');
  if (/roi|calculator|%|24\/7/.test(text)) tags.push('roi');
  if (/price|pricing|cost|plan/.test(text)) tags.push('pricing');
  if (/industry|clinic|salon|real estate|fitness|restaurant/.test(text)) tags.push('industry');
  return uniqueStrings(tags, 8);
}

function buildQuestion(chunkType: WebsiteKnowledgeCardChunkType, title: string): string | undefined {
  const cleanTitle = title.replace(/\s+/g, ' ').trim();
  if (QUESTION_RE.test(cleanTitle)) return cleanTitle;
  if (chunkType === 'product_overview') return `What is ${cleanTitle}?`;
  if (chunkType === 'feature') return `What does ${cleanTitle} do?`;
  if (chunkType === 'pricing_claim') return `What pricing information is available for ${cleanTitle}?`;
  if (chunkType === 'roi_claim') return `What claim does ${cleanTitle} make?`;
  if (chunkType === 'cta') return `What should the customer do next?`;
  return undefined;
}

function cardPriority(type: WebsiteKnowledgeCardChunkType): number {
  const map: Record<WebsiteKnowledgeCardChunkType, number> = {
    faq: 95,
    product_overview: 90,
    feature: 86,
    objection_handling: 84,
    pricing_claim: 82,
    roi_claim: 78,
    industry_use_case: 76,
    process: 72,
    policy: 70,
    qualification: 68,
    comparison: 66,
    cta: 54,
    unknown: 35,
  };
  return map[type];
}

function qualityGate(card: WebsiteKnowledgeCard): { ok: boolean; reason?: string } {
  const joined = [card.title, card.directAnswer, ...card.supportingPoints].join(' ');
  const normalized = normalizeForHash(joined);
  if (normalized.length < 50 && card.chunkType !== 'cta') return { ok: false, reason: 'too_short' };
  if (UI_LINE_RE.test(joined) && joined.length < 180) return { ok: false, reason: 'ui_only' };
  if (card.chunkType === 'unknown' && normalized.length < 120) return { ok: false, reason: 'low_value_unknown' };
  if ((card.chunkType === 'roi_claim' || card.chunkType === 'pricing_claim') && card.claimsOrNumbers.length > 0 && card.disclaimers.length === 0) {
    return { ok: false, reason: 'unsupported_claim' };
  }
  return { ok: true };
}

function makeCard(params: {
  sourceUrl: string;
  pageTitle: string;
  title: string;
  section: string;
  chunkType: WebsiteKnowledgeCardChunkType;
  bodyLines: string[];
  lastCrawledAt: string;
}): WebsiteKnowledgeCard {
  const body = uniqueStrings(params.bodyLines, 7);
  const answer = body.slice(0, 3).join(' ').slice(0, 900).trim();
  const claims = extractClaimsOrNumbers([params.title, ...body].join(' '));
  const disclaimers = claims.length > 0 && (params.chunkType === 'roi_claim' || params.chunkType === 'pricing_claim')
    ? [MARKETING_CLAIM_DISCLAIMER]
    : [];
  const confidenceBase = params.chunkType === 'unknown' ? 0.48 : 0.72;
  const confidence = Math.min(0.95, confidenceBase + Math.min(body.length, 4) * 0.04 + (QUESTION_RE.test(params.title) ? 0.08 : 0));
  const sourceHash = hashText(`${params.sourceUrl}\n${params.title}\n${body.join('\n')}`);
  return {
    sourceUrl: params.sourceUrl,
    pageTitle: params.pageTitle,
    section: params.section,
    chunkType: params.chunkType,
    title: params.title.replace(/\s+/g, ' ').trim().slice(0, 180),
    canonicalQuestion: buildQuestion(params.chunkType, params.title),
    directAnswer: answer,
    supportingPoints: body.slice(1, 6),
    doSay: params.chunkType === 'roi_claim' || params.chunkType === 'pricing_claim'
      ? ['Present this as website-provided information, not a guaranteed outcome.']
      : ['Answer using only the approved details in this card.'],
    doNotSay: params.chunkType === 'roi_claim' || params.chunkType === 'pricing_claim'
      ? ['Do not promise exact results, savings, revenue, or pricing beyond the source wording.']
      : ['Do not add details that are not present in this card.'],
    claimsOrNumbers: claims,
    disclaimers,
    intentTags: tagsForCard(params.chunkType, params.title, body.join(' ')),
    audienceTags: tagsForCard(params.chunkType, params.title, body.join(' ')).filter((t) => t === 'industry'),
    priority: cardPriority(params.chunkType),
    confidence,
    sourceHash,
    lastCrawledAt: params.lastCrawledAt,
    qualityScore: Math.round((confidence * 70 + cardPriority(params.chunkType) * 0.3) * 100) / 100,
  };
}

function cardPreference(type: WebsiteKnowledgeCardChunkType): number {
  return cardPriority(type);
}

function dedupeCards(cards: WebsiteKnowledgeCard[]): WebsiteKnowledgeCard[] {
  const byExact = new Map<string, WebsiteKnowledgeCard>();
  for (const card of cards) {
    const key = hashText(`${card.chunkType}\n${card.title}\n${card.canonicalQuestion ?? ''}\n${card.directAnswer}`);
    const prev = byExact.get(key);
    if (!prev || cardPreference(card.chunkType) > cardPreference(prev.chunkType)) byExact.set(key, card);
  }

  const sorted = [...byExact.values()].sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);
  const out: WebsiteKnowledgeCard[] = [];
  for (const card of sorted) {
    const tokens = new Set(normalizeForHash(`${card.title} ${card.directAnswer}`).split(' ').filter((t) => t.length > 3));
    const near = out.some((existing) => {
      const other = new Set(normalizeForHash(`${existing.title} ${existing.directAnswer}`).split(' ').filter((t) => t.length > 3));
      if (tokens.size === 0 || other.size === 0) return false;
      let shared = 0;
      for (const token of tokens) if (other.has(token)) shared += 1;
      const score = shared / Math.min(tokens.size, other.size);
      return score >= 0.82;
    });
    if (!near) out.push(card);
  }
  return out.sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));
}

export function renderWebsiteKnowledgeCardForRetrieval(card: WebsiteKnowledgeCard): string {
  const lines = [
    `Title: ${card.title}`,
    card.canonicalQuestion ? `Canonical question: ${card.canonicalQuestion}` : '',
    `Answer: ${card.directAnswer}`,
    card.supportingPoints.length ? `Supporting points:\n${card.supportingPoints.map((p) => `- ${p}`).join('\n')}` : '',
    card.claimsOrNumbers.length ? `Claims or numbers:\n${card.claimsOrNumbers.map((p) => `- ${p}`).join('\n')}` : '',
    card.disclaimers.length ? `Usage notes:\n${card.disclaimers.map((p) => `- ${p}`).join('\n')}` : '',
    `Intent tags: ${card.intentTags.join(', ')}`,
  ];
  return lines.filter(Boolean).join('\n').trim();
}

export function websiteKnowledgeCardToChunkSpec(card: WebsiteKnowledgeCard): RichTextChunkSpec {
  const content = renderWebsiteKnowledgeCardForRetrieval(card);
  return {
    content,
    tokenCount: Math.max(1, Math.ceil(content.length / 4)),
    metadata: {
      cardVersion: WEBSITE_KNOWLEDGE_CARD_VERSION,
      cardKind: 'website_knowledge_card',
      sourceUrl: card.sourceUrl,
      pageTitle: card.pageTitle,
      sectionTitle: card.section,
      sectionIndex: card.priority,
      sectionPartIndex: 0,
      chunkType: card.chunkType,
      title: card.title,
      canonicalQuestion: card.canonicalQuestion ?? null,
      directAnswer: card.directAnswer,
      supportingPoints: card.supportingPoints,
      doSay: card.doSay,
      doNotSay: card.doNotSay,
      claimsOrNumbers: card.claimsOrNumbers,
      disclaimers: card.disclaimers,
      intentTags: card.intentTags,
      audienceTags: card.audienceTags,
      priority: card.priority,
      confidence: card.confidence,
      sourceHash: card.sourceHash,
      lastCrawledAt: card.lastCrawledAt,
      qualityScore: card.qualityScore,
      documentTitle: card.pageTitle,
      documentUpdatedAt: card.lastCrawledAt,
      updatedAt: card.lastCrawledAt,
      retrievalOptimized: true,
    },
  };
}

export function buildWebsiteKnowledgeCards(params: {
  sourceUrl: string;
  pageTitle: string;
  text: string;
  lastCrawledAt: string;
}): WebsiteKnowledgeCardBuildResult {
  const lines = cleanWebsiteTextForKnowledgeCards(params.text);
  const sections = sectionize(lines);
  const candidates: WebsiteKnowledgeCard[] = [];
  const rejected: WebsiteKnowledgeCardBuildResult['rejected'] = [];

  for (const section of sections) {
    if (section.body.length === 0) continue;
    const title = section.title === 'Overview' ? params.pageTitle : section.title;
    const bodyText = section.body.join(' ');
    const type = classifyChunkType(title, bodyText);
    const card = makeCard({
      sourceUrl: params.sourceUrl,
      pageTitle: params.pageTitle,
      title,
      section: section.title,
      chunkType: type,
      bodyLines: section.body,
      lastCrawledAt: params.lastCrawledAt,
    });
    const gate = qualityGate(card);
    if (gate.ok) candidates.push(card);
    else rejected.push({ reason: gate.reason ?? 'quality_gate', title: card.title, chunkType: card.chunkType, hash: card.sourceHash });
  }

  if (!candidates.some((card) => card.chunkType === 'product_overview') && lines.length > 0) {
    const overview = makeCard({
      sourceUrl: params.sourceUrl,
      pageTitle: params.pageTitle,
      title: params.pageTitle,
      section: 'Overview',
      chunkType: 'product_overview',
      bodyLines: lines.filter((line) => !CTA_RE.test(line)).slice(0, 6),
      lastCrawledAt: params.lastCrawledAt,
    });
    const gate = qualityGate(overview);
    if (gate.ok) candidates.push(overview);
  }

  return {
    cards: dedupeCards(candidates),
    rejected,
    cleanedLineCount: lines.length,
  };
}
