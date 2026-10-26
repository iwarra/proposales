/**
 * The few Redis operations the app needs. Upstash in the app, an in-memory fake in tests.
 * Values are JSON. Keys and members are strings.
 */
export type Kv = {
  get<T>(key: string): Promise<T | null>;
  mget<T>(keys: string[]): Promise<(T | null)[]>;
  /** Returns false when `nx` is set and the key already exists. `ex` is the expiry in seconds. */
  set(key: string, value: unknown, options?: { nx?: boolean; ex?: number }): Promise<boolean>;
  /** Adds the member only if it isn't there yet, so its first score is kept. */
  zaddNx(key: string, score: number, member: string): Promise<void>;
  /** All members, newest (highest score) first. */
  zrangeNewestFirst(key: string): Promise<string[]>;
  /** Deletes the key only while it still holds `value`. Returns whether it was deleted. */
  deleteIfEquals(key: string, value: string): Promise<boolean>;
};

export { acquireLock, releaseLock } from "./lock";
export { createMemoryKv } from "./memory";
export { createUpstashKv } from "./upstash";
