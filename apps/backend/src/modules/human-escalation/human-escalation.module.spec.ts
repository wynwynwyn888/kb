import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { NestFactory } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { AppCacheModule } from '../../lib/app-cache.module';
import { HumanEscalationModule } from './human-escalation.module';

describe('HumanEscalationModule wiring', () => {
  it('imports AuthModule so JwtAuthGuard can resolve AuthService (would catch production DI crash)', () => {
    const imports = (Reflect.getMetadata('imports', HumanEscalationModule) ?? []) as unknown[];
    expect(imports).toContain(AuthModule);
  });
});

/**
 * Minimal root: ConfigModule supplies JwtModule.registerAsync in AuthModule.
 * Compiling the graph verifies HumanEscalationSettingsController + JwtAuthGuard DI.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
    }),
    BullModule.forRoot({
      connection: { host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null },
    }),
    AppCacheModule,
    HumanEscalationModule,
  ],
})
class HumanEscalationBootstrapSpecRoot {}

describe('HumanEscalationModule bootstrap', () => {
  it('creates application context without JwtAuthGuard / AuthService DI errors', async () => {
    const app = await NestFactory.createApplicationContext(HumanEscalationBootstrapSpecRoot, {
      logger: false,
    });
    await app.close();
  });
});
