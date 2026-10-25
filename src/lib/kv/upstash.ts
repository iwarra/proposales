import { Redis } from "@upstash/redis";
import { requireEnv } from "../env";
import type { Kv } from "./index";

const DELETE_IF_EQUALS = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export function createUpstashKv(): Kv {
  const redis = new Redis({
    url: requireEnv("UPSTASH_REDIS_REST_URL", { https: true }),
    token: requireEnv("UPSTASH_REDIS_REST_TOKEN"),
  });

  return {
    get: (key) => redis.get(key),
    mget: async (keys) => (keys.length === 0 ? [] : redis.mget(...keys)),
    async set(key, value, options = {}) {
      const result = options.ex
        ? options.nx
          ? await redis.set(key, value, { nx: true, ex: options.ex })
          : await redis.set(key, value, { ex: options.ex })
        : options.nx
          ? await redis.set(key, value, { nx: true })
          : await redis.set(key, value);
      return result === "OK";
    },
    async zaddNx(key, score, member) {
      await redis.zadd(key, { nx: true }, { score, member });
    },
    zrangeNewestFirst: (key) => redis.zrange<string[]>(key, 0, -1, { rev: true }),
    async deleteIfEquals(key, value) {
      return (await redis.eval<[string], number>(DELETE_IF_EQUALS, [key], [value])) === 1;
    },
  };
}
