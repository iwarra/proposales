import type { Reading } from "../ai";
import { decide } from "../decide";
import { keys, type Enquiry } from "../enquiries";
import { acquireLock, releaseLock, type Kv } from "../kv";
import { buildProposalBody, type DraftRef, type ProposalesClient } from "../proposales";

export type EnsureDraftResult =
  | { outcome: "created"; draft: DraftRef }
  | { outcome: "exists"; draft: DraftRef }
  | { outcome: "in_progress" }
  | { outcome: "blocked"; reasons: string[] };

type Deps = { kv: Kv; proposales: ProposalesClient; companyId: number };

/** Longer than the slowest create: a search plus a create, each at most 3 × 8 s. */
const DRAFT_LOCK_SECONDS = 60;

export const loadDraft = (kv: Kv, id: string) => kv.get<DraftRef>(keys.draft(id));

/** Write-once: if someone already saved an id, theirs is kept and returned. */
async function saveDraft(kv: Kv, id: string, draft: DraftRef): Promise<DraftRef> {
  if (await kv.set(keys.draft(id), draft, { nx: true })) return draft;
  return (await loadDraft(kv, id)) ?? draft;
}

/**
 * Creates every draft, exactly one per enquiry, with three guards:
 * 1. a saved draft id, 2. a per-enquiry lock, 3. a search in Proposales before creating.
 * Proposales errors are thrown as ProposalesError.
 */
export async function ensureDraft(deps: Deps, enquiry: Enquiry, reading: Reading, today: string): Promise<EnsureDraftResult> {
  const { kv, proposales } = deps;

  // Guard 1: the draft exists.
  const saved = await loadDraft(kv, enquiry.id);
  if (saved) return { outcome: "exists", draft: saved };

  // Nothing reaches Proposales that decide() would block.
  const decision = decide(reading, today);
  if (decision.action === "block") return { outcome: "blocked", reasons: decision.reasons };

  // Guard 2: only one request at a time reaches the create call.
  const lockKey = keys.draftLock(enquiry.id);
  const token = await acquireLock(kv, lockKey, DRAFT_LOCK_SECONDS);
  if (!token) {
    const draft = await loadDraft(kv, enquiry.id);
    return draft ? { outcome: "exists", draft } : { outcome: "in_progress" };
  }

  try {
    // Someone may have finished between guard 1 and taking the lock.
    const savedMeanwhile = await loadDraft(kv, enquiry.id);
    if (savedMeanwhile) return { outcome: "exists", draft: savedMeanwhile };

    // Guard 3: an earlier attempt may have crashed after Proposales created the draft.
    const found = await proposales.findByEnquiryId(enquiry.id);
    if (found) return { outcome: "exists", draft: await saveDraft(kv, enquiry.id, found) };

    const toCheck = decision.action === "draft_with_checks" ? decision.toCheck : [];
    const created = await proposales.createProposal(buildProposalBody({ enquiry, reading, toCheck, companyId: deps.companyId }));
    const draft = await saveDraft(kv, enquiry.id, created);
    return draft.uuid === created.uuid ? { outcome: "created", draft } : { outcome: "exists", draft };
  } finally {
    await releaseLock(kv, lockKey, token);
  }
}
