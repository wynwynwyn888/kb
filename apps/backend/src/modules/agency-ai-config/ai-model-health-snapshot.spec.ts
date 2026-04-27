import { AxiosError } from 'axios';
import {
  activeAiHealthFromSnapshot,
  agencyAiHealthErrorSummary,
  parseAiModelHealthSnapshot,
} from './ai-model-health-snapshot';

describe('ai-model-health-snapshot', () => {
  it('parses stored health snapshot', () => {
    const s = parseAiModelHealthSnapshot({
      lastHealthStatus: 'FAIL',
      lastHealthCheckedAt: '2026-01-01T00:00:00.000Z',
      lastHealthLatencyMs: 120,
      lastHealthErrorSummary: 'oops',
      lastHealthModel: 'MiniMax-M2.7',
      lastHealthProvider: 'MINIMAX',
      lastHealthErrorCode: 'HTTP_400',
    });
    expect(s?.lastHealthProvider).toBe('MINIMAX');
    expect(s?.lastHealthStatus).toBe('FAIL');
  });

  it('active health is UNKNOWN when snapshot model does not match active', () => {
    const snap = parseAiModelHealthSnapshot({
      lastHealthStatus: 'PASS',
      lastHealthCheckedAt: '2026-01-01T00:00:00.000Z',
      lastHealthLatencyMs: 50,
      lastHealthErrorSummary: null,
      lastHealthModel: 'gpt-4o',
      lastHealthProvider: 'OPENAI',
    })!;
    const v = activeAiHealthFromSnapshot('OPENAI', 'gpt-4o-mini', snap);
    expect(v.healthBadge).toBe('UNKNOWN');
  });

  it('active health reflects PASS when snapshot matches active pair', () => {
    const snap = parseAiModelHealthSnapshot({
      lastHealthStatus: 'PASS',
      lastHealthCheckedAt: '2026-01-01T00:00:00.000Z',
      lastHealthLatencyMs: 50,
      lastHealthErrorSummary: null,
      lastHealthModel: 'gpt-4o-mini',
      lastHealthProvider: 'OPENAI',
    })!;
    const v = activeAiHealthFromSnapshot('OPENAI', 'gpt-4o-mini', snap);
    expect(v.healthBadge).toBe('PASS');
    expect(v.lastHealthLatencyMs).toBe(50);
  });

  it('OpenAI 401 returns Invalid API key without echoing secrets', () => {
    const err = new AxiosError('Unauthorized');
    err.response = {
      status: 401,
      statusText: 'Unauthorized',
      data: { error: { message: 'Incorrect API key provided: sk-xxxxx' } },
      headers: {},
      config: {} as never,
    };
    const { errorSummary } = agencyAiHealthErrorSummary('OPENAI', err);
    expect(errorSummary).toBe('Invalid API key');
    expect(errorSummary).not.toMatch(/sk-/i);
  });

  it('MiniMax error summary redacts bearer-like tokens in body', () => {
    const err = new AxiosError('Bad Request');
    err.response = {
      status: 400,
      statusText: 'Bad Request',
      data: { error: { message: 'bad' }, hint: 'Bearer sk-abcdefghijklmnopqrstuvwxyz1234567890' },
      headers: {},
      config: {} as never,
    };
    const { errorSummary } = agencyAiHealthErrorSummary('MINIMAX', err);
    expect(errorSummary).not.toMatch(/sk-[a-z0-9]{10,}/i);
  });
});
