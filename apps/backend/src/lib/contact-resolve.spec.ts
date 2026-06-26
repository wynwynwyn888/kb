import { isPhoneFormattedContactId, resolveContactIdIfPhone, type ContactResolveResult } from './contact-resolve';
import type { SupabaseClient } from '@supabase/supabase-js';

function mockSupabase(resolveResult: 'success' | 'noMatch' | 'noCredentials' | 'apiError' | 'decryptFail' = 'success'): SupabaseClient {
  const maybeSingle = jest.fn();
  if (resolveResult === 'noCredentials') {
    maybeSingle.mockResolvedValue({ data: null, error: null });
  } else if (resolveResult === 'decryptFail') {
    maybeSingle.mockResolvedValue({ data: { private_token_encrypted: 'invalid' }, error: null });
  } else {
    maybeSingle.mockResolvedValue({ data: { private_token_encrypted: 'bWFzaw==' }, error: null });
  }
  return {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle }) }) }),
      }),
    }),
  } as unknown as SupabaseClient;
}

// Mock encrypt/decrypt and GHL client
jest.mock('./encryption', () => ({ decrypt: jest.fn(() => 'mock-token') }));
jest.mock('@aisbp/ghl-client', () => ({
  createGhlClient: jest.fn(() => ({
    findContactByPhone: jest.fn(async (_loc: string, _phone: string) => {
      if (process.env['CONTACT_RESOLVE_TEST_MODE'] === 'noMatch') return { success: true, contact: undefined };
      if (process.env['CONTACT_RESOLVE_TEST_MODE'] === 'apiError') return { success: false, error: 'API error' };
      return { success: true, contact: { id: 'ghl_internal_abc', phone: '+6588658634' } };
    }),
  })),
}));

describe('contact-resolve', () => {
  describe('isPhoneFormattedContactId', () => {
    it('returns true for +6588658634', () => {
      expect(isPhoneFormattedContactId('+6588658634')).toBe(true);
    });
    it('returns true for +1234567890', () => {
      expect(isPhoneFormattedContactId('+1234567890')).toBe(true);
    });
    it('returns false for GHL UUID kfmh8xHdo4KFVLO43BWI', () => {
      expect(isPhoneFormattedContactId('kfmh8xHdo4KFVLO43BWI')).toBe(false);
    });
    it('returns false for short number +123', () => {
      expect(isPhoneFormattedContactId('+123')).toBe(false);
    });
    it('returns false for empty string', () => {
      expect(isPhoneFormattedContactId('')).toBe(false);
    });
  });

  describe('resolveContactIdIfPhone', () => {
    it('returns original for non-phone contactId', async () => {
      const r = await resolveContactIdIfPhone(mockSupabase(), 't1', 'loc1', 'kfmh8xHdo4KFVLO43BWI');
      expect(r.resolvedContactId).toBe('kfmh8xHdo4KFVLO43BWI');
      expect(r.wasResolved).toBe(false);
    });

    it('returns original when no credentials found', async () => {
      const r = await resolveContactIdIfPhone(mockSupabase('noCredentials'), 't1', 'loc1', '+6588658634');
      expect(r.resolvedContactId).toBe('+6588658634');
      expect(r.wasResolved).toBe(false);
    });

    it('returns resolved GHL ID when phone matches', async () => {
      const r = await resolveContactIdIfPhone(mockSupabase(), 't1', 'loc1', '+6588658634');
      expect(r.resolvedContactId).toBe('ghl_internal_abc');
      expect(r.wasResolved).toBe(true);
      expect(r.originalContactId).toBe('+6588658634');
    });

    it('returns original when GHL API returns no match', async () => {
      process.env['CONTACT_RESOLVE_TEST_MODE'] = 'noMatch';
      const r = await resolveContactIdIfPhone(mockSupabase(), 't1', 'loc1', '+6588658634');
      expect(r.resolvedContactId).toBe('+6588658634');
      expect(r.wasResolved).toBe(false);
      delete process.env['CONTACT_RESOLVE_TEST_MODE'];
    });

    it('returns original on API error', async () => {
      process.env['CONTACT_RESOLVE_TEST_MODE'] = 'apiError';
      const r = await resolveContactIdIfPhone(mockSupabase(), 't1', 'loc1', '+6588658634');
      expect(r.resolvedContactId).toBe('+6588658634');
      expect(r.wasResolved).toBe(false);
      delete process.env['CONTACT_RESOLVE_TEST_MODE'];
    });

    it('resolves phone with leading/trailing whitespace', async () => {
      const r = await resolveContactIdIfPhone(mockSupabase(), 't1', 'loc1', '  +6588658634  ');
      expect(r.resolvedContactId).toBe('ghl_internal_abc');
      expect(r.wasResolved).toBe(true);
    });
  });
});
