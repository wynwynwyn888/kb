# Frontend - Next.js Dashboard

## Architecture

### Pages

- `/login` - User login (Supabase Auth)
- `/dashboard/agency` - Agency-level overview
- `/dashboard/tenant` - Tenant-scoped dashboard
- `/tenants` - Tenant switcher
- `/prompts` - Prompt editor
- `/knowledge` - Knowledge base management
- `/conversations` - Conversation logs
- `/quotas` - Quota status and history
- `/settings` - GHL connection, policies, team
- `/tester` - Bot tester tool

### Components

- `NavBar` - Basic navigation placeholder

### Lib

- `api.ts` - API client (needs auth headers and tenant context)
- `api-client.ts` - Placeholder for all API calls

### Hooks

Placeholder for common hooks:
- useAuth
- useTenant
- useAgency
- useConversation
- useQuota

## TODO

- Implement Supabase Auth integration
- Add tenant context provider
- Add agency context provider
- Connect all pages to actual API
- Add loading states and error handling
- Implement proper navigation with auth guards
- Add styling/layout (currently minimal placeholders)