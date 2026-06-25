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

  /**
   * SET key value NX EX ttl.
   * - `acquired` — lock taken
   * - `held` — key already exists (another worker holds the lock)
   * - `unavailable` — Redis disabled or errored (caller should fall back to DB-only locking)
   */
  async setIfNotExists(
    key: string,
    value: unknown,
    ttlSec = DEFAULT_TTL_SEC,
  ): Promise<'acquired' | 'held' | 'unavailable'> {
    if (!this.redis) return 'unavailable';
    try {
      const res = await this.redis.set(key, JSON.stringify(value), 'EX', Math.max(5, ttlSec), 'NX');
      return res === 'OK' ? 'acquired' : 'held';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.debug(`App cache setIfNotExists failed key=${key}: ${msg}`);
      return 'unavailable';
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(key);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.debug(`App cache delete failed key=${key}: ${msg}`);
    }
  }

  /**
   * Acquire a distributed lock with owner token (extends setIfNotExists for conversation ordering).
   * Token should be a unique uuid per acquisition attempt.
   */
  async acquireLock(key: string, ownerToken: string, ttlSec: number): Promise<'acquired' | 'held' | 'unavailable'> {
    if (!this.redis) return 'unavailable';
    try {
      const res = await this.redis.set(key, ownerToken, 'EX', Math.max(5, ttlSec), 'NX');
      return res === 'OK' ? 'acquired' : 'held';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.debug(`App cache acquireLock failed key=${key}: ${msg}`);
      return 'unavailable';
    }
  }

  /**
   * Owner-safe lock release via Lua compare-and-delete. Only deletes if the stored value
   * matches the provided ownerToken, preventing accidental release by a stale holder.
   */
  async releaseLock(key: string, ownerToken: string): Promise<boolean> {
    if (!this.redis) return false;
    try {
      const script = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
      const result = await this.redis.eval(script, 1, key, ownerToken);
      return (result as number) > 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.debug(`App cache releaseLock failed key=${key}: ${msg}`);
      return false;
    }
  }

  /**
   * ZSET-based semaphore with stale-lease reaping (self-heals leaked slots on worker crash).
   * Returns true if slot was acquired, false if the cap is full.
   */
  async acquireSemaphore(
    classKey: string,
    memberId: string,
    cap: number,
    leaseSec = 60,
  ): Promise<boolean> {
    if (!this.redis) return true; // no Redis → allow (degraded)
    try {
      const script = `
        local now = tonumber(ARGV[1])
        local cap = tonumber(ARGV[2])
        local member = ARGV[3]
        local lease = tonumber(ARGV[4])
        redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - lease)
        if redis.call('ZCARD', KEYS[1]) >= cap then return 0 end
        redis.call('ZADD', KEYS[1], now, member)
        return 1
      `;
      const result = await this.redis.eval(script, 1, classKey, Date.now(), cap, memberId, leaseSec);
      return (result as number) === 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.debug(`App cache acquireSemaphore failed key=${classKey}: ${msg}`);
      return true; // allow on error (degraded, don't block)
    }
  }

  async releaseSemaphore(classKey: string, memberId: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.zrem(classKey, memberId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.debug(`App cache releaseSemaphore failed key=${classKey}: ${msg}`);
    }
  }
}
