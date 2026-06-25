-- Add nullable service menu options column to tenant_booking_settings.
-- BookingSettingsService.rowToDto (read) and patchBookingSettings (write) reference
-- service_menu_options, but no column existed -> every booking-settings save failed.
-- Additive, nullable, idempotent; no backfill required.
ALTER TABLE "tenant_booking_settings" ADD COLUMN IF NOT EXISTS "service_menu_options" JSONB;
