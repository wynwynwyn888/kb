# Shared Packages

## @aisbp/types

Shared TypeScript types, DTOs, and enums for the monorepo.

### Structure

```
types/
├── entities.ts    # Core entity interfaces (Agency, Tenant, Conversation, etc.)
├── dto.ts         # Data Transfer Objects for API requests/responses
└── enums.ts       # Re-exported enums for convenience
```

### Usage

```typescript
import { Agency, CreateTenantDto, TenantStatus } from '@aisbp/types';
```

## @aisbp/db

Database client setup using Prisma.

### Usage

```typescript
import { getPrismaClient } from '@aisbp/db';

const prisma = getPrismaClient();
```

## @aisbp/ghl-client

Typed wrapper for GoHighLevel API calls.

### Usage

```typescript
import { GhlClient, createGhlClient } from '@aisbp/ghl-client';

const client = await createGhlClient(accessToken, locationId);
const contact = await client.getContact(contactId);
```

## @aisbp/ai-router

Interfaces for AI model routing decisions.

### Usage

```typescript
import type { ModelRouter, RoutingDecision, RouteContext } from '@aisbp/ai-router';
```

## @aisbp/formatter

Interfaces for message formatting and bubble splitting.

### Usage

```typescript
import { DefaultMessageFormatter } from '@aisbp/formatter';

const formatter = new DefaultMessageFormatter();
const bubbles = formatter.splitIntoBubbles(longText, 1024);
```

## TODO

- Add @aisbp/config for shared configuration
- Add @aisbp/logger for shared logging
- Add @aisbp/validators for shared validation schemas