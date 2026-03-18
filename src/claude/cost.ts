import type {
  Message,
  RawMessageDeltaEvent,
} from "@anthropic-ai/sdk/resources";

export type NormalizedUsage = (
  | NormalizedUsage_Start
  | NormalizedUsage_EndTurn
);

type NormalizedUsagePayload = {
  startAt: Date,

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

  // For throughput analytics
  // It requires a timer that actually progresses in time.
  endAt: Date,
  tps: number;
}

export function normalizeUsage({ id, model, usage }: Message, startAt: Date): NormalizedUsage_Start {
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
    startAt,
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
  endAt: Date,
): NormalizedUsage_EndTurn {
  const outputTokens = event.usage.output_tokens;
  const elapsed = endAt.getTime() - usage.startAt.getTime();
  const tps = outputTokens / elapsed * 1000;
  return {
    ...usage,
    state: "end_turn",
    outputTokens,
    endAt,
    tps,
  };
}

export function forceEndTurnUsage(
  message: Message,
  startAt: Date,
  endAt: Date,
): NormalizedUsage_EndTurn {
  const dummyEvent: RawMessageDeltaEvent = {
    type: "message_delta",
    delta: { container: null, stop_reason: null, stop_sequence: null },
    usage: message.usage,
  };
  const usageInit = normalizeUsage(message, startAt);
  const usage = normalizeEndTurnUsage(usageInit, dummyEvent, endAt);
  return usage;
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

export function getModelUnitPrice(model: string): [id: string, price: ModelUnitPrice] | null {
  for (const [prefix, prices] of MODEL_PRICES) {
    if (model.startsWith(prefix)) {
      return [prefix, prices] as const;
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
export function calculateCost(usage: NormalizedUsage): Cost | null {
  const MTok = 1_000_000;

  const pricing = getModelUnitPrice(usage.model);
  if (!pricing) {
    console.warn({
      message: `Unknown model ${usage.model}`,
      model: usage.model,
      messageId: usage.messageId,
    });
    return null;
  }

  const [model, unitPrice] = pricing;
  const inputPrice = unitPrice.input / MTok;
  const outputPrice = unitPrice.output / MTok;

  const isFastMode = usage.speed === "fast";
  const isLongContext = usage.effectiveInputTokens > 200_000;
  const isUSOnly = usage.inferenceGeo === "us_only";

  let baseMultiplier = 1;
  if (isFastMode) baseMultiplier *= CostMultiplier.Fast_Mode;
  if (usage.serviceTier === "batch") baseMultiplier *= CostMultiplier.Batch;
  if (isUSOnly) baseMultiplier *= CostMultiplier.US_Only;

  let inputMultiplier = 1;
  let outputMultiplier = 1;

  // Premium pricing for long context input
  // See https://platform.claude.com/docs/en/about-claude/pricing#long-context-pricing
  if (isLongContext && !isFastMode) {
    if (model === "claude-sonnet-4-5" || model === "claude-sonnet-4-0" || model === "claude-sonnet-4") {
      inputMultiplier = CostMultiplier.Long_Context_Input;
      outputMultiplier = CostMultiplier.Long_Context_Output;
    }
    // Otherwise it's free
    // See https://claude.com/blog/1m-context-ga
  }

  const input = usage.inputTokens * inputPrice * baseMultiplier * inputMultiplier;
  const cacheRead = usage.cacheRead * inputPrice * baseMultiplier * inputMultiplier * CostMultiplier.Cache_Read;
  const cacheCreation_5m = usage.cacheCreation_5m * inputPrice * baseMultiplier * inputMultiplier * CostMultiplier.Cache_Creation_5m;
  const cacheCreation_1h = usage.cacheCreation_1h * inputPrice * baseMultiplier * inputMultiplier * CostMultiplier.Cache_Creation_1h;

  const output = usage.outputTokens * outputPrice * baseMultiplier * outputMultiplier;

  return {
    input,
    cacheRead,
    cacheCreation_5m,
    cacheCreation_1h,
    output,
  };
}
