import { Global, Module } from '@nestjs/common';
import { AuthorizationPolicyService } from './authorization-policy.service';
import { AuthorizationShadowService } from './authorization-shadow.service';

@Global()
@Module({
  providers: [AuthorizationPolicyService, AuthorizationShadowService],
  exports: [AuthorizationPolicyService, AuthorizationShadowService],
})
export class AuthorizationModule {}
