/**
 * Heuristic guard: block obvious non–Singapore customer-facing languages in outbound replies.
 * Complements the system prompt — catches model drift (e.g. Portuguese booking rewrites).
 */

const DISALLOWED_LANGUAGE_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  {
    id: 'portuguese',
    pattern:
      /\b(você|voce|gostaria|horário|horario|disponível|disponivel|reservasse|reservar|não|nao|obrigad|para o dia|de junho|de janeiro|tem(?:os)?\s+\d)/i,
  },
  {
    id: 'spanish',
    pattern: /\b(usted|gracias|disponible|quiere|reservar|horario|por favor|señor|señora|hola)\b/i,
  },
  {
    id: 'french',
    pattern: /\b(vous|merci|bonjour|disponible|réserver|reserver|horaire|souhaitez)\b/i,
  },
  {
    id: 'arabic_script',
    pattern: /[\u0600-\u06FF]/,
  },
  {
    id: 'hindi_devanagari',
    pattern: /[\u0900-\u097F]/,
  },
  {
    id: 'indonesian',
    pattern: /\b(anda|terima kasih|apakah|bisa|mau|jam berapa|tanggal)\b/i,
  },
  {
    id: 'tagalog',
    pattern: /\b(salamat|po\b|opo\b|kumusta|gusto|pwede)\b/i,
  },
  {
    id: 'japanese',
    pattern: /[\u3040-\u30FF]/,
  },
  {
    id: 'korean',
    pattern: /[\uAC00-\uD7AF]/,
  },
];

/** Allowed scripts: Latin (incl. extended), CJK, Tamil. */
const ALLOWED_SCRIPT =
  /^[\s\p{Script=Latin}\p{Script=Han}\p{Script=Tamil}\p{Number}\p{Punctuation}\p{Symbol}]+$/u;

export function containsDisallowedSingaporeReplyLanguage(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  for (const { pattern } of DISALLOWED_LANGUAGE_PATTERNS) {
    if (pattern.test(t)) return true;
  }

  // Strip common Latin letters/digits/punct and check for unexpected scripts (e.g. Cyrillic).
  const withoutAllowedLatin = t.replace(
    /[\sA-Za-z0-9.,!?;:'"()\-–—/\\@#$%&*+=<>[\]{}|~`^_\u00C0-\u024F]/g,
    '',
  );
  if (withoutAllowedLatin.length > 0 && !ALLOWED_SCRIPT.test(withoutAllowedLatin)) {
    return true;
  }

  return false;
}
