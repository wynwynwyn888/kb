import { Module } from '@nestjs/common';
import { CreditWarningsService } from './credit-warnings.service';

@Module({
  providers: [CreditWarningsService],
  exports: [CreditWarningsService],
})
export class CreditWarningsModule {}
