// Calendars controller

import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CalendarsService } from './calendars.service';

@ApiTags('calendars')
@ApiBearerAuth()
@Controller('calendars')
export class CalendarsController {
  constructor(private readonly calendarsService: CalendarsService) {}

  @Post('events')
  async createEvent(@Body() dto: {
    tenantId: string;
    title: string;
    startTime: Date;
    endTime: Date;
    contactId?: string;
    description?: string;
  }) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Get('events')
  async listEvents(
    @Query('tenantId') tenantId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Get('availability')
  async getAvailability(
    @Query('tenantId') tenantId: string,
    @Query('contactId') contactId: string,
    @Query('date') date: string,
  ) {
    // TODO: Implement
    throw new Error('Not implemented');
  }
}