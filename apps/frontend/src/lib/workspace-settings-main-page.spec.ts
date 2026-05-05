import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const generalPath = join(__dirname, '../components/app/tenant-workspace/TenantSettingsGeneralContent.tsx');
const shellPath = join(__dirname, '../components/app/tenant-workspace/TenantSettingsShell.tsx');

describe('workspace settings main page (source guard)', () => {
  it('does not show model override or raw temperature on the general settings screen', () => {
    const general = readFileSync(generalPath, 'utf8');
    expect(general).not.toMatch(/Model override/i);
    expect(general).not.toMatch(/String\(promptConfigSnap\.temperature\)/);
  });

  it('does not show model override on the settings shell quick view', () => {
    const shell = readFileSync(shellPath, 'utf8');
    expect(shell).not.toMatch(/MODEL/i);
    expect(shell).not.toMatch(/modelOverride/i);
  });
});
