import type { MemoryEntry } from '../modules/orchestration/dto';

const NAME_REQUEST_RE = /\b(?:what(?:'|’)?s|what is|may i (?:have|know)|could you (?:share|tell me))\s+your\s+name\b|\byour name\s*\?/i;
const AFTER_NAME_HEADING_RE = /^\s*after\s+the\s+name\s*:\s*$/im;
const NEXT_MAJOR_HEADING_RE = /^\s*[A-Z][A-Z0-9 /&'’()–—-]{2,}\s*$/;
const NAME_ONLY_RE = /^[\p{L}][\p{L}\p{M}'’.-]*(?:[ ]+[\p{L}][\p{L}\p{M}'’.-]*){0,3}$/u;
const NON_NAME_CONTROL_RE = /^(?:stop|unsubscribe|cancel|opt[ -]?out|human|agent|staff|operator|help|price|pricing|book|booking|yes|no|ok|okay)$/i;

export interface MandatoryAfterNameRoute {
  customerName: string;
  replyText: string;
}

export function extractConfiguredAfterNameReply(salesPlaybook: string): string | null {
  const text = salesPlaybook.trim();
  if (!text) return null;
  const heading = AFTER_NAME_HEADING_RE.exec(text);
  if (!heading) return null;

  const following = text.slice(heading.index + heading[0].length).split(/\r?\n/);
  const collected: string[] = [];
  for (const line of following) {
    if (collected.some(part => part.trim()) && NEXT_MAJOR_HEADING_RE.test(line.trim())) break;
    collected.push(line);
  }
  const reply = collected.join('\n').trim();
  return reply.length > 0 && reply.length <= 4_000 ? reply : null;
}

export function resolveMandatoryAfterNameRoute(params: {
  memory: MemoryEntry[];
  latestMessage: string;
  salesPlaybook?: string | null;
}): MandatoryAfterNameRoute | null {
  const latest = params.latestMessage.trim().replace(/\s+/g, ' ');
  if (
    !latest ||
    latest.length > 60 ||
    !NAME_ONLY_RE.test(latest) ||
    NON_NAME_CONTROL_RE.test(latest)
  ) return null;

  const entriesBeforeLatest = params.memory.slice();
  const last = entriesBeforeLatest[entriesBeforeLatest.length - 1];
  if (last?.role === 'user' && last.content.trim() === params.latestMessage.trim()) {
    entriesBeforeLatest.pop();
  }
  const previousVisible = [...entriesBeforeLatest].reverse().find(entry => entry.content.trim().length > 0);
  if (previousVisible?.role !== 'assistant' || !NAME_REQUEST_RE.test(previousVisible.content)) return null;

  const configured = extractConfiguredAfterNameReply(params.salesPlaybook ?? '');
  if (!configured) return null;
  const rendered = configured.replace(/\[Name\]/gi, latest);
  return { customerName: latest, replyText: rendered };
}
