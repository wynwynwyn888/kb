import { Module } from '@nestjs/common';
import { IntentTagsController } from './intent-tags.controller';
import { IntentTagsService } from './intent-tags.service';
import { GhlModule } from '../ghl/ghl.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule, GhlModule],
  controllers: [IntentTagsController],
  providers: [IntentTagsService],
  exports: [IntentTagsService],
})
export class IntentTagsModule {}
