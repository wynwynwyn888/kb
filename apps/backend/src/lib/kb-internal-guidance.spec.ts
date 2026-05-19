import { stripInternalGuidanceFromText } from './kb-internal-guidance';

describe('kb-internal-guidance', () => {
  it('removes internal persona paragraphs but keeps menu lines', () => {
    const raw = [
      'EMBER & SOY',
      '',
      'The dining experience should feel premium and calm.',
      '',
      'RESTAURANT MENU',
      'STARTERS',
      'A) Charred Wagyu Short Rib Bao',
      '12-hour braised short rib',
    ].join('\n');

    const out = stripInternalGuidanceFromText(raw);
    expect(out).not.toMatch(/dining experience should feel/i);
    expect(out).not.toMatch(/premium and calm/i);
    expect(out).toMatch(/Charred Wagyu/i);
    expect(out).toMatch(/RESTAURANT MENU/i);
  });

  it('preserves short single-line ALL-CAPS customer replies', () => {
    expect(stripInternalGuidanceFromText("YOU'RE WELCOME!")).toBe("YOU'RE WELCOME!");
    expect(stripInternalGuidanceFromText('HOW CAN I HELP?')).toBe('HOW CAN I HELP?');
  });
});
