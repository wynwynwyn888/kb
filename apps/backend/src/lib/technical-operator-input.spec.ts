import {
  isTechnicalOperatorInput,
  TECHNICAL_OPERATOR_DEFLECTION_REPLY,
} from './technical-operator-input';

describe('isTechnicalOperatorInput', () => {
  it('detects docker and npm/git shell commands', () => {
    expect(isTechnicalOperatorInput('docker logs -f aisbp-backend-1')).toBe(true);
    expect(isTechnicalOperatorInput('npm run build')).toBe(true);
    expect(isTechnicalOperatorInput('git push origin main')).toBe(true);
  });

  it('detects SQL queries', () => {
    expect(isTechnicalOperatorInput('SELECT * FROM users WHERE id = 1')).toBe(true);
  });

  it('detects code fences and snippets', () => {
    expect(isTechnicalOperatorInput('```js\nconst x = 1;\n```')).toBe(true);
    expect(isTechnicalOperatorInput('import { foo } from "bar";')).toBe(true);
  });

  it('detects server/runtime jargon', () => {
    expect(isTechnicalOperatorInput('ReferenceError: Cannot access X before initialization')).toBe(
      true,
    );
    expect(isTechnicalOperatorInput('check supabase connection pooler')).toBe(true);
  });

  it('does not flag normal salon or human-handover chat', () => {
    expect(isTechnicalOperatorInput('can i speak to human pls')).toBe(false);
    expect(isTechnicalOperatorInput('what model are you on')).toBe(false);
    expect(isTechnicalOperatorInput('do you do balayage?')).toBe(false);
    expect(isTechnicalOperatorInput('still waiting for someone')).toBe(false);
  });

  it('exports a deflection reply for non-handover paths', () => {
    expect(TECHNICAL_OPERATOR_DEFLECTION_REPLY.length).toBeGreaterThan(20);
  });
});
