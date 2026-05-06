// Root application module
import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module';
import { AgenciesModule } from './modules/agencies/agencies.module';
import { AgencyUsersModule } from './modules/agency-users/agency-users.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { TenantUsersModule } from './modules/tenant-users/tenant-users.module';
import { GhlModule } from './modules/ghl/ghl.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { PromptsModule } from './modules/prompts/prompts.module';
import { KbModule } from './modules/kb/kb.module';
import { AiRouterModule } from './modules/ai-router/ai-router.module';
import { FormatterModule } from './modules/formatter/formatter.module';
import { OrchestrationModule } from './modules/orchestration/orchestration.module';
import { HandoverModule } from './modules/handover/handover.module';
import { QuotasModule } from './modules/quotas/quotas.module';
import { CalendarsModule } from './modules/calendars/calendars.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { AuditModule } from './modules/audit/audit.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { QueuesModule } from './queues/queues.module';
import { ActionIntentsModule } from './modules/action-intents/action-intents.module';
import { AgencyAiConfigModule } from './modules/agency-ai-config/agency-ai-config.module';
import { DebugModule } from './modules/debug/debug.module';
import { BookingSettingsModule } from './modules/booking-settings/booking-settings.module';
import { IntentTagsModule } from './modules/intent-tags/intent-tags.module';
import { FollowUpSettingsModule } from './modules/follow-up-settings/follow-up-settings.module';
import { FollowUpEngineModule } from './modules/follow-up-engine/follow-up-engine.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      // Support starting the API from repo root (`pnpm --filter ...`) or from `apps/backend`
      envFilePath: [
        resolve(process.cwd(), '.env'),
        resolve(process.cwd(), '..', '.env'),
        resolve(process.cwd(), 'apps', 'backend', '.env'),
        resolve(process.cwd(), '.env.local'),
        resolve(process.cwd(), '..', '.env.local'),
        resolve(process.cwd(), 'apps', 'backend', '.env.local'),
      ],
    }),

    // Rate limiting
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>('RATE_LIMIT_TTL', 60000),
            limit: config.get<number>('RATE_LIMIT_MAX', 100),
          },
        ],
      }),
    }),

    // Queue (BullMQ with Redis)
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const tlsRaw = (config.get<string>('REDIS_TLS') ?? '').trim().toLowerCase();
        const useTls = ['1', 'true', 'yes'].includes(tlsRaw);
        const password = config.get<string>('REDIS_PASSWORD')?.trim();
        const username = config.get<string>('REDIS_USER')?.trim();
        return {
          connection: {
            host: config.get<string>('REDIS_HOST', 'localhost'),
            port: config.get<number>('REDIS_PORT', 6379),
            ...(username ? { username } : {}),
            ...(password ? { password } : {}),
            ...(useTls ? { tls: {} } : {}),
            lazyConnect: true,
          },
        };
      },
    }),

    // Feature modules
    AuthModule,
    AgenciesModule,
    AgencyUsersModule,
    TenantsModule,
    TenantUsersModule,
    GhlModule,
    WebhooksModule,
    ConversationsModule,
    PromptsModule,
    KbModule,
    AiRouterModule,
    FormatterModule,
    OrchestrationModule,
    HandoverModule,
    QuotasModule,
    CalendarsModule,
    ContactsModule,
    AuditModule,
    NotificationsModule,
    QueuesModule,
    ActionIntentsModule,
    AgencyAiConfigModule,
    DebugModule,
    BookingSettingsModule,
    IntentTagsModule,
    FollowUpSettingsModule,
    FollowUpEngineModule,
  ],
  providers: [
    // Global rate limit guard
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}