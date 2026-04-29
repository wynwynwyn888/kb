import {
  buildChatResetContactWhitelist,
  evaluateAllowChatResetCommands,
  isContactAllowedForChatReset,
  resolveAllowChatResetCommands,
} from './chat-reset-tenant-policy';

describe('chat-reset-tenant-policy', () => {
  it('defaults to allow in non-production when unset', () => {
    expect(
      resolveAllowChatResetCommands({ nodeEnv: 'development', envAllow: undefined, tenantSettings: {} }),
    ).toBe(true);
    expect(
      resolveAllowChatResetCommands({ nodeEnv: 'production', envAllow: undefined, tenantSettings: {} }),
    ).toBe(false);
  });

  it('evaluateAllowChatResetCommands: tenant explicit false → tenant_disabled', () => {
    const r = evaluateAllowChatResetCommands({
      nodeEnv: 'production',
      envAllow: 'true',
      tenantSettings: { allowChatResetCommands: false },
    });
    expect(r.allowed).toBe(false);
    expect(r.deniedReason).toBe('tenant_disabled');
  });

  it('evaluateAllowChatResetCommands: tenant missing + env true → allowed', () => {
    const r = evaluateAllowChatResetCommands({
      nodeEnv: 'production',
      envAllow: 'true',
      tenantSettings: {},
    });
    expect(r.allowed).toBe(true);
    expect(r.deniedReason).toBeUndefined();
  });

  it('evaluateAllowChatResetCommands: ALLOW false in production → env_disabled', () => {
    const r = evaluateAllowChatResetCommands({
      nodeEnv: 'production',
      envAllow: 'false',
      tenantSettings: {},
    });
    expect(r.allowed).toBe(false);
    expect(r.deniedReason).toBe('env_disabled');
  });

  it('tenant false overrides env true', () => {
    expect(
      resolveAllowChatResetCommands({
        nodeEnv: 'production',
        envAllow: 'true',
        tenantSettings: { allowChatResetCommands: false },
      }),
    ).toBe(false);
  });

  it('whitelist empty allows any contact', () => {
    expect(isContactAllowedForChatReset('any-id', [])).toBe(true);
  });

  it('whitelist requires match', () => {
    const w = buildChatResetContactWhitelist({
      envContacts: 'abc, def',
      tenantSettings: null,
    });
    expect(isContactAllowedForChatReset('abc', w)).toBe(true);
    expect(isContactAllowedForChatReset('xyz', w)).toBe(false);
  });
});
