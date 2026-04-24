// Quotas module - manages quota wallet and ledger
// Quota counts on successful outbound send only

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QuotasController } from './quotas.controller';
import { QuotasService } from './quotas.service';
import { QueuesModule } from '../../queues/queues.module';

@Module({
  imports: [QueuesModule, AuthModule],
  controllers: [QuotasController],
  providers: [QuotasService],
  exports: [QuotasService],
})
export class QuotasModule {}