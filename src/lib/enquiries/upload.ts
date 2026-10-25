import type { Kv } from "../kv";
import { parseSheet, type RejectedRow } from "./parse";
import { saveUpload, type Enquiry } from "./store";

export type UploadResult =
  | { ok: true; added: Enquiry[]; duplicates: number; rejected: RejectedRow[] }
  | { ok: false; error: string };

/** Parse the file and store each row once. A file that can't be used stores nothing. */
export async function uploadSheet(kv: Kv, buffer: Buffer, fileName: string, now: number): Promise<UploadResult> {
  const parsed = parseSheet(buffer, fileName);
  if (!parsed.ok) return parsed;
  const { added, duplicates } = await saveUpload(kv, parsed.rows, now);
  return { ok: true, added, duplicates, rejected: parsed.rejected };
}
