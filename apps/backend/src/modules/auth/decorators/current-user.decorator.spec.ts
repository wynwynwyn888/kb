import { UnauthorizedException } from '@nestjs/common';
import { rawBearerToken } from './current-user.decorator';

describe('rawBearerToken', () => {
  it('returns the raw JWT without its Bearer prefix', () => {
    expect(rawBearerToken('Bearer header.payload.signature')).toBe('header.payload.signature');
  });

  it.each([undefined, '', 'Basic token', 'Bearer ', 'Bearer token with spaces']) (
    'rejects malformed authorization value %p',
    value => expect(() => rawBearerToken(value)).toThrow(UnauthorizedException),
  );

  it('rejects oversized tokens', () => {
    expect(() => rawBearerToken(`Bearer ${'x'.repeat(16_385)}`)).toThrow(UnauthorizedException);
  });
});
