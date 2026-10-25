import type { Reading, ReadResult } from "../ai";
import { ensureDraft, loadDraft, type EnsureDraftResult } from "../drafts";
import { keys, loadEnquiry, loadExtraction, saveExtraction, type Enquiry, type Extraction } from "../enquiries";
import { acquireLock, releaseLock, type Kv } from "../kv";
import { ProposalesError, type ProposalesClient } from "../proposales";

export type ProcessDeps = {
  kv: Kv;
  proposales: ProposalesClient;
  companyId: number;
  /** The AI call, with the model already bound. */
  read: (enquiry: Enquiry, today: string) => Promise<ReadResult>;
};

export type ProcessOutcome = "drafted" | "blocked" | "failed" | "in_progress" | "busy" | "not_found";

export type CreateDraftResult =
  | Exclude<EnsureDraftResult, { outcome: "blocked" }>
  | { outcome: "blocked"; reasons: string[] }
  | { outcome: "failed"; error: string }
  | { outcome: "not_read" }
  | { outcome: "not_found" };

/** Longer than the slowest run: an LLM call (45 s, retried twice) plus creating the draft. */
const PROCESS_LOCK_SECONDS = 5 * 60;
const CONCURRENCY = 4;

/** ensureDraft(), with the outcome saved on the row: an error to show, or a cleared one. */
async function draftStep(deps: ProcessDeps, enquiry: Enquiry, extraction: Extraction & { reading: Reading }, today: string) {
  try {
    const result = await ensureDraft(deps, enquiry, extraction.reading, today);
    if (extraction.error) await saveExtraction(deps.kv, enquiry.id, { reading: extraction.reading, error: null });
    return result;
  } catch (error) {
    const reason = error instanceof ProposalesError ? error.message : "something unexpected went wrong.";
    const message = `Couldn't create the draft in Proposales: ${reason}`;
    await saveExtraction(deps.kv, enquiry.id, { reading: extraction.reading, error: { stage: "draft", message } });
    return { outcome: "failed" as const, error: message };
  }
}

/** One row end to end: lock → read (skipped if already read) → decide → draft. Safe to run any number of times. */
export async function processEnquiry(deps: ProcessDeps, id: string, today: string): Promise<ProcessOutcome> {
  const lockKey = keys.processLock(id);
  const token = await acquireLock(deps.kv, lockKey, PROCESS_LOCK_SECONDS);
  if (!token) return "busy";

  try {
    const enquiry = await loadEnquiry(deps.kv, id);
    if (!enquiry) return "not_found";
    if (await loadDraft(deps.kv, id)) return "drafted";

    let extraction = await loadExtraction(deps.kv, id);
    if (!extraction?.reading) {
      const result = await deps.read(enquiry, today);
      extraction = result.ok
        ? { reading: result.reading, error: null }
        : { reading: null, error: { stage: "ai", message: `The AI couldn't read this enquiry: ${result.error}` } };
      await saveExtraction(deps.kv, id, extraction);
      if (!result.ok) return "failed";
    }

    const result = await draftStep(deps, enquiry, extraction as Extraction & { reading: Reading }, today);
    return result.outcome === "created" || result.outcome === "exists" ? "drafted" : result.outcome;
  } finally {
    await releaseLock(deps.kv, lockKey, token);
  }
}

/** The Create draft button and the draft route. Goes through ensureDraft() like every other draft. */
export async function createDraft(deps: ProcessDeps, id: string, today: string): Promise<CreateDraftResult> {
  const [enquiry, extraction] = await Promise.all([loadEnquiry(deps.kv, id), loadExtraction(deps.kv, id)]);
  if (!enquiry) return { outcome: "not_found" };
  if (!extraction?.reading) return { outcome: "not_read" };
  return draftStep(deps, enquiry, extraction as Extraction & { reading: Reading }, today);
}

/** Processes rows in the background, a few at a time. One row failing never stops the others. */
export async function processMany(
  deps: ProcessDeps,
  ids: string[],
  today: string,
  options: { log?: (message: string, error: unknown) => void } = {},
): Promise<void> {
  const log = options.log ?? ((message, error) => console.error(message, error));
  const queue = [...ids];
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      try {
        await processEnquiry(deps, id, today);
      } catch (error) {
        log(`Processing enquiry ${id} failed`, error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
}
