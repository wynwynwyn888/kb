import { Body, Controller, Get, Patch, Post, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SessionUser } from '../../lib/supabase';
import { GhlService } from '../ghl/ghl.service';
import { BookingSettingsService } from './booking-settings.service';
import { TestBookingSlotsDto, TestCalendarConnectionDto } from './dto/booking-tools.dto';

@ApiTags('booking-settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tenants/:tenantId/booking-settings')
export class BookingSettingsController {
  constructor(
    private readonly bookingSettingsService: BookingSettingsService,
    private readonly ghlService: GhlService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get tenant booking automation settings' })
  async get(@Param('tenantId') tenantId: string, @CurrentUser() user: SessionUser) {
    await this.ghlService.ensureTenantAccessOrThrow(tenantId, user.id);
    return this.bookingSettingsService.getBookingSettings(tenantId);
  }

  @Patch()
  @ApiOperation({ summary: 'Update tenant booking automation settings' })
  async patch(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: SessionUser,
    @Body()
    body: Partial<{
      enabled: boolean;
      bookingMode: unknown;
      defaultGhlCalendarId: string | null;
      defaultGhlCalendarName: string | null;
      coreFieldsJson: unknown;
      customFieldsJson: unknown;
      maxBookingsPerSlot: unknown;
    }>,
  ) {
    await this.ghlService.ensureTenantAccessOrThrow(tenantId, user.id);
    return this.bookingSettingsService.patchBookingSettings(tenantId, body);
  }

  @Post('sync-calendars')
  @ApiOperation({ summary: 'Fetch calendars from GHL for this location' })
  async syncCalendars(@Param('tenantId') tenantId: string, @CurrentUser() user: SessionUser) {
    await this.ghlService.ensureTenantAccessOrThrow(tenantId, user.id);
    return this.bookingSettingsService.syncCalendars(tenantId, user.id);
  }

  @Post('test-calendar')
  @ApiOperation({ summary: 'Verify default calendar id is returned by GHL' })
  async testCalendar(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: SessionUser,
    @Body() body: TestCalendarConnectionDto,
  ) {
    await this.ghlService.ensureTenantAccessOrThrow(tenantId, user.id);
    return this.bookingSettingsService.testCalendar(tenantId, user.id, body ?? {});
  }

  @Post('test-slots')
  @ApiOperation({ summary: 'Sample free slots for the default calendar' })
  async testSlots(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: SessionUser,
    @Body() body: TestBookingSlotsDto,
  ) {
    await this.ghlService.ensureTenantAccessOrThrow(tenantId, user.id);
    return this.bookingSettingsService.testSlots(tenantId, user.id, body ?? {});
  }
}
