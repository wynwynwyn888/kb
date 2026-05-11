-- Preflight (run manually before applying if unsure):
-- SELECT ghl_location_id, count(*)
-- FROM public.tenant_ghl_connections
-- WHERE status = 'CONNECTED'
--   AND ghl_location_id IS NOT NULL
--   AND length(trim(ghl_location_id)) > 0
-- GROUP BY ghl_location_id
-- HAVING count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_ghl_connections_connected_location_uidx"
ON "public"."tenant_ghl_connections" ("ghl_location_id")
WHERE status = 'CONNECTED'
  AND "ghl_location_id" IS NOT NULL
  AND length(trim("ghl_location_id")) > 0;
