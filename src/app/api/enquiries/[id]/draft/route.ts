import { todayUtc } from "@/lib/enquiries";
import { createDraft } from "@/lib/processing";
import { getDeps, isEnquiryId } from "@/app/deps";

const STATUS = {
  created: 201,
  exists: 200,
  in_progress: 409,
  blocked: 422,
  not_read: 409,
  not_found: 404,
  failed: 502,
} as const;

/**
 * POST /api/enquiries/{id}/draft: create the draft for one enquiry, through ensureDraft().
 * Any number of concurrent calls create exactly one draft; the others get "exists" or "in_progress".
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/enquiries/[id]/draft">) {
  const { id } = await ctx.params;
  if (!isEnquiryId(id)) return Response.json({ outcome: "not_found" }, { status: 404 });

  let deps;
  try {
    deps = getDeps();
  } catch (error) {
    return Response.json({ outcome: "failed", error: error instanceof Error ? error.message : "Setup problem" }, { status: 500 });
  }
  const result = await createDraft(deps, id, todayUtc(Date.now()));
  return Response.json(result, { status: STATUS[result.outcome] });
}
