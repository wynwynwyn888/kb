// Quotas module - manages quota wallet and ledger
// Quota counts on successful outbound send only

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantsModule } from '../tenants/tenants.module';
import { QuotasController } from './quotas.controller';
import { QuotasService } from './quotas.service';
import { QueuesModule } from '../../queues/queues.module';
import { CreditWarningsModule } from '../credit-warnings/credit-warnings.module';
import { CreditResetRemindersModule } from '../credit-reset-reminders/credit-reset-reminders.module';

@Module({
  imports: [QueuesModule, AuthModule, TenantsModule, CreditWarningsModule, CreditResetRemindersModule],
  controllers: [QuotasController],
  providers: [QuotasService],
  exports: [QuotasService],
})
export class QuotasModule {}