import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';
import type { Request } from 'express';
import type { SessionUser } from '../../lib/supabase';

function mockReq(agencyRole?: string): Request {
  return {
    user: { agencyRole: agencyRole ?? null } as SessionUser,
  } as unknown as Request;
}

describe('OpsController', () => {
  let controller: OpsController;
  let service: OpsService;

  beforeEach(() => {
    service = {
      getHealth: jest.fn().mockResolvedValue({ backend: 'Healthy', frontend: 'HTTP 200', redis: 'Healthy', bookingSave: 'Works', vpsCommit: 'abc', stableTag: 'v1', uptimeSec: 10, nodeEnv: 'test' }),
      getFlags: jest.fn().mockReturnValue([{ key: 'AISBP_FOO', value: 'true' }]),
      getOutboundSends: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 }),
      getConversations: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 }),
      getGhlSync: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 }),
      getErrors: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 }),
      getAuditEvents: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 }),
      getTenants: jest.fn().mockResolvedValue([]),
      getQueueHealth: jest.fn().mockResolvedValue([]),
      clearHandover: jest.fn().mockResolvedValue({
        ok: true, handoverCleared: true, activeHandoverFound: true,
        handoverEventsResolved: 2, conversationStatusBefore: 'HANDOVER',
        conversationStatusAfter: 'ACTIVE', tenantId: 'tenant-1',
      }),
    } as unknown as OpsService;
    controller = new OpsController(service);
  });

  describe('auth', () => {
    it('rejects requests without agency role', async () => {
      await expect(controller.getHealth(mockReq(undefined))).rejects.toThrow('Agency membership required');
    });

    it('rejects requests with only tenant role', async () => {
      const req = mockReq();
      req.user = { tenantRole: 'ADMIN' } as SessionUser;
      await expect(controller.getHealth(req)).rejects.toThrow('Agency membership required');
    });

    it('allows requests with agency role', async () => {
      await expect(controller.getHealth(mockReq('OWNER'))).resolves.toBeDefined();
    });
  });

  describe('health', () => {
    it('returns health object', async () => {
      const result = await controller.getHealth(mockReq('OWNER'));
      expect(result.backend).toBe('Healthy');
    });
  });

  describe('flags', () => {
    it('returns flags array (no secrets)', () => {
      const result = controller.getFlags(mockReq('ADMIN'));
      expect(Array.isArray(result)).toBe(true);
      expect(result[0].key).toBe('AISBP_FOO');
    });
  });

  describe('outbound-sends', () => {
    it('paginates with defaults', async () => {
      const result = await controller.getOutboundSends(mockReq('OWNER'));
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });

    it('clamps pageSize to max 100', async () => {
      await controller.getOutboundSends(mockReq('OWNER'), undefined, undefined, 1, 999);
      expect(service.getOutboundSends).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 100 }));
    });
  });

  describe('conversations', () => {
    it('paginates with defaults', async () => {
      const result = await controller.getConversations(mockReq('OWNER'));
      expect(result.page).toBe(1);
    });
  });

  describe('errors', () => {
    it('returns paginated errors', async () => {
      const result = await controller.getErrors(mockReq('OWNER'));
      expect(result.total).toBe(0);
    });
  });

  describe('ghl-sync', () => {
    it('paginates with defaults', async () => {
      const result = await controller.getGhlSync(mockReq('OWNER'));
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });

    it('clamps pageSize to max 250', async () => {
      await controller.getGhlSync(mockReq('OWNER'), undefined, 1, 999);
      expect(service.getGhlSync).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 250 }));
    });
  });

  describe('tenants', () => {
    it('returns tenant list', async () => {
      const result = await controller.getTenants(mockReq('OWNER'));
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('queues', () => {
    it('returns queue health', async () => {
      const result = await controller.getQueues(mockReq('ADMIN'));
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('clear-handover', () => {
    it('clears handover for a conversation and returns result', async () => {
      const result = await controller.clearHandover(mockReq('OWNER'), 'conv-1');
      expect(service.clearHandover).toHaveBeenCalledWith('conv-1');
      expect(result.handoverCleared).toBe(true);
      expect(result.conversationStatusAfter).toBe('ACTIVE');
      expect(result.activeHandoverFound).toBe(true);
    });

    it('requires agency role', async () => {
      await expect(controller.clearHandover(mockReq(undefined), 'conv-1')).rejects.toThrow('Agency membership required');
    });
  });
});
