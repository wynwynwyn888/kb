// Calendars controller

import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CalendarsService } from './calendars.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

const STUB_DESC = 'Not implemented: handler throws. JWT required.';

@ApiTags('calendars')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('calendars')
export class CalendarsController {
  constructor(private readonly calendarsService: CalendarsService) {}

  @Post('events')
  @ApiOperation({
    summary: '[Stub] Create calendar event',
    deprecated: true,
    description: STUB_DESC,
  })
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
  @ApiOperation({
    summary: '[Stub] List calendar events',
    deprecated: true,
    description: STUB_DESC,
  })
  async listEvents(
    @Query('tenantId') tenantId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  @Get('availability')
  @ApiOperation({
    summary: '[Stub] Get availability',
    deprecated: true,
    description: STUB_DESC,
  })
  async getAvailability(
    @Query('tenantId') tenantId: string,
    @Query('contactId') contactId: string,
    @Query('date') date: string,
  ) {
    // TODO: Implement
    throw new Error('Not implemented');
  }
}
