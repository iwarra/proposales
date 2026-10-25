import { optionalEnv, requireEnv, requirePositiveInt } from "../env";
import type { ProposalBody } from "./body";

export type DraftRef = { uuid: string; url: string };

export type ProposalesClient = {
  createProposal(body: ProposalBody): Promise<DraftRef>;
  /** Searches by `data.enquiry_id`, archived drafts included. */
  findByEnquiryId(enquiryId: string): Promise<DraftRef | null>;
};

/** A failed Proposales request. The message is safe to show on the row. */
export class ProposalesError extends Error {
  name = "ProposalesError";
}

type Deps = {
  baseUrl: string;
  token: string;
  companyId: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const TIMEOUT_MS = 8_000;
const BACKOFF_MS = [250, 500]; // so at most 3 attempts

/**
 * Whether a failure is retried depends on whether it could have had an effect.
 * A search changes nothing. A create that got no answer or a 5xx may have created the draft.
 */
type Failure = { kind: "no-response"; message: string } | { kind: "status"; status: number; message: string };

function retryable(failure: Failure, idempotent: boolean): boolean {
  if (failure.kind === "no-response") return idempotent;
  if (failure.status === 429) return true;
  if (failure.status >= 500) return idempotent;
  return false;
}

async function statusFailure(response: Response): Promise<Failure> {
  const status = response.status;
  let message = `Proposales responded ${status}`;
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body?.error?.message === "string" && body.error.message) message = body.error.message;
  } catch {
    // Not JSON: keep the status message.
  }
  if (status === 401 || status === 403) {
    message = `Proposales rejected the API token or company id (${status}: ${message}). Check PROPOSALES_API_TOKEN and PROPOSALES_COMPANY_ID.`;
  }
  return { kind: "status", status, message };
}

function noResponse(error: unknown): Failure {
  const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.cause instanceof Error && error.cause.name === "TimeoutError");
  return { kind: "no-response", message: timedOut ? "Proposales didn't respond within 8 s." : "Couldn't reach Proposales." };
}

export function createProposalesClient(deps: Deps): ProposalesClient {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const headers = {
    Authorization: `Bearer ${deps.token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  async function request(path: string, init: RequestInit, idempotent: boolean): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      let failure: Failure;
      try {
        const response = await doFetch(`${deps.baseUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (response.ok) return await response.json().catch(() => null);
        failure = await statusFailure(response);
      } catch (error) {
        failure = noResponse(error);
      }
      if (attempt >= BACKOFF_MS.length || !retryable(failure, idempotent)) throw new ProposalesError(failure.message);
      await sleep(BACKOFF_MS[attempt]);
    }
  }

  return {
    async createProposal(body) {
      const result = (await request("/v3/proposals", { method: "POST", body: JSON.stringify(body) }, false)) as {
        proposal?: Partial<DraftRef>;
      } | null;
      const { uuid, url } = result?.proposal ?? {};
      if (!uuid || !url) throw new ProposalesError("Proposales returned no proposal id.");
      return { uuid, url };
    },

    async findByEnquiryId(enquiryId) {
      const query = new URLSearchParams({
        company_id: String(deps.companyId),
        "filter[enquiry_id]": enquiryId,
        include_archived: "true",
        limit: "1",
      });
      const result = (await request(`/v3/proposal-search?${query}`, { method: "GET" }, true)) as {
        data?: Partial<DraftRef>[];
      } | null;
      const [first] = result?.data ?? [];
      return first?.uuid && first.url ? { uuid: first.uuid, url: first.url } : null;
    },
  };
}

/** The client and company id from PROPOSALES_API_TOKEN, PROPOSALES_COMPANY_ID and PROPOSALES_API_URL. */
export function createProposalesClientFromEnv(): { client: ProposalesClient; companyId: number } {
  const companyId = requirePositiveInt("PROPOSALES_COMPANY_ID");
  const client = createProposalesClient({
    baseUrl: optionalEnv("PROPOSALES_API_URL", "https://api.proposales.com").replace(/\/+$/, ""),
    token: requireEnv("PROPOSALES_API_TOKEN"),
    companyId,
  });
  return { client, companyId };
}
