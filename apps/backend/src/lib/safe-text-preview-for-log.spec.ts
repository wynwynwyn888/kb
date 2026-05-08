import { safeTextPreviewForLog } from './safe-text-preview-for-log';

describe('safeTextPreviewForLog', () => {
  const prevNodeEnv = process.env['NODE_ENV'];

  afterEach(() => {
    process.env['NODE_ENV'] = prevNodeEnv;
  });

  it('in production returns length+hash only by default', () => {
    process.env['NODE_ENV'] = 'production';
    const r = safeTextPreviewForLog('hello world');
    expect(r.length).toBe(11);
    expect(typeof r.hash).toBe('string');
    expect(r.hash.length).toBeGreaterThanOrEqual(6);
    expect((r as any).head).toBeUndefined();
  });

  it('in production allows head when explicitly requested (bounded)', () => {
    process.env['NODE_ENV'] = 'production';
    const r = safeTextPreviewForLog('abcdefghijklmnopqrstuvwxyz', {
      allowHeadInProduction: true,
      headChars: 12,
    });
    expect(r.head).toBe('abcdefghijkl');
  });

  it('in non-production includes head by default (bounded)', () => {
    process.env['NODE_ENV'] = 'test';
    const r = safeTextPreviewForLog('hello world');
    expect(r.head).toBe('hello world');
  });

  it('hash is stable for identical inputs and differs for different inputs', () => {
    process.env['NODE_ENV'] = 'production';
    const a1 = safeTextPreviewForLog('same');
    const a2 = safeTextPreviewForLog('same');
    const b = safeTextPreviewForLog('different');
    expect(a1.hash).toBe(a2.hash);
    expect(a1.hash).not.toBe(b.hash);
  });
});

