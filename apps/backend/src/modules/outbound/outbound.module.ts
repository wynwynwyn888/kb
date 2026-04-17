// Outbound module — sends reply bubbles through GHL

import { Module } from '@nestjs/common';
import { OutboundSendService } from './outbound-send.service';

@Module({
  providers: [OutboundSendService],
  exports: [OutboundSendService],
})
export class OutboundModule {}
