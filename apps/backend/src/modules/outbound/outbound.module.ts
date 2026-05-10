// Outbound module — sends reply bubbles through GHL

import { Module } from '@nestjs/common';
import { OutboundSendService } from './outbound-send.service';
import { OutboundSafetyGovernorService } from './outbound-safety-governor.service';
import { CreditWarningsModule } from '../credit-warnings/credit-warnings.module';

@Module({
  imports: [CreditWarningsModule],
  providers: [OutboundSendService, OutboundSafetyGovernorService],
  exports: [OutboundSendService, OutboundSafetyGovernorService],
})
export class OutboundModule {}
