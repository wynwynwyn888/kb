// Outbound module — sends reply bubbles through GHL

import { Module } from '@nestjs/common';
import { OutboundSendService } from './outbound-send.service';
import { OutboundSafetyGovernorService } from './outbound-safety-governor.service';

@Module({
  providers: [OutboundSendService, OutboundSafetyGovernorService],
  exports: [OutboundSendService, OutboundSafetyGovernorService],
})
export class OutboundModule {}
