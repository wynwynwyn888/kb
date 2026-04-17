// Agency Users module - manages agency user membership and roles

import { Module } from '@nestjs/common';
import { AgencyUsersController } from './agency-users.controller';
import { AgencyUsersService } from './agency-users.service';

@Module({
  controllers: [AgencyUsersController],
  providers: [AgencyUsersService],
  exports: [AgencyUsersService],
})
export class AgencyUsersModule {}