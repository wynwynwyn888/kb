/**
 * How the client workspace handles AI replies. Stored in `tenants.settings.botMode` and
 * kept in sync with `tenants.bot_enabled` (off = disabled; other modes = enabled).
 */
export type BotOperatingMode = 'off' | 'suggestive' | 'autopilot';

const MODES: ReadonlySet<BotOperatingMode> = new Set(['off', 'suggestive', 'autopilot']);

function isMode(x: string): x is BotOperatingMode {
  return MODES.has(x as BotOperatingMode);
}

/**
 * Read effective mode: stored `settings.botMode` wins when valid, else map from `bot_enabled`.
 */
export function resolveBotMode(
  settings: Record<string, unknown> | null | undefined,
  botEnabled: boolean,
): BotOperatingMode {
  const raw = settings && typeof settings['botMode'] === 'string' ? String(settings['botMode']) : '';
  if (isMode(raw)) return raw;
  return botEnabled ? 'autopilot' : 'off';
}

export function isBotModeString(x: unknown): x is BotOperatingMode {
  return typeof x === 'string' && isMode(x);
}
