import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { optionalEnv, requireEnv } from "../env";

const ATTEMPT_TIMEOUT_MS = 45_000;

/** Every HTTP attempt gets its own timeout, so the SDK's retries each get the full 45 s. */
const fetchWithTimeout: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)])
      : AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
  });

/** The model behind the LLM proxy, from LLM_PROXY_URL, LLM_PROXY_KEY, LLM_MODEL and LLM_PROXY_FORMAT. */
export function createModelFromEnv(): LanguageModel {
  const baseURL = requireEnv("LLM_PROXY_URL", { https: "or-tailscale" });
  const apiKey = requireEnv("LLM_PROXY_KEY");
  const modelId = optionalEnv("LLM_MODEL", "claude-sonnet-5-5");
  const format = optionalEnv("LLM_PROXY_FORMAT", "anthropic");

  if (format === "anthropic") return createAnthropic({ baseURL, apiKey, fetch: fetchWithTimeout })(modelId);
  if (format === "openai") {
    return createOpenAICompatible({ name: "llm-proxy", baseURL, apiKey, supportsStructuredOutputs: true, fetch: fetchWithTimeout })(modelId);
  }
  throw new Error("LLM_PROXY_FORMAT must be anthropic or openai.");
}
