"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { todayUtc, uploadSheet, type RejectedRow } from "@/lib/enquiries";
import { createDraft, processEnquiry, processMany } from "@/lib/processing";
import { getDeps, isEnquiryId } from "./deps";

export type UploadState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "done"; added: number; duplicates: number; rejected: RejectedRow[] };

const setupProblem = (error: unknown) =>
  `Setup problem: ${error instanceof Error ? error.message : "the app couldn't start."}`;

export async function uploadEnquiries(_previous: UploadState, formData: FormData): Promise<UploadState> {
  const file = formData.get("file");
  if (!(file instanceof File) || (file.size === 0 && !file.name)) return { kind: "error", message: "Choose a .csv or .xlsx file to upload." };

  let deps;
  try {
    deps = getDeps();
  } catch (error) {
    return { kind: "error", message: setupProblem(error) };
  }

  const now = Date.now();
  const result = await uploadSheet(deps.kv, Buffer.from(await file.arrayBuffer()), file.name, now);
  if (!result.ok) return { kind: "error", message: result.error };

  // The AI reads the new rows after the response is sent, 4 at a time.
  const ids = result.added.map((enquiry) => enquiry.id);
  if (ids.length > 0) after(() => processMany(deps, ids, todayUtc(now)));
  refresh();
  return { kind: "done", added: ids.length, duplicates: result.duplicates, rejected: result.rejected };
}

/** Safe to click any number of times: the row lock and the three draft guards make repeats no-ops. */
export async function retryEnquiry(id: string): Promise<void> {
  if (!isEnquiryId(id)) return;
  const deps = getDeps();
  after(() => processEnquiry(deps, id, todayUtc(Date.now())).catch((error) => console.error(`Retry of ${id} failed`, error)));
  refresh();
}

const CREATE_MESSAGES = {
  created: "Draft created.",
  exists: "The draft already exists.",
  in_progress: "The draft is being created right now.",
  blocked: "This enquiry is blocked, so no draft was created.",
  not_read: "The AI hasn't read this enquiry yet.",
  not_found: "This enquiry no longer exists.",
} as const;

export async function createDraftNow(id: string): Promise<{ message: string; failed: boolean }> {
  if (!isEnquiryId(id)) return { message: CREATE_MESSAGES.not_found, failed: true };
  const result = await createDraft(getDeps(), id, todayUtc(Date.now()));
  refresh();
  if (result.outcome === "failed") return { message: result.error, failed: true };
  return { message: CREATE_MESSAGES[result.outcome], failed: result.outcome === "blocked" || result.outcome === "not_found" };
}
