import { describe, expect, it } from 'vitest';
import { buildTenantSidebarNav } from './tenant-workspace-nav';

describe('tenant sidebar nav', () => {
  it('shows Assistant children: Profiles, Instructions only', () => {
    const tid = 't_nav';
    const nodes = buildTenantSidebarNav(tid, { showAdvanced: true, showLogs: true });
    const assistant = nodes.find(n => n.kind === 'group' && n.label === 'Assistant');
    if (!assistant || assistant.kind !== 'group') throw new Error('Assistant group missing');
    expect(assistant.children.map(c => c.label)).toEqual(['Profiles', 'Instructions']);
  });

  it('shows Automation as top-level group with Tagging/Follow-up/Human Escalation', () => {
    const tid = 't_nav';
    const nodes = buildTenantSidebarNav(tid, { showAdvanced: true, showLogs: true });
    const automation = nodes.find(n => n.kind === 'group' && n.label === 'Automation');
    if (!automation || automation.kind !== 'group') throw new Error('Automation group missing');
    expect(automation.children.map(c => c.label)).toEqual(['Tagging', 'Follow-up', 'Human Escalation']);
    expect(automation.children[0]?.href).toBe(`/app/tenant/${tid}/automation/tagging`);
  });

  it('hides Advanced when showAdvanced=false', () => {
    const tid = 't_nav';
    const nodes = buildTenantSidebarNav(tid, { showAdvanced: false, showLogs: true });
    expect(nodes.some(n => n.kind === 'leaf' && n.label === 'Advanced')).toBe(false);
  });

  it('hides Logs when showLogs=false', () => {
    const tid = 't_nav';
    const nodes = buildTenantSidebarNav(tid, { showAdvanced: true, showLogs: false });
    expect(nodes.some(n => n.kind === 'leaf' && n.label === 'Logs')).toBe(false);
  });
});

