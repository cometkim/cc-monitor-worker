import type { MessageCreateParams } from "@anthropic-ai/sdk/resources";

/**
 * Not directly used for calculating cost,
 * but may useful for guessing output token when it's not available.
 */
export interface NormalizedMessageParams {
  maxTokens: number,
  thinkingBudgetTokens: number | null,
  effort: string | null,
  temperature: number | null,
  topK: number | null,
  topP: number | null,
}

export function normalizeMessageParams(
  params: MessageCreateParams,
): NormalizedMessageParams {
  return {
    maxTokens: params.max_tokens,
    thinkingBudgetTokens: params.thinking?.type === "enabled" ? params.thinking.budget_tokens : null,
    effort: params.output_config?.effort ?? null,
    temperature: params.temperature ?? null,
    topK: params.top_k ?? null,
    topP: params.top_p ?? null,
  };
}
