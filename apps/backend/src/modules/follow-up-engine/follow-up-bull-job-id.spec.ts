import { toBullSafeFollowUpJobId } from './follow-up-bull-job-id';

describe('toBullSafeFollowUpJobId', () => {
  it('prefixes UUID and avoids colon-only segments (never embeds ISO timestamps)', () => {
    const id = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
    expect(toBullSafeFollowUpJobId(id)).toBe(`followup-${id}`);
    expect(toBullSafeFollowUpJobId(id)).not.toContain(':');
  });

  it('sanitizes unexpected characters', () => {
    expect(toBullSafeFollowUpJobId('x:y:z')).toBe('followup-x-y-z');
  });
});
