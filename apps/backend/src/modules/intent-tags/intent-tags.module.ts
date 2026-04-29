import { Module } from '@nestjs/common';
import { TenantTaggingController } from './tenant-tagging.controller';
import { TagRulesService } from './tag-rules.service';
import { TagRuleMatchService } from './tag-rule-match.service';
import { GhlModule } from '../ghl/ghl.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule, GhlModule],
  controllers: [TenantTaggingController],
  providers: [TagRulesService, TagRuleMatchService],
  exports: [TagRulesService, TagRuleMatchService],
})
export class IntentTagsModule {}
