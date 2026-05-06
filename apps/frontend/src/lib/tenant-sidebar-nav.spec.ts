import { describe, expect, it } from 'vitest';
import { buildTenantSidebarNav } from './tenant-workspace-nav';

describe('tenant sidebar nav', () => {
  it('shows Preview label under Assistant without changing route', () => {
    const tid = 't_nav';
    const nodes = buildTenantSidebarNav(tid, { showAdvanced: true });
    const assistant = nodes.find(n => n.kind === 'group' && n.label === 'Assistant');
    if (!assistant || assistant.kind !== 'group') throw new Error('Assistant group missing');
    const preview = assistant.children.find(c => c.href.endsWith('/assistant/test-bot'));
    expect(preview?.label).toBe('Preview');
  });
});

