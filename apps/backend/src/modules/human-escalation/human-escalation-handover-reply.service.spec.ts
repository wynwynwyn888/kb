import { jest as jestGlobal } from '@jest/globals';
import type { MemoryEntry } from '../orchestration/dto/memory-entry';
import {
  HumanEscalationHandoverReplyService,
  buildRecentConversationContextForHandover,
} from './human-escalation-handover-reply.service';

describe('HumanEscalationHandoverReplyService', () => {
  const generation = {
    generateDraft: jestGlobal.fn(async () => ({
      content: JSON.stringify({
        type: 'waiting_time',
        reply:
          'I’m sorry for the wait. Your request has been sent to the team, and they’ll attend to you as soon as they’re available.',
        confidence: 0.9,
        reason: 'asked when',
      }),
    })),
  };

  beforeEach(() => {
    jestGlobal.clearAllMocks();
  });

  it('calls GenerationService and returns validated reply', async () => {
    const svc = new HumanEscalationHandoverReplyService(generation as never);
    const res = await svc.classifyAndCompose({
      tenantId: 't1',
      conversationId: 'c1',
      latestInboundText: 'when?',
    });
    expect(generation.generateDraft).toHaveBeenCalled();
    expect(res.usedFallback).toBe(false);
    expect(res.selectedType).toBe('waiting_time');
  });

  it('invalid JSON falls back to default', async () => {
    generation.generateDraft.mockResolvedValueOnce({ content: 'not json' });
    const svc = new HumanEscalationHandoverReplyService(generation as never);
    const res = await svc.classifyAndCompose({
      tenantId: 't1',
      conversationId: 'c1',
      latestInboundText: 'hello?',
    });
    expect(res.usedFallback).toBe(true);
    expect(res.selectedType).toBe('default');
  });

  it('provider failure falls back to default', async () => {
    generation.generateDraft.mockRejectedValueOnce(new Error('no provider'));
    const svc = new HumanEscalationHandoverReplyService(generation as never);
    const res = await svc.classifyAndCompose({
      tenantId: 't1',
      conversationId: 'c1',
      latestInboundText: 'hello?',
    });
    expect(res.usedFallback).toBe(true);
    expect(res.selectedType).toBe('default');
  });

  it('low confidence default falls back to default template', async () => {
    generation.generateDraft.mockResolvedValueOnce({
      content: JSON.stringify({
        type: 'default',
        reply: 'Your request has been sent to the team. They’ll attend to you as soon as they’re available.',
        confidence: 0.2,
        reason: 'unclear',
      }),
    });
    const svc = new HumanEscalationHandoverReplyService(generation as never);
    const res = await svc.classifyAndCompose({
      tenantId: 't1',
      conversationId: 'c1',
      latestInboundText: 'ok fast can??',
    });
    expect(res.usedFallback).toBe(true);
    expect(res.selectedType).toBe('default');
  });

  it('pricing/service recommendation is rejected and falls back', async () => {
    generation.generateDraft.mockResolvedValueOnce({
      content: JSON.stringify({
        type: 'extra_context',
        reply: 'Our prices start at $50. Your request has been sent to the team.',
        confidence: 0.9,
        reason: 'bad',
      }),
    });
    const svc = new HumanEscalationHandoverReplyService(generation as never);
    const res = await svc.classifyAndCompose({
      tenantId: 't1',
      conversationId: 'c1',
      latestInboundText: 'price?',
    });
    expect(res.usedFallback).toBe(true);
    expect(res.selectedType).toBe('extra_context');
  });

  it('exact timing is rejected and falls back', async () => {
    generation.generateDraft.mockResolvedValueOnce({
      content: JSON.stringify({
        type: 'waiting_time',
        reply: 'Your request has been sent to the team. They will reply in 5 minutes.',
        confidence: 0.9,
        reason: 'bad',
      }),
    });
    const svc = new HumanEscalationHandoverReplyService(generation as never);
    const res = await svc.classifyAndCompose({
      tenantId: 't1',
      conversationId: 'c1',
      latestInboundText: 'when?',
    });
    expect(res.usedFallback).toBe(true);
    expect(res.selectedType).toBe('waiting_time');
  });

  it('over 35 words is rejected and falls back', async () => {
    generation.generateDraft.mockResolvedValueOnce({
      content: JSON.stringify({
        type: 'frustration',
        reply:
          'I understand this is frustrating, and I really appreciate your patience today. Your request has been sent to the team, and they’ll attend to you as soon as they’re available. Thank you for waiting, and we truly appreciate your understanding.',
        confidence: 0.9,
        reason: 'too long',
      }),
    });
    const svc = new HumanEscalationHandoverReplyService(generation as never);
    const res = await svc.classifyAndCompose({
      tenantId: 't1',
      conversationId: 'c1',
      latestInboundText: 'this is ridiculous',
    });
    expect(res.usedFallback).toBe(true);
    expect(res.selectedType).toBe('frustration');
  });
});

describe('buildRecentConversationContextForHandover', () => {
  const mk = (role: 'user' | 'assistant', content: string): MemoryEntry => ({
    role,
    content,
    sender: role === 'user' ? 'CONTACT' : 'AI',
    timestamp: new Date().toISOString(),
    messageType: 'text',
  });

  it('drops trailing customer turn matching latest inbound', () => {
    const entries = [
      mk('user', 'can I talk to human'),
      mk('assistant', 'Noted — someone will help.'),
      mk('user', 'hello?'),
    ];
    const ctx = buildRecentConversationContextForHandover(entries, 'hello?');
    expect(ctx).toContain('can I talk to human');
    expect(ctx).not.toMatch(/Customer:\s*hello\?/);
  });
});

describe('HumanEscalationHandoverReplyService — NLU uses latest message vs RECENT_CONTEXT', () => {
  const generation = { generateDraft: jestGlobal.fn() };

  beforeEach(() => {
    jestGlobal.clearAllMocks();
  });

  it('passes LATEST_CUSTOMER_MESSAGE + RECENT_CONTEXT to generation for shampoo follow-up', async () => {
    generation.generateDraft.mockResolvedValueOnce({
      content: JSON.stringify({
        type: 'extra_context',
        reply:
          'Thank you — I have passed this detail to the team so they have it when they respond.',
        confidence: 0.91,
        reason: 'product context',
      }),
    });
    const svc = new HumanEscalationHandoverReplyService(generation as never);
    await svc.classifyAndCompose({
      tenantId: 't1',
      conversationId: 'c1',
      latestInboundText: 'oh ya i have been using loreal sensitive shampoo, is it good or u have better?',
      recentConversationContext: 'Customer: can I talk to human\nAssistant: I will arrange a team member.',
    });
    const payload = generation.generateDraft.mock.calls[0]![0] as { incomingMessage: string };
    expect(payload.incomingMessage).toContain('LATEST_CUSTOMER_MESSAGE:');
    expect(payload.incomingMessage).toContain('loreal');
    expect(payload.incomingMessage).toContain('RECENT_CONTEXT:');
    expect(payload.incomingMessage).toMatch(/talk to human/);
  });

  it('how long after human request → waiting_time', async () => {
    generation.generateDraft.mockResolvedValueOnce({
      content: JSON.stringify({
        type: 'waiting_time',
        reply:
          'I’m sorry for the wait — your request has already been sent to the team for assistance.',
        confidence: 0.88,
        reason: 'eta ask',
      }),
    });
    const svc = new HumanEscalationHandoverReplyService(generation as never);
    const res = await svc.classifyAndCompose({
      tenantId: 't1',
      conversationId: 'c1',
      latestInboundText: 'how long',
      recentConversationContext: 'Customer: can I talk to human',
    });
    expect(res.selectedType).toBe('waiting_time');
    expect(res.usedFallback).toBe(false);
  });

  it('hello? after human request → waiting_time', async () => {
    generation.generateDraft.mockResolvedValueOnce({
      content: JSON.stringify({
        type: 'waiting_time',
        reply:
          'Sorry for the wait — your request has already been sent to the team for assistance.',
        confidence: 0.87,
        reason: 'poke',
      }),
    });
    const svc = new HumanEscalationHandoverReplyService(generation as never);
    const res = await svc.classifyAndCompose({
      tenantId: 't1',
      conversationId: 'c1',
      latestInboundText: 'hello?',
      recentConversationContext: 'Customer: can I talk to human',
    });
    expect(res.selectedType).toBe('waiting_time');
  });

  it('angry latest message → frustration', async () => {
    generation.generateDraft.mockResolvedValueOnce({
      content: JSON.stringify({
        type: 'frustration',
        reply:
          'I understand this is frustrating — I have flagged this for the team and they will attend as soon as they can.',
        confidence: 0.9,
        reason: 'upset',
      }),
    });
    const svc = new HumanEscalationHandoverReplyService(generation as never);
    const res = await svc.classifyAndCompose({
      tenantId: 't1',
      conversationId: 'c1',
      latestInboundText: 'this is unacceptable!',
      recentConversationContext: 'Customer: can I talk to human',
    });
    expect(res.selectedType).toBe('frustration');
  });

  it('vague ok → default', async () => {
    generation.generateDraft.mockResolvedValueOnce({
      content: JSON.stringify({
        type: 'default',
        reply:
          'Your request has already been sent to the team and they will attend when available.',
        confidence: 0.82,
        reason: 'short ack',
      }),
    });
    const svc = new HumanEscalationHandoverReplyService(generation as never);
    const res = await svc.classifyAndCompose({
      tenantId: 't1',
      conversationId: 'c1',
      latestInboundText: 'ok',
      recentConversationContext: 'Customer: can I talk to human',
    });
    expect(res.selectedType).toBe('default');
  });
});

