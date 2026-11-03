import Redis from "ioredis";
import { logger } from "./logger";

let redisClient: Redis | null = null;
let isRedisConnected = false;

const redisUrl = process.env.REDIS_URL || process.env.SUPABASE_REDIS_URL;

// Local In-Memory Cache Fallback with TTL and size-based eviction to prevent memory leaks
interface CacheEntry {
  value: string;
  expiresAt: number;
}
const localCacheStore = new Map<string, CacheEntry>();

export function getLocalCacheSize(): number {
  return localCacheStore.size;
}

export function enforceLocalCacheEviction(maxItems?: number): number {
  const limit = maxItems || parseInt(process.env.CACHE_MAX_ITEMS || "1000", 10);
  let evictedCount = 0;
  if (localCacheStore.size > limit) {
    const keysToDeleteCount = localCacheStore.size - limit;
    const keys = Array.from(localCacheStore.keys());
    for (let i = 0; i < keysToDeleteCount; i++) {
      localCacheStore.delete(keys[i]);
      evictedCount++;
    }
    logger.info({ keysEvicted: evictedCount }, "Local cache item count exceeded limit. Evicted oldest entries.");
  }
  return evictedCount;
}

export function pruneExpiredCacheEntries(): number {
  const now = Date.now();
  let deletedCount = 0;
  for (const [key, entry] of localCacheStore.entries()) {
    if (entry.expiresAt < now) {
      localCacheStore.delete(key);
      deletedCount++;
    }
  }
  if (deletedCount > 0) {
    logger.debug({ deletedCount }, "Pruned expired local cache entries.");
  }
  return deletedCount;
}

if (redisUrl && redisUrl !== "undefined" && redisUrl !== "null" && redisUrl.trim() !== "") {
  try {
    logger.info("Initializing ioredis client...");
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null, // Required for BullMQ compatibility
      connectTimeout: 5000,
    });

    redisClient.on("connect", () => {
      isRedisConnected = true;
      logger.info("Redis client connected successfully!");
    });

    redisClient.on("error", (err) => {
      isRedisConnected = false;
      logger.warn({ error: err.message }, "Redis connection error, falling back to local storage.");
    });
  } catch (err: any) {
    logger.warn({ error: err.message }, "Could not initialize Redis client, using local memory instead.");
  }
} else {
  logger.info("No REDIS_URL environment variable found. Redis caching and rate limiting is in local in-memory mode.");
}

export function getRedisClient(): Redis | null {
  return isRedisConnected ? redisClient : null;
}

export async function cacheGet(key: string): Promise<string | null> {
  const client = getRedisClient();
  if (client) {
    try {
      return await client.get(key);
    } catch (err: any) {
      logger.error({ error: err.message, key }, "Redis get error. Falling back to local memory cache.");
    }
  }

  // Fallback to local memory cache
  const entry = localCacheStore.get(key);
  if (!entry) return null;

  if (entry.expiresAt < Date.now()) {
    localCacheStore.delete(key);
    return null;
  }
  return entry.value;
}

export async function cacheSet(key: string, value: string, ttlSeconds = 300): Promise<void> {
  const client = getRedisClient();
  if (client) {
    try {
      await client.set(key, value, "EX", ttlSeconds);
      return;
    } catch (err: any) {
      logger.error({ error: err.message, key }, "Redis set error. Storing in local memory cache instead.");
    }
  }

  // Fallback to local memory cache
  localCacheStore.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
  enforceLocalCacheEviction();
}

export async function cacheDel(key: string): Promise<void> {
  const client = getRedisClient();
  if (client) {
    try {
      await client.del(key);
      return;
    } catch (err: any) {
      logger.error({ error: err.message, key }, "Redis delete error. Deleting from local memory cache.");
    }
  }

  // Fallback to local memory cache
  localCacheStore.delete(key);
}

export async function cacheFlushPattern(pattern: string): Promise<void> {
  const client = getRedisClient();
  if (client) {
    try {
      const keys = await client.keys(pattern);
      if (keys.length > 0) {
        await client.del(...keys);
      }
      return;
    } catch (err: any) {
      logger.error({ error: err.message, pattern }, "Redis keys pattern flush error. Flushing local memory cache.");
    }
  }

  // Fallback to local memory cache
  const regexPattern = "^" + pattern.replace(/[-[\]{}()+?.,\\^$|#\s]/g, "\\$&").replace(/\\\*/g, ".*") + "$";
  const regex = new RegExp(regexPattern);
  let deletedCount = 0;
  for (const key of localCacheStore.keys()) {
    if (regex.test(key)) {
      localCacheStore.delete(key);
      deletedCount++;
    }
  }
  if (deletedCount > 0) {
    logger.info({ pattern, deletedCount }, "Local cache pattern flush cleared matching items.");
  }
}
