import { IsOptional, IsString } from 'class-validator';

/** Optional calendar override for CRM tools (uses unsaved dropdown selection). */
export class TestCalendarConnectionDto {
  @IsOptional()
  @IsString()
  calendarId?: string;
}

/**
 * Test free slots: prefer `selectedDate` + `selectedTime` (CRM-local wall time).
 * Legacy `startDate` / `endDate` (YYYY-MM-DD) still accepted for older clients.
 */
export class TestBookingSlotsDto {
  @IsOptional()
  @IsString()
  selectedDate?: string;

  @IsOptional()
  @IsString()
  selectedTime?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  calendarId?: string;
}

/** Diagnostic probe — tries multiple GHL free-slots API variants (no tokens returned). */
export class ProbeFreeSlotsDto {
  @IsString()
  calendarId!: string;

  @IsString()
  selectedDate!: string;

  @IsOptional()
  @IsString()
  selectedTime?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  timezone?: string;
}
