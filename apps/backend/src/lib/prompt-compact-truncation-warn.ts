const lastWarnAtMs = new Map<string, number>();

const COOLDOWN_MS = 5 * 60 * 1000;

export function shouldEmitPromptCompactTruncationWarn(key: string): boolean {
  const now = Date.now();
  const prev = lastWarnAtMs.get(key) ?? 0;
  if (now - prev < COOLDOWN_MS) return false;
  lastWarnAtMs.set(key, now);
  return true;
}

export function promptCompactTruncationWarnKey(tenantId: string, promptConfigId: string | null | undefined): string {
  return `${tenantId}:${promptConfigId ?? 'no-prompt-config'}`;
}
