import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DebugController } from './debug.controller';

@Module({
  imports: [AuthModule],
  controllers: [DebugController],
})
export class DebugModule {}
