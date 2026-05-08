import { describe, expect, it } from 'vitest';
import { safeParseJsonFromResponse } from './api';

describe('safeParseJsonFromResponse', () => {
  it('returns null for empty 200 body', async () => {
    const res = new Response('', { status: 200, headers: { 'content-type': 'application/json' } });
    const parsed = await safeParseJsonFromResponse(res);
    expect(parsed).toBeNull();
  });
});

