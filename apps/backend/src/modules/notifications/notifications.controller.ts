// Notifications controller

import { Controller, Get, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

const STUB_DESC = 'Not implemented: handler throws. JWT required.';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: '[Stub] List notifications',
    deprecated: true,
    description: STUB_DESC,
  })
  async findAll(
    @Query('userId') userId: string,
    @Query('unreadOnly') unreadOnly?: boolean,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Patch(':id/read')
  @ApiOperation({
    summary: '[Stub] Mark notification read',
    deprecated: true,
    description: STUB_DESC,
  })
  async markAsRead(@Param('id') id: string) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Patch('read-all')
  @ApiOperation({
    summary: '[Stub] Mark all read',
    deprecated: true,
    description: STUB_DESC,
  })
  async markAllAsRead(@Body() { userId }: { userId: string }) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Get('unread-count')
  @ApiOperation({
    summary: '[Stub] Unread count',
    deprecated: true,
    description: STUB_DESC,
  })
  async getUnreadCount(@Query('userId') userId: string) {
    // TODO: Implement
    throw new Error('Not implemented');
  }
}
