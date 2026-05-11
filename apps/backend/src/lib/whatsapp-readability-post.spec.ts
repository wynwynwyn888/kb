import { bulletizeAdjacentShortPhraseLines, tryReadabilityTwoBubbleDrafts } from './whatsapp-readability-post';

describe('whatsapp-readability-post', () => {
  it('bulletizes a short stack of label-like lines', () => {
    const raw = 'Setup complexity\nChannels connected\nLevel of automation\n\nMore prose here.';
    expect(bulletizeAdjacentShortPhraseLines(raw)).toContain('• Setup complexity');
    expect(bulletizeAdjacentShortPhraseLines(raw)).toContain('• Level of automation');
  });

  it('splits a long two-paragraph reply into two single bubbles when packing allows', () => {
    const p1 =
      'Paragraph one: pricing depends on channels, workflows, CRM scope, and customization depth. '.repeat(2) +
      'We stay factual and avoid inventing dollar amounts without KB support.';
    const p2 =
      'Paragraph two: *Best next step* is join the webinar or book a quick call if you already have a use case. '.repeat(2) +
      'Happy to tailor next messages once we know your goals.';
    const combined = `${p1}\n\n${p2}`;
    expect(combined.length).toBeGreaterThan(350);
    expect(combined.length).toBeLessThanOrEqual(520);
    const two = tryReadabilityTwoBubbleDrafts(combined);
    expect(two).not.toBeNull();
    expect(two).toHaveLength(2);
    expect(two![0]!.text).toContain('Paragraph one:');
    expect(two![1]!.text).toContain('Paragraph two:');
  });
});
