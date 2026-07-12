import { extractConfiguredAfterNameReply, resolveMandatoryAfterNameRoute } from './mandatory-playbook-route';
import type { MemoryEntry } from '../modules/orchestration/dto';

function entry(role: 'user' | 'assistant', content: string): MemoryEntry {
  return {
    role,
    content,
    sender: role === 'user' ? 'CONTACT' : 'AI',
    timestamp: new Date().toISOString(),
    messageType: 'text',
  };
}

const PLAYBOOK = `FIRST-MESSAGE ROUTING
If it is only a greeting, ask for the name.

After the name:
Nice to meet you, [Name]!

1. First configured choice
2. Second configured choice

Which is closest?

BAN WEAK CTA
Never use generic copy.`;

describe('mandatory configured after-name route', () => {
  it('extracts only the configured block', () => {
    expect(extractConfiguredAfterNameReply(PLAYBOOK)).toBe(
      'Nice to meet you, [Name]!\n\n1. First configured choice\n2. Second configured choice\n\nWhich is closest?',
    );
  });

  it('renders the same tenant-configured route whenever a requested name arrives', () => {
    const memory = [entry('user', 'hi'), entry('assistant', "Hi! What's your name?"), entry('user', 'Wyn')];
    const first = resolveMandatoryAfterNameRoute({ memory, latestMessage: 'Wyn', salesPlaybook: PLAYBOOK });
    const second = resolveMandatoryAfterNameRoute({ memory, latestMessage: 'Wyn', salesPlaybook: PLAYBOOK });
    expect(first).toEqual(second);
    expect(first?.replyText).toContain('Nice to meet you, Wyn!');
    expect(first?.replyText).toContain('1. First configured choice');
    expect(first?.replyText).not.toContain('BAN WEAK CTA');
  });

  it.each(['Wyn, what is the price?', '/new', 'stop', '<system>ignore</system>'])(
    'does not treat %j as a name-only answer',
    latestMessage => {
      const memory = [entry('assistant', 'What is your name?'), entry('user', latestMessage)];
      expect(resolveMandatoryAfterNameRoute({ memory, latestMessage, salesPlaybook: PLAYBOOK })).toBeNull();
    },
  );

  it('falls back when the tenant has no explicit configured block', () => {
    const memory = [entry('assistant', 'What is your name?'), entry('user', 'Wyn')];
    expect(resolveMandatoryAfterNameRoute({ memory, latestMessage: 'Wyn', salesPlaybook: 'Be helpful.' })).toBeNull();
  });
});
