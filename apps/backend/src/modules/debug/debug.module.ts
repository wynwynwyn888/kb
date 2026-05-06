import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DebugController } from './debug.controller';
import { FollowUpEngineModule } from '../follow-up-engine/follow-up-engine.module';

@Module({
  imports: [AuthModule, FollowUpEngineModule],
  controllers: [DebugController],
})
export class DebugModule {}
