// Agency Users module - manages agency user membership and roles

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InvitationsModule } from '../invitations/invitations.module';
import { AgencyUsersController } from './agency-users.controller';
import { AgencyUsersService } from './agency-users.service';

@Module({
  imports: [AuthModule, InvitationsModule],
  controllers: [AgencyUsersController],
  providers: [AgencyUsersService],
  exports: [AgencyUsersService],
})
export class AgencyUsersModule {}