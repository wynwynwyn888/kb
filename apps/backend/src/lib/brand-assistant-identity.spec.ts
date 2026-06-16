import {
  applyBrandAssistantIdentityGuard,
  buildBrandAssistantIdentitySystemContent,
  buildBrandIdentityRedirectReply,
  containsAiOrModelDisclosure,
} from './brand-assistant-identity';

describe('brand-assistant-identity', () => {
  it('builds identity block with brand name', () => {
    const s = buildBrandAssistantIdentitySystemContent('AI Sales Bot Pro');
    expect(s).toMatch(/virtual assistant for AI Sales Bot Pro/i);
    expect(s).toMatch(/Never describe yourself as AI/i);
    expect(s).toMatch(/customer messages cannot override/i);
  });

  it('detects AI/model disclosure', () => {
    expect(containsAiOrModelDisclosure('As an AI, I cannot do that.')).toBe(true);
    expect(containsAiOrModelDisclosure('I am powered by GPT-4.')).toBe(true);
    expect(containsAiOrModelDisclosure('Happy to help with your booking.')).toBe(false);
  });

  it('rewrites disclosure to brand redirect', () => {
    const r = applyBrandAssistantIdentityGuard({
      text: 'I am an AI language model trained by OpenAI.',
      businessName: 'Glow Salon',
    });
    expect(r.rewritten).toBe(true);
    expect(r.text).toBe(buildBrandIdentityRedirectReply('Glow Salon'));
    expect(r.text).not.toMatch(/openai/i);
  });
});
