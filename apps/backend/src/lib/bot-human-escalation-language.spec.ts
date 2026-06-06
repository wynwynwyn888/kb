import { containsBotHumanEscalationLanguage } from './bot-human-escalation-language';

describe('containsBotHumanEscalationLanguage', () => {
  it('detects team will reach out phrasing', () => {
    expect(containsBotHumanEscalationLanguage('Our team will reach out to you shortly.')).toBe(true);
  });

  it('detects arrange for a team member phrasing', () => {
    expect(
      containsBotHumanEscalationLanguage("Of course. I'll arrange for a team member to assist you shortly."),
    ).toBe(true);
  });

  it('detects connect-you-with-the-team phrasing', () => {
    expect(containsBotHumanEscalationLanguage('I can connect you with the team for the full details.')).toBe(true);
  });

  it('does not flag generic help without human handoff promise', () => {
    expect(containsBotHumanEscalationLanguage('Happy to help — what would you like to know?')).toBe(false);
  });

  it('does not flag contact-you-soon without team/staff context', () => {
    expect(containsBotHumanEscalationLanguage('I will contact you soon with the quote.')).toBe(false);
  });
});
