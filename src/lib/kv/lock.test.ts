import { describe, expect, it } from "vitest";
import { acquireLock, releaseLock } from "./lock";
import { createMemoryKv } from "./memory";

describe("locks", () => {
  it("lets only one holder in", async () => {
    const kv = createMemoryKv();
    const first = await acquireLock(kv, "lock:a", 60);
    expect(first).toEqual(expect.any(String));
    expect(await acquireLock(kv, "lock:a", 60)).toBeNull();
  });

  it("gives each holder a unique token", async () => {
    const kv = createMemoryKv();
    const a = await acquireLock(kv, "lock:a", 60);
    const b = await acquireLock(kv, "lock:b", 60);
    expect(a).not.toBe(b);
  });

  it("frees the lock when it expires, so a crashed worker can't hold it forever", async () => {
    let now = 0;
    const kv = createMemoryKv(() => now);
    await acquireLock(kv, "lock:a", 60);
    now = 59_999;
    expect(await acquireLock(kv, "lock:a", 60)).toBeNull();
    now = 60_000;
    expect(await acquireLock(kv, "lock:a", 60)).toEqual(expect.any(String));
  });

  it("is released only by the worker holding it", async () => {
    let now = 0;
    const kv = createMemoryKv(() => now);
    const stale = (await acquireLock(kv, "lock:a", 60))!;
    now = 60_000; // expired: a second worker takes over
    const current = (await acquireLock(kv, "lock:a", 60))!;

    await releaseLock(kv, "lock:a", stale);
    expect(await acquireLock(kv, "lock:a", 60)).toBeNull();

    await releaseLock(kv, "lock:a", current);
    expect(await acquireLock(kv, "lock:a", 60)).toEqual(expect.any(String));
  });
});

describe("memory kv", () => {
  it("writes once with nx", async () => {
    const kv = createMemoryKv();
    expect(await kv.set("k", { v: 1 }, { nx: true })).toBe(true);
    expect(await kv.set("k", { v: 2 }, { nx: true })).toBe(false);
    expect(await kv.get("k")).toEqual({ v: 1 });
    expect(await kv.mget(["k", "missing"])).toEqual([{ v: 1 }, null]);
  });

  it("keeps the first score and lists newest first", async () => {
    const kv = createMemoryKv();
    await kv.zaddNx("z", 1, "a");
    await kv.zaddNx("z", 2, "b");
    await kv.zaddNx("z", 3, "a");
    expect(await kv.zrangeNewestFirst("z")).toEqual(["b", "a"]);
  });

  it("returns copies, like a real store", async () => {
    const kv = createMemoryKv();
    const value = { list: [1] };
    await kv.set("k", value);
    value.list.push(2);
    expect(await kv.get("k")).toEqual({ list: [1] });
  });
});
