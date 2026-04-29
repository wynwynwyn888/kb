import { matchChatResetCommand } from './chat-reset-command';

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
