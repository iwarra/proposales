import { createModelFromEnv, readEnquiry } from "@/lib/ai";
import { createUpstashKv } from "@/lib/kv";
import type { ProcessDeps } from "@/lib/processing";
import { createProposalesClientFromEnv } from "@/lib/proposales";

let deps: ProcessDeps | null = null;

/** Redis, Proposales and the LLM, built once from the environment. Throws a message naming any bad variable. */
export function getDeps(): ProcessDeps {
  if (!deps) {
    const kv = createUpstashKv();
    const { client, companyId } = createProposalesClientFromEnv();
    const model = createModelFromEnv();
    deps = {
      kv,
      proposales: client,
      companyId,
      read: (enquiry, today) => readEnquiry(model, { columns: enquiry.columns, receivedAt: enquiry.receivedAt }, today),
    };
  }
  return deps;
}

/** Enquiry ids are content hashes. Anything else is rejected before touching Redis. */
export const isEnquiryId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{32}$/.test(id);
