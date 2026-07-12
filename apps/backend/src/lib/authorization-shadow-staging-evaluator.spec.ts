import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('authorization shadow staging evaluator', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/scripts/evaluate-authorization-shadow-memberships.ts'),
    'utf8',
  );

  it('hard refuses production and any Supabase project except designated staging', () => {
    expect(source).toContain("const STAGING_REF = 'tuxbrerxmhnotcfrmzct'");
    expect(source).toContain("process.env['NODE_ENV'] === 'production'");
    expect(source).toContain('new URL(url).hostname');
    expect(source).toContain('hostname !== `${STAGING_REF}.supabase.co`');
  });

  it('outputs aggregate counters and does not print identifiers', () => {
    expect(source).toContain('contentFree: true');
    expect(source).toContain('disagreementsByAgencyRole');
    expect(source).not.toContain('console.log(profileId');
    expect(source).not.toContain('console.log(tenantId');
  });
});
