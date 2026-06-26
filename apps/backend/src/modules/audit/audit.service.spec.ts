import { AuditService } from './audit.service';

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(() => {
    service = new AuditService();
  });

  describe('log', () => {
    it('does not throw when audit_logs insert fails', () => {
      expect(() => {
        service.log({
          agencyId: 'a1',
          profileId: 'p1',
          action: 'test_action',
          resource: 'test_resource',
        });
      }).not.toThrow();
    });

    it('does not throw with full entry payload', () => {
      expect(() => {
        service.log({
          agencyId: 'a1',
          profileId: 'p1',
          tenantId: 't1',
          action: 'outbound_send_claimed',
          resource: 'outbound_sends',
          resourceId: 'os1',
          changes: { status: { before: 'pending', after: 'sent' } },
          ipAddress: '127.0.0.1',
        });
      }).not.toThrow();
    });

    it('does not throw with minimal entry', () => {
      expect(() => {
        service.log({
          agencyId: 'a1',
          profileId: 'p1',
          action: 'minimal',
          resource: 'test',
        });
      }).not.toThrow();
    });

    it('tolerates missing supabase client (log is fire-and-forget)', () => {
      expect(() => {
        service.log({
          agencyId: 'a1',
          profileId: 'p1',
          action: 'must_not_throw',
          resource: 'test',
        });
      }).not.toThrow();
    });
  });
});
