import { randomUUID } from "node:crypto";
import type { Kv } from "./index";

/** `SET NX` with an expiry. Returns the holder's token, or null if someone else holds it. */
export async function acquireLock(kv: Kv, key: string, seconds: number): Promise<string | null> {
  const token = randomUUID();
  return (await kv.set(key, token, { nx: true, ex: seconds })) ? token : null;
}

/** Releases the lock only if this holder still has it. */
export async function releaseLock(kv: Kv, key: string, token: string): Promise<void> {
  await kv.deleteIfEquals(key, token);
}
