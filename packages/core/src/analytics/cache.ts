import type { Clock } from "../clock.ts";

export type CacheSubscriber = (message: string) => void;

export interface HotCache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  incr(key: string, ttlMs: number, delta?: number): Promise<number>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, handler: CacheSubscriber): () => void;
  size(): number;
  clear(): void;
}

export interface MemoryHotCacheOptions {
  clock: Clock;
  maxEntries?: number;
}

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

export class MemoryHotCache implements HotCache {
  private readonly clock: Clock;
  private readonly maxEntries: number;
  private readonly store = new Map<string, CacheEntry>();
  private readonly channels = new Map<string, Set<CacheSubscriber>>();

  constructor(options: MemoryHotCacheOptions) {
    this.clock = options.clock;
    this.maxEntries = Math.max(1, options.maxEntries ?? 10_000);
  }

  private isExpired(entry: CacheEntry, now: number): boolean {
    return now >= entry.expiresAt;
  }

  private evictIfNeeded(now: number): void {
    for (const [key, entry] of this.store) {
      if (this.isExpired(entry, now)) this.store.delete(key);
    }
    while (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.store.delete(oldestKey);
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    const now = this.clock.now();
    if (this.isExpired(entry, now)) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    if (ttlMs <= 0) {
      this.store.delete(key);
      return;
    }
    const now = this.clock.now();
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      this.evictIfNeeded(now);
    }
    this.store.set(key, { value, expiresAt: now + ttlMs });
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async incr(key: string, ttlMs: number, delta = 1): Promise<number> {
    const now = this.clock.now();
    const existing = this.store.get(key);
    if (existing && !this.isExpired(existing, now) && typeof existing.value === "number") {
      const next = existing.value + delta;
      this.store.delete(key);
      this.store.set(key, { value: next, expiresAt: existing.expiresAt });
      return next;
    }
    if (this.store.size >= this.maxEntries) {
      this.evictIfNeeded(now);
    }
    this.store.set(key, { value: delta, expiresAt: now + Math.max(1, ttlMs) });
    return delta;
  }

  async publish(channel: string, message: string): Promise<number> {
    const listeners = this.channels.get(channel);
    if (!listeners || listeners.size === 0) return 0;
    let delivered = 0;
    for (const handler of [...listeners]) {
      handler(message);
      delivered += 1;
    }
    return delivered;
  }

  subscribe(channel: string, handler: CacheSubscriber): () => void {
    let listeners = this.channels.get(channel);
    if (!listeners) {
      listeners = new Set();
      this.channels.set(channel, listeners);
    }
    listeners.add(handler);
    return () => {
      const current = this.channels.get(channel);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) this.channels.delete(channel);
    };
  }

  size(): number {
    const now = this.clock.now();
    for (const [key, entry] of this.store) {
      if (this.isExpired(entry, now)) this.store.delete(key);
    }
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}
