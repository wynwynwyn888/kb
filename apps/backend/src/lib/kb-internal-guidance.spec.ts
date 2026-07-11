import { stripInternalGuidanceFromText } from './kb-internal-guidance';

describe('kb-internal-guidance', () => {
  it('removes internal persona paragraphs but keeps menu lines', () => {
    const raw = [
      'EMBER & SOY',
      '',
      'Customers should feel supported and confident.',
      '',
      'SERVICES',
      'A) Basic Support',
      'B) Premium Support',
    ].join('\n');

    const out = stripInternalGuidanceFromText(raw);
    expect(out).not.toMatch(/Customers should feel/i);
    expect(out).toMatch(/Basic Support/i);
    expect(out).toMatch(/SERVICES/i);
  });

  it('preserves short single-line ALL-CAPS customer replies', () => {
    expect(stripInternalGuidanceFromText("YOU'RE WELCOME!")).toBe("YOU'RE WELCOME!");
    expect(stripInternalGuidanceFromText('HOW CAN I HELP?')).toBe('HOW CAN I HELP?');
  });
});
