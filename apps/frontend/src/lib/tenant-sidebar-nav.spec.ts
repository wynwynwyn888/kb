import { describe, expect, it } from 'vitest';
import { buildTenantSidebarNav } from './tenant-workspace-nav';

describe('tenant sidebar nav', () => {
  it('shows AI Agent children: Profiles, Instructions only', () => {
    const tid = 't_nav';
    const nodes = buildTenantSidebarNav(tid, { showAdvanced: true, showLogs: true });
    const aiAgent = nodes.find(n => n.kind === 'group' && n.label === 'AI Agent');
    if (!aiAgent || aiAgent.kind !== 'group') throw new Error('AI Agent group missing');
    expect(aiAgent.children.map(c => c.label)).toEqual(['Profiles', 'Instructions']);
    expect(aiAgent.overviewHref).toBe(`/app/tenant/${tid}/assistant`);
  });

  it('shows Automation as top-level group with Tagging/Follow-up/Human Escalation', () => {
    const tid = 't_nav';
    const nodes = buildTenantSidebarNav(tid, { showAdvanced: true, showLogs: true });
    const automation = nodes.find(n => n.kind === 'group' && n.label === 'Automation');
    if (!automation || automation.kind !== 'group') throw new Error('Automation group missing');
    expect(automation.children.map(c => c.label)).toEqual(['Tagging', 'Follow-up', 'Human Escalation']);
    expect(automation.overviewHref).toBe(`/app/tenant/${tid}/automation`);
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
