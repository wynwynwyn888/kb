/**
 * Detects outbound copy where the assistant promises human / team follow-up.
 * Used to trigger human escalation automation and to preserve (not strip) those lines
 * when escalation may run.
 */

/** Split into rough sentences for phrase checks (period / ! / ?). */
export function splitRoughSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

export function sentenceContainsBotHumanEscalationLanguage(sentence: string): boolean {
  const t = sentence.toLowerCase();
  return (
    t.includes('connect you with the team') ||
    t.includes('connect you to the team') ||
    t.includes('connect you with someone') ||
    t.includes('connect you to someone') ||
    t.includes('speak with the team') ||
    t.includes('speak to the team') ||
    t.includes('speak with someone') ||
    t.includes('speak to someone') ||
    t.includes('talk to the team') ||
    t.includes('talk to someone') ||
    /\bteam will (assist|reach out|contact|follow up|follow-up|get back|help)\b/i.test(sentence) ||
    /\b(team member|someone from (the )?team|a team member)\b.*\b(assist|help|reach out|contact|follow up|follow-up|get back)\b/i.test(
      sentence,
    ) ||
    /\barrange for (a )?(team member|someone)\b/i.test(sentence) ||
    /\b(human agent|representative|real person)\b/i.test(sentence) ||
    (/\b(reach out to you|get back to you|contact you (shortly|soon|directly))\b/i.test(sentence) &&
      (t.includes('team') || t.includes('someone') || t.includes('staff') || t.includes('member')))
  );
}

export function containsBotHumanEscalationLanguage(text: string): boolean {
  const raw = text.trim();
  if (!raw) return false;
  const sentences = splitRoughSentences(raw);
  if (sentences.length === 0) {
    return sentenceContainsBotHumanEscalationLanguage(raw);
  }
  return sentences.some(s => sentenceContainsBotHumanEscalationLanguage(s));
}
