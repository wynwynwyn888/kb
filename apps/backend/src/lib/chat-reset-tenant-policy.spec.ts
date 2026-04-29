import {
  buildChatResetContactWhitelist,
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
