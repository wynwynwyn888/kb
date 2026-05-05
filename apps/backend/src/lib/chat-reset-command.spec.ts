import { excludeChatResetInboundRows, matchChatResetCommand } from './chat-reset-command';

describe('matchChatResetCommand', () => {
  it.each(['/new', '/NEW', '  /new  ', '/reset', '/startover'])('matches %j', cmd => {
    expect(matchChatResetCommand(cmd)).toBeTruthy();
  });

  it('does not match sentences containing new', () => {
    expect(matchChatResetCommand('something new')).toBeNull();
    expect(matchChatResetCommand('new menu pls')).toBeNull();
    expect(matchChatResetCommand('/newbie')).toBeNull();
  });
});

describe('excludeChatResetInboundRows', () => {
  it('removes /new rows but keeps following customer lines', () => {
    const rows = [
      { created_at: '2026-01-01T00:00:02Z', content: 'hello' },
      { created_at: '2026-01-01T00:00:01Z', content: '/new' },
    ];
    const out = excludeChatResetInboundRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0]!.content).toBe('hello');
  });
});
