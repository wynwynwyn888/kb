import { resolveInviteAppBaseUrl } from './invitations.service';

describe('resolveInviteAppBaseUrl', () => {
  it('returns trimmed env value (no trailing slash)', () => {
    const url = resolveInviteAppBaseUrl({ INVITE_APP_BASE_URL: 'https://kb.aisalesbot.pro/' } as NodeJS.ProcessEnv);
    expect(url).toBe('https://kb.aisalesbot.pro');
  });

  it('falls back to NEXT_PUBLIC_APP_URL when INVITE_APP_BASE_URL is unset', () => {
    const url = resolveInviteAppBaseUrl({ NEXT_PUBLIC_APP_URL: 'https://app.example.com' } as NodeJS.ProcessEnv);
    expect(url).toBe('https://app.example.com');
  });

  it('throws in production when neither var is set', () => {
    expect(() => resolveInviteAppBaseUrl({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(
      /INVITE_APP_BASE_URL is not set/i,
    );
  });

  it('throws in production when value points to localhost', () => {
    expect(() =>
      resolveInviteAppBaseUrl({ NODE_ENV: 'production', INVITE_APP_BASE_URL: 'http://localhost:3000' } as NodeJS.ProcessEnv),
    ).toThrow(/points to localhost/i);
  });

  it('throws in production when value points to 127.0.0.1', () => {
    expect(() =>
      resolveInviteAppBaseUrl({
        NODE_ENV: 'production',
        INVITE_APP_BASE_URL: 'http://127.0.0.1:3000',
      } as NodeJS.ProcessEnv),
    ).toThrow(/points to localhost/i);
  });

  it('keeps localhost fallback in non-production', () => {
    const url = resolveInviteAppBaseUrl({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    expect(url).toBe('http://localhost:3000');
  });
});
