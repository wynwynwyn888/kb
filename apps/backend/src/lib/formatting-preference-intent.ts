/**
 * User asked for reply shape (bullets, bold, shorter) — treat as formatting preference, not a capability refusal.
 */
export function userRequestsFormattingPreference(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;

  const patterns: RegExp[] = [
    /\bcan\s+you\s+bold\b/,
    /\bcan\s+u\s+bold\b/,
    /\bcould\s+you\s+bold\b/,
    /\bbold\s+(the\s+)?output\b/,
    /\buse\s+bold\b/,
    /\bformat\s+in\s+bold\b/,
    /\bbullet\s+points?\b/,
    /\bpoint\s+form\b/,
    /\breply\s+in\s+point\s+form\b/,
    /\bmake\s+it\s+shorter\b/,
    /\bshorter\s+reply\b/,
    /\bsplit\s+into\s+shorter\s+messages\b/,
    /\bshorter\s+messages\b/,
  ];

  return patterns.some(p => p.test(t));
}
