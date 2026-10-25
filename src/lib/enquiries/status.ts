import type { Reading } from "../ai";
import { decide } from "../decide";
import type { Kv } from "../kv";
import { keys, type Enquiry, type Extraction } from "./store";

type Draft = { uuid: string; url: string };

export type RowStatus =
  | { status: "drafted"; draft: Draft }
  | { status: "reading" }
  | { status: "received"; stuck: boolean }
  | { status: "failed"; stage: "ai" | "draft"; error: string }
  | { status: "blocked"; reasons: string[] }
  | { status: "ready" };

export type Row = { enquiry: Enquiry; reading: Reading | null; status: RowStatus };

/** A row not read this long after upload, with no worker on it, gets a Retry button. */
export const STUCK_AFTER_MS = 60_000;

/** Statuses are never stored. The first rule that matches wins. */
export function rowStatus(input: {
  enquiry: Enquiry;
  extraction: Extraction | null;
  draft: Draft | null;
  locked: boolean;
  now: number;
  today: string;
}): RowStatus {
  const { enquiry, extraction, draft, locked, now, today } = input;
  if (draft) return { status: "drafted", draft };
  if (locked) return { status: "reading" };
  if (!extraction) return { status: "received", stuck: now - enquiry.uploadedAt >= STUCK_AFTER_MS };
  if (extraction.error) return { status: "failed", stage: extraction.error.stage, error: extraction.error.message };
  if (!extraction.reading) return { status: "received", stuck: true };
  const decision = decide(extraction.reading, today);
  if (decision.action === "block") return { status: "blocked", reasons: decision.reasons };
  return { status: "ready" };
}

/** Every uploaded row with its status, newest upload first. */
export async function listRows(kv: Kv, now: number, today: string): Promise<Row[]> {
  const ids = await kv.zrangeNewestFirst(keys.enquiries);
  if (ids.length === 0) return [];
  const [enquiries, extractions, drafts, locks] = await Promise.all([
    kv.mget<Enquiry>(ids.map(keys.enquiry)),
    kv.mget<Extraction>(ids.map(keys.extraction)),
    kv.mget<Draft>(ids.map(keys.draft)),
    kv.mget<string>(ids.map(keys.processLock)),
  ]);
  return ids.flatMap((_, i) => {
    const enquiry = enquiries[i];
    if (!enquiry) return [];
    const extraction = extractions[i];
    const status = rowStatus({ enquiry, extraction, draft: drafts[i], locked: locks[i] !== null, now, today });
    return [{ enquiry, reading: extraction?.reading ?? null, status }];
  });
}

/** Today's date in UTC, as decide() expects it. */
export const todayUtc = (now: number) => new Date(now).toISOString().slice(0, 10);
