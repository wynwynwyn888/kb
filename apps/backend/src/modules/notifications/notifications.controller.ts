// Notifications controller

import { Controller, Get, Patch, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
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
  async markAsRead(@Param('id') id: string) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Patch('read-all')
  async markAllAsRead(@Body() { userId }: { userId: string }) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Get('unread-count')
  async getUnreadCount(@Query('userId') userId: string) {
    // TODO: Implement
    throw new Error('Not implemented');
  }
}