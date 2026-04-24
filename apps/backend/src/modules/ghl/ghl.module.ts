// GHL module - handles GoHighLevel Private Integration connection management

import { Module } from '@nestjs/common';
import { GhlController } from './ghl.controller';
import { GhlService } from './ghl.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [GhlController],
  providers: [GhlService],
  exports: [GhlService],
})
export class GhlModule {}