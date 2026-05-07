import { jest as jestGlobal } from '@jest/globals';
import { HumanEscalationHandoverReplyService } from './human-escalation-handover-reply.service';

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

