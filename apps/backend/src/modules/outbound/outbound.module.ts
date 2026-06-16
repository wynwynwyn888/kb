// Outbound module — sends reply bubbles through GHL

import { Module, forwardRef } from '@nestjs/common';
import { OutboundSendService } from './outbound-send.service';
import { OutboundSafetyGovernorService } from './outbound-safety-governor.service';
import { CreditWarningsModule } from '../credit-warnings/credit-warnings.module';
import { KbModule } from '../kb/kb.module';

@Module({
  imports: [CreditWarningsModule, forwardRef(() => KbModule)],
  providers: [OutboundSendService, OutboundSafetyGovernorService],
  exports: [OutboundSendService, OutboundSafetyGovernorService],
})
export class OutboundModule {}
