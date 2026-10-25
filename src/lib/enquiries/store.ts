import { createHash } from "node:crypto";
import type { Reading } from "../ai";
import type { Kv } from "../kv";
import type { ParsedRow } from "./parse";

/** A stored row. Its id is a hash of its content, so the same row is always the same enquiry. */
export type Enquiry = ParsedRow & { id: string; uploadedAt: number };

/** The AI's reading of a row, plus the last error. A failed AI call leaves `reading` null. */
export type Extraction = {
  reading: Reading | null;
  error: { stage: "ai" | "draft"; message: string } | null;
};

export const keys = {
  enquiries: "enquiries",
  enquiry: (id: string) => `enquiry:${id}`,
  extraction: (id: string) => `extraction:${id}`,
  draft: (id: string) => `draft:${id}`,
  processLock: (id: string) => `process-lock:${id}`,
  draftLock: (id: string) => `draft-lock:${id}`,
};

export function contentId(row: ParsedRow): string {
  const cells = Object.entries(row.columns).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(cells)).digest("hex").slice(0, 32);
}

/** Saves each row once (`SET NX`). A row seen before is counted as a duplicate. */
export async function saveUpload(kv: Kv, rows: ParsedRow[], now: number): Promise<{ added: Enquiry[]; duplicates: number }> {
  const added: Enquiry[] = [];
  let duplicates = 0;
  for (const row of rows) {
    const enquiry: Enquiry = { ...row, id: contentId(row), uploadedAt: now };
    const isNew = await kv.set(keys.enquiry(enquiry.id), enquiry, { nx: true });
    // Listed for duplicates too: repairs a crash between the two writes. The first score is kept.
    await kv.zaddNx(keys.enquiries, now, enquiry.id);
    if (isNew) added.push(enquiry);
    else duplicates++;
  }
  return { added, duplicates };
}

export const loadEnquiry = (kv: Kv, id: string) => kv.get<Enquiry>(keys.enquiry(id));

export const loadExtraction = (kv: Kv, id: string) => kv.get<Extraction>(keys.extraction(id));
export const saveExtraction = (kv: Kv, id: string, extraction: Extraction) => kv.set(keys.extraction(id), extraction);
