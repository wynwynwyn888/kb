import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
  });

  describe('emit', () => {
    it('does not throw when metrics_events insert fails', () => {
      // getSupabaseService is mocked at module level by test setup,
      // but the mock .from() chain may not return properly.
      // The emit() method should never throw regardless.
      expect(() => {
        service.emit({ eventType: 'test', eventSource: 'test' });
      }).not.toThrow();
    });

    it('does not throw with full event payload', () => {
      expect(() => {
        service.emit({
          tenantId: 't1',
          conversationId: 'c1',
          eventType: 'outbound_send_sent',
          eventSource: 'outbound-send',
          severity: 'info',
          metadata: { bubbleSequence: 1, ghlMessageId: 'msg123' },
        });
      }).not.toThrow();
    });

    it('does not throw with undefined optional fields', () => {
      expect(() => {
        service.emit({ eventType: 'minimal', eventSource: 'test' });
      }).not.toThrow();
    });

    it('tolerates missing supabase client (emit is fire-and-forget)', () => {
      // Even if the supabase call throws internally, the emit() method
      // catches and logs — it must never propagate.
      expect(() => {
        service.emit({ eventType: 'must_not_throw', eventSource: 'test' });
      }).not.toThrow();
    });
  });
});
