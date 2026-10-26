import type { Kv } from "./index";

/** In-memory Kv for tests. `now` drives expiries. */
export function createMemoryKv(now: () => number = Date.now): Kv {
  const values = new Map<string, { json: string; expiresAt: number }>();
  const sets = new Map<string, Map<string, number>>();

  const read = (key: string) => {
    const entry = values.get(key);
    if (entry && entry.expiresAt <= now()) values.delete(key);
    return values.get(key)?.json;
  };

  return {
    async get<T>(key: string) {
      const json = read(key);
      return json === undefined ? null : (JSON.parse(json) as T);
    },
    async mget<T>(keys: string[]) {
      return keys.map((key) => {
        const json = read(key);
        return json === undefined ? null : (JSON.parse(json) as T);
      });
    },
    async set(key, value, options = {}) {
      if (options.nx && read(key) !== undefined) return false;
      const expiresAt = options.ex ? now() + options.ex * 1000 : Infinity;
      values.set(key, { json: JSON.stringify(value), expiresAt });
      return true;
    },
    async zaddNx(key, score, member) {
      const set = sets.get(key) ?? new Map<string, number>();
      if (!set.has(member)) set.set(member, score);
      sets.set(key, set);
    },
    async zrangeNewestFirst(key) {
      return [...(sets.get(key) ?? new Map<string, number>())].sort((a, b) => b[1] - a[1]).map(([member]) => member);
    },
    async deleteIfEquals(key, value) {
      if (read(key) !== JSON.stringify(value)) return false;
      values.delete(key);
      return true;
    },
  };
}
