import type { Cost, NormalizedUsage } from "#src/claude/cost.ts";
import type { NormalizedMessageParams } from "#src/claude/message.ts";

import { createBaseBlobs, type MetricParams } from "./_common.ts";

/**
 * Blobs:
 * - blob1~blob7: commons fields from {@link createBaseBlobs}
 * - blob8: Cloudflare Ray ID
 * - blob9: Upstream URL
 *
 * Doubles:
 * - double1: timestamp in milliseconds
 * - double2: HTTP status code
 * - double3: latency (TTFB) in milliseconds
 */
export function api_request(params: MetricParams<"api_request", {
  url: string,
  rayId: string | null,
  statusCode: number,
  latencyMs: number,
}>): AnalyticsEngineDataPoint {
  const blobs = createBaseBlobs("api_request", params);

  const {
    timestampMs,
    values: {
      url,
      rayId,
      statusCode,
      latencyMs,
    },
  } = params;

  blobs[7] = rayId;
  blobs[8] = url;

  return {
    blobs,
    doubles: [timestampMs, statusCode, latencyMs],
  };
}

/**
 * Blobs:
 * - blob1~blob7: commons fields from {@link createBaseBlobs}
 * - blob8: Anthropic message ID
 * - blob9: model name
 * - blob10: [Data residency option](https://platform.claude.com/docs/en/about-claude/pricing#data-residency-pricing) (default: `not_available`)
 * - blob11: Service tier (`standard`, `priority`, or `batch`)
 * - blob12: [Fast mode option](https://platform.claude.com/docs/en/about-claude/pricing#fast-mode-pricing) (`fast` or null)
 *
 * Doubles:
 * - double1: timestamp in milliseconds
 * - double2: Input tokens
 * - double3: Cache read input tokens
 * - double4: Cache creation (5m) input tokens
 * - double5: Cache creation (1h) input tokens
 * - double6: Output tokens
 */
export function token_usage(params: MetricParams<"token_usage", {
  usage: NormalizedUsage,
}>): AnalyticsEngineDataPoint {
  const blobs = createBaseBlobs("token_usage", params);

  const {
    timestampMs,
    values: { usage },
  } = params;

  blobs[7] = usage.messageId;
  blobs[8] = usage.model;
  blobs[9] = usage.inferenceGeo;
  blobs[10] = usage.serviceTier;
  blobs[11] = usage.speed;

  return {
    blobs,
    doubles: [
      timestampMs,
      usage.inputTokens,
      usage.cacheRead,
      usage.cacheCreation_5m,
      usage.cacheCreation_1h,
      usage.outputTokens
    ],
  };
}

/**
 * - blob1~blob7: commons fields from {@link createBaseBlobs}
 * - blob8: Anthropic message ID
 * - blob9: model name
 * - blob10: [Data residency option](https://platform.claude.com/docs/en/about-claude/pricing#data-residency-pricing) (default: `not_available`)
 * - blob11: Service tier (`standard`, `priority`, or `batch`)
 * - blob12: [Fast mode option](https://platform.claude.com/docs/en/about-claude/pricing#fast-mode-pricing) (`fast` or null)
 *
 * Doubles:
 * - double1: timestamp in milliseconds
 * - double2: Estimated cost for input tokens in USD
 * - double3: Estimated cost for cache read input tokens in USD
 * - double4: Estimated cost for cache creation (5m) input tokens in USD
 * - double5: Estimated cost for cache creation (1h) input tokens in USD
 * - double6: Estimated cost for output tokens in USD
 */
export function cost_usage(params: MetricParams<"cost_usage", {
  cost: Cost,
  usage: NormalizedUsage,
}>): AnalyticsEngineDataPoint {
  const blobs = createBaseBlobs("cost_usage", params);

  const {
    timestampMs,
    values: { cost, usage },
  } = params;

  blobs[7] = usage.messageId;
  blobs[8] = usage.model;
  blobs[9] = usage.inferenceGeo;
  blobs[10] = usage.serviceTier;
  blobs[11] = usage.speed;

  return {
    blobs,
    doubles: [
      timestampMs,
      cost.input,
      cost.cacheRead,
      cost.cacheCreation_5m,
      cost.cacheCreation_1h,
      cost.output,
    ],
  };
}

/**
 * A special event type for detecting when the output token usage is missing from the response.
 * For example, it may not be available when the network connection is lost during streaming.
 *
 * As the frequency of this event increases, the accuracy of cost inference may decrease.
 *
 * Blobs:
 * - blob1~blob7: commons fields from {@link createBaseBlobs}
 * - blob8: Anthropic message ID
 * - blob9: model name
 * - blob10: thinking effort parameter
 *
 * Doubles:
 * - double1: timestamp in milliseconds
 * - double2: effective input token count
 * - double3: max_tokens parameter
 */
export function incomplete_output_usage(params: MetricParams<"incomplete_output_usage", {
  usage: NormalizedUsage,
  messageParams: NormalizedMessageParams,
}>): AnalyticsEngineDataPoint {
  const blobs = createBaseBlobs("incomplete_output_usage", params);

  const {
    timestampMs,
    values: {
      usage,
      messageParams,
    },
  } = params;

  blobs[7] = usage.messageId;
  blobs[8] = usage.model;
  blobs[9] = messageParams.effort;

  return {
    blobs,
    doubles: [
      timestampMs,
      usage.effectiveInputTokens,
      messageParams.maxTokens,
    ],
  };
}
