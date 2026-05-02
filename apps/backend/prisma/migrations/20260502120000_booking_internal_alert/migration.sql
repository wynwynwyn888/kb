-- Internal staff booking alert + persistence metadata (no secrets)
ALTER TABLE "tenant_booking_settings" ADD COLUMN IF NOT EXISTS "internal_booking_alert_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenant_booking_settings" ADD COLUMN IF NOT EXISTS "internal_booking_alert_number" TEXT;
ALTER TABLE "tenant_booking_settings" ADD COLUMN IF NOT EXISTS "internal_booking_alert_channel" TEXT NOT NULL DEFAULT 'GHL_MESSAGE';
ALTER TABLE "tenant_booking_settings" ADD COLUMN IF NOT EXISTS "internal_booking_alert_template" TEXT;
