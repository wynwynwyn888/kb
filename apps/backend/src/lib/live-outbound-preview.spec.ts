import { formatLiveCustomerDraftForPreview } from './live-outbound-preview';

describe('live-outbound-preview', () => {
  it('joins bubbles with blank lines like multi-bubble outbound spacing', () => {
    const raw = 'Intro\n\nA) One\n\nB) Two\n\nPick one.';
    const out = formatLiveCustomerDraftForPreview(raw);
    expect(out).toMatch(/Two\n\nPick one/);
  });

  it('matches coalesced send: two packed sections stay one block with blank line before final question', () => {
    const a = 'a'.repeat(260);
    const b = 'b'.repeat(260);
    const raw = `${a}\n\n${b}\n\nWhich option?`;
    const out = formatLiveCustomerDraftForPreview(raw);
    expect(out).toMatch(/\n\nWhich option\?$/);
  });
});
