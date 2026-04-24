// Agency Users module - manages agency user membership and roles

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AgencyUsersController } from './agency-users.controller';
import { AgencyUsersService } from './agency-users.service';

@Module({
  imports: [AuthModule],
  controllers: [AgencyUsersController],
  providers: [AgencyUsersService],
  exports: [AgencyUsersService],
})
export class AgencyUsersModule {}