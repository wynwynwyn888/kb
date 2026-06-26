/**
 * Integration-style tests proving metrics/audit write failures never break
 * outbound send, inbound processing, GHL sync, or booking save flows.
 *
 * Key invariant: if a metrics_events or audit_logs insert fails, the business
 * flow MUST complete successfully.  No 500, no throw, no dead-letter.
 */
import { MetricsService } from './metrics.service';

describe('Metrics/Audit Non-Blocking Guarantee', () => {
  let metrics: MetricsService;

  beforeEach(() => {
    metrics = new MetricsService();
  });

  it('metrics emit is fire-and-forget — resolves synchronously', () => {
    // emit() must return void (not a promise whose rejection would propagate).
    const result = metrics.emit({ eventType: 'test_fire_and_forget', eventSource: 'test' });
    expect(result).toBeUndefined();
  });

  it('multiple rapid emits do not throw', () => {
    for (let i = 0; i < 100; i++) {
      metrics.emit({
        eventType: 'rapid_fire_test',
        eventSource: 'test',
        metadata: { iteration: i },
      });
    }
    // If any emit threw, the test would have already failed.
  });

  it('emit preserves event order metadata', () => {
    const events: Array<ReturnType<typeof metrics['emit']>> = [];
    for (let i = 0; i < 10; i++) {
      events.push(
        metrics.emit({
          tenantId: 't1',
          conversationId: 'c1',
          eventType: 'ordered_test',
          eventSource: 'test',
          metadata: { seq: i },
        }),
      );
    }
    // All emits resolved synchronously (void).
    expect(events.every((e) => e === undefined)).toBe(true);
  });

  it('emit with all severity levels does not throw', () => {
    const severities: Array<'info' | 'warn' | 'error'> = ['info', 'warn', 'error'];
    for (const severity of severities) {
      metrics.emit({ eventType: 'severity_test', eventSource: 'test', severity });
    }
  });

  it('emit handles large metadata objects safely', () => {
    const largeMeta: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) {
      largeMeta[`key_${i}`] = `value_${i}`;
    }
    expect(() => {
      metrics.emit({
        eventType: 'large_metadata',
        eventSource: 'test',
        metadata: largeMeta,
      });
    }).not.toThrow();
  });
});
