// Root application module
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

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
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
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
      }),
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