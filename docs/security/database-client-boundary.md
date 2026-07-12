# Database Client Privilege Boundary

Status: foundation deployed before any route cutover

## Clients

`createUserDatabaseClient(accessToken)` creates a new Supabase client using the anon key and the caller's raw JWT. PostgreSQL evaluates `auth.uid()` and RLS for this client. It is never process-memoized, logged, or stored in `SessionUser`.

`getInternalDatabaseClient()` returns the service-role client that bypasses RLS. It is reserved for classified workers, webhooks, migrations, controlled administration, and narrow internal adapters.

The older `getSupabaseService()` is deprecated legacy debt. This foundation does not replace existing callers yet, so production behavior is unchanged.

## Automated boundary

- Controllers may not reference the legacy or internal service-role clients.
- The current legacy consumer-file count is capped at 59 and may only decrease.
- The user client source must not reference the service-role key or logging APIs.
- Each user client is fresh and must carry a raw caller JWT in its Authorization header.
- Missing, whitespace-containing, pre-prefixed, or oversized tokens are rejected before client creation.

## Migration rule

Each resource group must introduce and behaviorally test its RLS policies before its user-facing reads switch to the caller client. Do not switch a route to the caller client while its table has RLS enabled but no applicable policy; that would turn valid reads into empty results.

The first route cutover must be read-only, staging-first, and independently reversible. Mutation client cutover requires separate `USING`/`WITH CHECK` policies and side-effect tests.
