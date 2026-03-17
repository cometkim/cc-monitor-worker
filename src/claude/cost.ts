import type {
  Message,
  RawMessageDeltaEvent,
} from "@anthropic-ai/sdk/resources";

export type NormalizedUsage = (
  | NormalizedUsage_Start
  | NormalizedUsage_EndTurn
);

type NormalizedUsagePayload = {
  messageId: string,

  model: string,
  inferenceGeo: "not_available" | "us_only",
  serviceTier: "standard" | "priority" | "batch",
  speed: "fast" | null,

  inputTokens: number;
  cacheRead: number;
  cacheCreation_5m: number;
  cacheCreation_1h: number;

  /**
   * Calculated by regular input tokens + cache usage.
   *
   * When this value is over 200K, entire turn is charged as long context.
   *
   * @see https://platform.claude.com/docs/en/about-claude/pricing#long-context-pricing
   */
  effectiveInputTokens: number;

  // Server tools
  webFetchRequests: number;
  webSearchRequests: number;
};

export type NormalizedUsage_Start = NormalizedUsagePayload & {
  state: "start",

  /** 
   * Output tokens usage is not completed in the beginning of the stream.
   */
  outputTokens: number;
}

export type NormalizedUsage_EndTurn = NormalizedUsagePayload & {
  state: "end_turn",

  /** 
   * Finalized output token usage is only available when the turn is completed.
   */
  outputTokens: number;
}

export function normalizeUsage({ id, model, usage }: Message): NormalizedUsage_Start {
  const inputTokens = usage.input_tokens;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreation_5m = usage.cache_creation?.ephemeral_5m_input_tokens ?? 0;
  const cacheCreation_1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;

  const effectiveInputTokens = inputTokens + cacheRead + cacheCreation_5m + cacheCreation_1h;

  const inferenceGeo = (usage.inference_geo ?? "not_available") as NormalizedUsage_Start['inferenceGeo'];
  const serviceTier = usage.service_tier ?? "standard";

  // See https://platform.claude.com/docs/en/build-with-claude/fast-mode
  const speed = "speed" in usage && usage.speed === "fast"
    ? "fast" : null;

  const webFetchRequests = usage.server_tool_use?.web_fetch_requests?? 0;
  const webSearchRequests = usage.server_tool_use?.web_search_requests ?? 0;

  return {
    state: "start",
    messageId: id,
    model,
    inferenceGeo,
    serviceTier,
    speed,
    inputTokens,
    cacheRead,
    cacheCreation_5m,
    cacheCreation_1h,
    effectiveInputTokens,
    webFetchRequests,
    webSearchRequests,
    outputTokens: usage.output_tokens,
  };
}

export function normalizeEndTurnUsage(
  usage: NormalizedUsage,
  event: RawMessageDeltaEvent,
): NormalizedUsage_EndTurn {
  return {
    ...usage,
    state: "end_turn",
    outputTokens: event.usage.output_tokens,
  };
}

export interface ModelUnitPrice {
  input: number;
  output: number;
}

const MODEL_PRICES: [prefix: string, price: ModelUnitPrice][] = [
  // Haiku Series
  ["claude-haiku-4-5",  { input: 1, output: 5 }],
  ["claude-3-5-haiku",  { input: 0.8, output: 4 }],
  ["claude-3-haiku",    { input: 0.25, output: 1.25 }],

  // Sonnet Series
  ["claude-sonnet-4-6", { input: 3, output: 15 }],
  ["claude-sonnet-4-5", { input: 3, output: 15 }],
  ["claude-sonnet-4-0", { input: 3, output: 15 }],
  ["claude-sonnet-4",   { input: 3, output: 15 }],
  ["claude-3-7-sonnet", { input: 3, output: 15 }],
  ["claude-3-5-sonnet", { input: 3, output: 15 }],

  // Opus Series
  ["claude-opus-4-6",   { input: 5, output: 25 }],
  ["claude-opus-4-5",   { input: 5, output: 25 }],
  ["claude-opus-4-1",   { input: 15, output: 75 }],
  ["claude-opus-4-0",   { input: 15, output: 75 }],
  ["claude-opus-4",     { input: 15, output: 75 }],
  ["claude-3-opus",     { input: 15, output: 75 }],
];

export function getModelUnitPrice(model: string): ModelUnitPrice | null {
  for (const [prefix, prices] of MODEL_PRICES) {
    if (model.startsWith(prefix)) {
      return prices;
    }
  }
  return null;
}

/**
 * @see https://platform.claude.com/docs/en/api/service-tiers
 */
export const CostMultiplier = {
  Cache_Read: 0.1,
  Cache_Creation_5m: 1.25,
  Cache_Creation_1h: 2,
  Long_Context_Input: 2,
  Long_Context_Output: 1.5,
  US_Only: 1.1,

  // NOTE: Claude Code never uses batch requests (at least for now)
  Batch: 0.5,

  // Currently only available for Opus 4.6
  Fast_Mode: 6,
} as const;

export interface Cost {
  input: number;
  cacheRead: number;
  cacheCreation_5m: number;
  cacheCreation_1h: number;
  output: number;
}

/**
 * @see https://platform.claude.com/docs/en/about-claude/pricing
 */
export function calculateCost(usage: NormalizedUsage): Cost {
  const MTok = 1_000_000;

  const isFastMode = usage.speed === "fast";
  // According to the docs: https://platform.claude.com/docs/en/about-claude/pricing#fast-mode-pricing
  // Fast mode pricing applies across the full context window, including requests over 200k input tokens.
  const isLongContext = !isFastMode && usage.effectiveInputTokens > 200_000;
  const isUSOnly = usage.inferenceGeo === "us_only";

  let baseMultiplier = 1;
  if (isFastMode) baseMultiplier *= CostMultiplier.Fast_Mode;
  if (usage.serviceTier === "batch") baseMultiplier *= CostMultiplier.Batch;
  if (isUSOnly) baseMultiplier *= CostMultiplier.US_Only;

  const inputMultiplier = isLongContext ? CostMultiplier.Long_Context_Input : 1;
  const outputMultiplier = isLongContext ? CostMultiplier.Long_Context_Output : 1; 

  const input = usage.inputTokens / MTok * baseMultiplier * inputMultiplier;
  const cacheRead = usage.cacheRead / MTok * CostMultiplier.Cache_Read * baseMultiplier * inputMultiplier;
  const cacheCreation_5m = usage.cacheCreation_5m / MTok * CostMultiplier.Cache_Creation_5m * baseMultiplier * inputMultiplier;
  const cacheCreation_1h = usage.cacheCreation_1h / MTok * CostMultiplier.Cache_Creation_1h * baseMultiplier * inputMultiplier;

  const output = usage.outputTokens / MTok * baseMultiplier * outputMultiplier;

  return {
    input,
    cacheRead,
    cacheCreation_5m,
    cacheCreation_1h,
    output,
  };
}
