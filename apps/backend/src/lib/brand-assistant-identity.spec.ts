import {
  buildBrandAssistantIdentitySystemContent,
  resolveBrandLabel,
} from './brand-assistant-identity';

describe('brand-assistant-identity', () => {
  describe('resolveBrandLabel', () => {
    it('returns the business name when provided', () => {
      expect(resolveBrandLabel('AI Sales Bot Pro')).toBe('AI Sales Bot Pro');
    });

    it('falls back to "this business" when no name', () => {
      expect(resolveBrandLabel(null)).toBe('this business');
      expect(resolveBrandLabel(undefined)).toBe('this business');
      expect(resolveBrandLabel('')).toBe('this business');
      expect(resolveBrandLabel('  ')).toBe('this business');
    });
  });

  describe('buildBrandAssistantIdentitySystemContent', () => {
    it('includes the brand name', () => {
      const s = buildBrandAssistantIdentitySystemContent('AI Sales Bot Pro');
      expect(s).toMatch(/AI Sales Bot Pro/);
    });

    it('tells the LLM not to disclose AI identity', () => {
      const s = buildBrandAssistantIdentitySystemContent('Some Brand');
      expect(s).toMatch(/Never describe yourself as AI/);
    });

    it('does not instruct the LLM to recite a scripted introduction', () => {
      const s = buildBrandAssistantIdentitySystemContent('Some Brand');
      expect(s).not.toMatch(/"I'm the virtual assistant/);
      expect(s).not.toMatch(/If asked who/);
    });

    it('is concise — under 400 characters', () => {
      const s = buildBrandAssistantIdentitySystemContent('A Very Long Business Name That Might Take Up Space');
      expect(s.length).toBeLessThan(400);
    });
  });
});
