import type { GhlConnectionStatus, WorkspaceBotMode } from './api';
import { DEFAULT_DISPLAY_TIMEZONE, parseApiInstantMs } from './datetime-display';

/** Bot modes shown as selectable options in client-facing workspace settings (Off / Auto only). */
export const CLIENT_SELECTABLE_BOT_MODES = ['off', 'autopilot'] as const satisfies readonly WorkspaceBotMode[];

export type ClientSelectableBotMode = (typeof CLIENT_SELECTABLE_BOT_MODES)[number];

export function isClientSelectableBotMode(m: WorkspaceBotMode): m is ClientSelectableBotMode {
  return (CLIENT_SELECTABLE_BOT_MODES as readonly string[]).includes(m);
}

/** Short label for status chips and summaries (never "Suggestive" for normal UI). */
export function clientAiRepliesShortLabel(botMode: WorkspaceBotMode): 'Off' | 'Auto' | 'Review-only' {
  if (botMode === 'off') return 'Off';
  if (botMode === 'autopilot') return 'Auto';
  return 'Review-only';
}

export function clientAiRepliesDescription(botMode: ClientSelectableBotMode): string {
  if (botMode === 'off') return 'The assistant will not send automatic replies.';
  return 'The assistant replies to customers automatically.';
}

export const SUGGESTIVE_MODE_NOTICE =
  'This workspace uses a review-only mode. Contact your agency to change it.';

/**
 * Maps reply temperature to a client-facing style name.
 * Thresholds: <= 0.3 Precise; > 0.3 and <= 0.75 Balanced; > 0.75 Creative.
 */
export function replyStyleLabelFromTemperature(temperature: number): 'Precise' | 'Balanced' | 'Creative' {
  if (temperature <= 0.3) return 'Precise';
  if (temperature <= 0.75) return 'Balanced';
  return 'Creative';
}

export function ghlLocationDisplayLabel(ghl: Pick<GhlConnectionStatus, 'ghlLocationId' | 'metadata'>): string {
  const raw = ghl.metadata?.['locationName'];
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (name) return name;
  const id = ghl.ghlLocationId?.trim();
  if (id) return id;
  return '—';
}

/** Human-readable date/time for CRM "Last checked" (not raw ISO). */
export function formatWorkspaceSettingsDateTime(iso: string | null | undefined): string {
  if (iso == null || typeof iso !== 'string' || !iso.trim()) return '—';
  const ms = parseApiInstantMs(iso);
  if (ms == null) return '—';
  try {
    return new Intl.DateTimeFormat('en-SG', {
      timeZone: DEFAULT_DISPLAY_TIMEZONE,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(ms));
  } catch {
    return '—';
  }
}

export function crmLastCheckedIso(ghl: GhlConnectionStatus): string | null {
  return ghl.lastHealthCheckAt?.trim() || ghl.verifiedAt?.trim() || null;
}

export function clientCrmStatusSummary(ghl: GhlConnectionStatus): 'Connected' | 'Not connected' | 'Needs setup' | 'Needs review' {
  if (ghl.status === 'CONNECTED') return 'Connected';
  if (ghl.status === 'DISCONNECTED') return ghl.connected ? 'Needs review' : 'Not connected';
  if (ghl.status === 'INVALID' || ghl.status === 'ERROR') return 'Needs setup';
  return 'Needs review';
}

export type KnowledgeSetupStatus = 'ready' | 'empty' | 'unknown';

export function knowledgeSetupLabel(status: KnowledgeSetupStatus): string {
  if (status === 'ready') return 'Ready';
  if (status === 'empty') return 'No knowledge added';
  return 'Could not load';
}

export function assistantProfileSetupLabel(prompt: { name: string; isActive?: boolean } | null): string {
  if (!prompt?.name?.trim()) return 'No active assistant';
  if (prompt.isActive === false) return 'Needs setup';
  return prompt.name.trim();
}
