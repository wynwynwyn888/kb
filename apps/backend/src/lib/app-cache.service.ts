import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

const DEFAULT_TTL_SEC = 120;

@Injectable()
export class AppCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(AppCacheService.name);
  private readonly redis: Redis | null;

  constructor(config: ConfigService) {
    const disabled = String(process.env['APP_CACHE_DISABLED'] ?? '').trim().toLowerCase() === 'true';
    if (disabled) {
      this.redis = null;
      return;
    }
    const tlsRaw = (config.get<string>('REDIS_TLS') ?? '').trim().toLowerCase();
    const useTls = ['1', 'true', 'yes'].includes(tlsRaw);
    const password = config.get<string>('REDIS_PASSWORD')?.trim();
    const username = config.get<string>('REDIS_USER')?.trim();
    this.redis = new Redis({
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
      ...(useTls ? { tls: {} } : {}),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    this.redis.connect().catch((err: Error) => {
      this.logger.warn(`App cache Redis unavailable: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit();
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSec = DEFAULT_TTL_SEC): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', Math.max(5, ttlSec));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.debug(`App cache set failed key=${key}: ${msg}`);
    }
  }
}
