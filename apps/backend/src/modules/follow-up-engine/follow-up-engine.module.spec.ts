import { FollowUpEngineModule } from './follow-up-engine.module';
import { FollowUpQueueModule } from '../../queues/follow-up-queue.module';
import { FollowUpEngineService } from './follow-up-engine.service';

describe('FollowUpEngineModule DI (follow-up queue)', () => {
  it('imports FollowUpQueueModule so InjectQueue(FOLLOW_UP) resolves within this module scope', () => {
    // Would have caught: BullQueue_follow-up not available in FollowUpEngineModule context.
    const imports = (Reflect.getMetadata('imports', FollowUpEngineModule) ?? []) as unknown[];
    expect(imports).toContain(FollowUpQueueModule);
  });

  it('FollowUpEngineService retains real implementation entrypoints (not a stub)', () => {
    const proto = FollowUpEngineService.prototype as Record<string, unknown>;
    expect(typeof proto['scheduleAfterOutboundSend']).toBe('function');
    expect(typeof proto['noteInboundFromContact']).toBe('function');
    expect(typeof proto['processFollowUpJob']).toBe('function');
  });
});
