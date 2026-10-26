import { APICallError, generateText, NoObjectGeneratedError, Output, RetryError, type LanguageModel } from "ai";
import { buildPrompt, SYSTEM_PROMPT } from "./prompt";
import { readingSchema, type Reading } from "./schema";

export type ReadResult = { ok: true; reading: Reading } | { ok: false; error: string };

type Input = { columns: Record<string, string>; receivedAt: string | null };

/** The SDK retries twice. Each attempt has its own 45 s timeout, set on the model's fetch (see model.ts). */
const MAX_RETRIES = 2;

/** One LLM call per row. Never throws: a failure comes back as a reason to show on the row. */
export async function readEnquiry(
  model: LanguageModel,
  input: Input,
  today: string,
  options: { maxRetries?: number } = {},
): Promise<ReadResult> {
  try {
    const { output } = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(input, today),
      output: Output.object({ schema: readingSchema }),
      maxRetries: options.maxRetries ?? MAX_RETRIES,
    });
    return { ok: true, reading: output };
  } catch (error) {
    return { ok: false, error: describeFailure(error) };
  }
}

function describeFailure(error: unknown): string {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  if (NoObjectGeneratedError.isInstance(cause)) return "its answer didn't have the expected shape.";
  if (isTimeout(cause)) return "the AI took too long to answer.";
  if (APICallError.isInstance(cause)) {
    return cause.statusCode ? `the AI service responded ${cause.statusCode}.` : "the AI service couldn't be reached.";
  }
  return "something unexpected went wrong.";
}

function isTimeout(error: unknown): boolean {
  for (let e = error; e instanceof Error; e = e.cause) {
    if (e.name === "TimeoutError") return true;
  }
  return false;
}
