-- Tag rules: optional keyword hints for KEYWORD/HYBRID
ALTER TABLE "tenant_tag_rules" ADD COLUMN IF NOT EXISTS "keywords_json" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Booking: structured core field toggles + required flags
ALTER TABLE "tenant_booking_settings" ADD COLUMN IF NOT EXISTS "core_fields_json" JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE "tenant_booking_settings" AS t
SET "core_fields_json" = COALESCE(
  (
    SELECT jsonb_object_agg(elem, jsonb_build_object('enabled', true, 'required', true))
    FROM jsonb_array_elements_text(COALESCE(t.core_required_fields_json, '[]'::jsonb)) AS elem
  ),
  '{}'::jsonb
);

ALTER TABLE "tenant_booking_settings" DROP COLUMN IF EXISTS "core_required_fields_json";

-- Follow-up: active-hour timezone mode + weekly windows (stored only)
ALTER TABLE "tenant_follow_up_settings" ADD COLUMN IF NOT EXISTS "active_hours_timezone_mode" TEXT NOT NULL DEFAULT 'BUSINESS';
ALTER TABLE "tenant_follow_up_settings" ADD COLUMN IF NOT EXISTS "active_hours_windows_json" JSONB NOT NULL DEFAULT '{}'::jsonb;
