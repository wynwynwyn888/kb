import { describe, expect, it } from 'vitest';
import {
  assistantProfileSetupLabel,
  CLIENT_SELECTABLE_BOT_MODES,
  formatWorkspaceSettingsDateTime,
  replyStyleLabelFromTemperature,
  SUGGESTIVE_MODE_NOTICE,
} from './workspace-settings-display';

describe('workspace-settings-display', () => {
  it('does not expose suggestive as a selectable client option', () => {
    expect(CLIENT_SELECTABLE_BOT_MODES).toEqual(['off', 'autopilot']);
    expect(CLIENT_SELECTABLE_BOT_MODES).not.toContain('suggestive');
  });

  it('maps reply temperature 0.7 to Balanced (not raw number)', () => {
    expect(replyStyleLabelFromTemperature(0.7)).toBe('Balanced');
  });

  it('maps boundary temperatures to expected labels', () => {
    expect(replyStyleLabelFromTemperature(0.3)).toBe('Precise');
    expect(replyStyleLabelFromTemperature(0.3000001)).toBe('Balanced');
    expect(replyStyleLabelFromTemperature(0.75)).toBe('Balanced');
    expect(replyStyleLabelFromTemperature(0.7500001)).toBe('Creative');
  });

  it('formats CRM timestamp in a human-readable way (not raw ISO)', () => {
    const s = formatWorkspaceSettingsDateTime('2026-04-26T11:35:59.387Z');
    expect(s).not.toMatch(/T\d{2}:\d{2}:\d{2}/);
    expect(s).not.toBe('2026-04-26T11:35:59.387Z');
    expect(s.length).toBeGreaterThan(4);
  });

  it('documents suggestive notice for internal-safe UI', () => {
    expect(SUGGESTIVE_MODE_NOTICE).toContain('review-only');
    expect(SUGGESTIVE_MODE_NOTICE).toContain('agency');
  });

  it('setup summary assistant shows active profile name', () => {
    expect(assistantProfileSetupLabel({ name: 'Celeste', isActive: true })).toBe('Celeste');
    expect(assistantProfileSetupLabel(null)).toBe('No active assistant');
    expect(assistantProfileSetupLabel({ name: 'X', isActive: false })).toBe('Needs setup');
  });
});
