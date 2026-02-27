import type { Context, ExecutionContext } from "hono";
import type { AnthropicRequest, AnthropicResponse, AnthropicStreamingEvent, AnthropicUsage } from "./types/anthropic.ts";

const ANTHROPIC_API_BASE = new URL("https://api.anthropic.com");

/**
 * @see https://platform.claude.com/docs/en/api/service-tiers
 */
const CostMultiplier = {
  Cache_Read: 0.1,
  Cache_Write_5m: 1.25,
  Cache_Write_1h: 2,
  Long_Context_Input: 2,
  Long_Context_Output: 1.5,
  US_Only: 1.1,
} as const;

const MODEL_PRICES: [prefix: string, price: { input: number, output: number }][] = [
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

function getModelPrice(model: string) {
  for (const [prefix, prices] of MODEL_PRICES) {
    if (model.startsWith(prefix)) {
      return prices;
    }
  }
  return null;
}

interface SSEEvent {
  event: string;
  data: string;
  id?: string;
}

class LineSplitTransform extends TransformStream<string, string> {
  #buffer = "";

  constructor() {
    super({
      transform: (chunk, controller) => {
        if (!chunk) return;
        
        this.#buffer += chunk;
        
        let i = 0;
        while (i < this.#buffer.length) {
          const char = this.#buffer[i];
          
          if (char === "\r" || char === "\n") {
            // Emit the line before this line ending
            const line = this.#buffer.slice(0, i);
            controller.enqueue(line);
            
            // Skip the line ending char
            i++;
            
            // Handle CRLF - skip the LF if we just processed a CR
            if (char === "\r" && i < this.#buffer.length && this.#buffer[i] === "\n") {
              i++;
            }
            
            // Remove processed content from buffer
            this.#buffer = this.#buffer.slice(i);
            i = 0;
          } else {
            i++;
          }
        }
      },
      flush: (controller) => {
        if (this.#buffer.length > 0) {
          controller.enqueue(this.#buffer);
        }
      },
    });
  }
}

class SSEParserTransform extends TransformStream<string, SSEEvent> {
  #event = "";
  #dataList: string[] = [];
  #lastEventId = "";

  #dispatchEvent(controller: TransformStreamDefaultController<SSEEvent>) {
    if (this.#dataList.length > 0) {
      controller.enqueue({
        event: this.#event || "message",
        data: this.#dataList.join("\n"),
        id: this.#lastEventId || undefined,
      });
    }
    this.#event = "";
    this.#dataList = [];
  }

  constructor() {
    super({
      transform: (line, controller) => {
        // Skip empty lines - they dispatch events
        if (line === "") {
          this.#dispatchEvent(controller);
          return;
        }

        // Skip comments
        if (line.startsWith(":")) {
          return;
        }

        // Parse field
        const colonPos = line.indexOf(":");
        let field: string;
        let value: string;

        if (colonPos === -1) {
          field = line;
          value = "";
        } else {
          field = line.slice(0, colonPos);
          value = line.slice(colonPos + 1);
          // Remove leading space from value if present
          if (value.startsWith(" ")) {
            value = value.slice(1);
          }
        }

        switch (field) {
          case "event":
            this.#event = value;
            break;
          case "data":
            this.#dataList.push(value);
            break;
          case "id":
            if (!value.includes("\0")) {
              this.#lastEventId = value;
            }
            break;
          case "retry":
            // Ignore retry field for our use case
            break;
        }
      },
      flush: (controller) => {
        this.#dispatchEvent(controller);
      },
    });
  }
}

interface RequestContext {
  userId?: string;
  userAccountId?: string;
  userEmail?: string;
  sessionId?: string;
  userAgent?: string;
};

class SSEMetricsTransform extends TransformStream<SSEEvent, void> {
  #events: AnthropicStreamingEvent[] = [];
  #startTime: number;
  #writeMetrics: (points: AnalyticsEngineDataPoint[]) => void;
  #context?: RequestContext;

  constructor(
    startTime: number,
    writeMetrics: (points: AnalyticsEngineDataPoint[]) => void,
    context?: RequestContext
  ) {
    super({
      transform: (sseEvent) => {
        try {
          const parsed = JSON.parse(sseEvent.data) as AnthropicStreamingEvent;
          this.#events.push(parsed);
        } catch (error) {
          console.error("Failed to parse SSE event", sseEvent, error);
        }
      },
      flush: () => {
        const latencyMs = Date.now() - this.#startTime;
        const metrics = extractMetricsFromStreamingResponse(this.#events, latencyMs, this.#context);
        if (metrics) {
          const points = metricsToDataPoints(metrics);
          this.#writeMetrics(points);
        }
      },
    });
    this.#startTime = startTime;
    this.#writeMetrics = writeMetrics;
    this.#context = context;
  }
}

interface ProxyMetrics {
  requestId: string;
  model: string;
  usage: AnthropicUsage;
  latencyMs: number;
  isStreaming: boolean;
  serviceName: string;
  serviceVersion: string;
  userId?: string;
  userAccountId?: string;
  userEmail?: string;
  sessionId?: string;
}

function parseUserAgent(userAgent: string): { serviceName: string; serviceVersion: string } {
  const match = userAgent.match(/^([^/]+)\/([^\s(]+)/);
  
  if (match) {
    return { serviceName: match[1], serviceVersion: match[2] };
  }
  
  return { serviceName: userAgent.split("/")[0] || "unknown", serviceVersion: "" };
}

function parseClaudeCodeUserId(userIdField: string): { userId: string; accountId: string; sessionId: string } | null {
  const parts = userIdField.split("_");
  if (parts.length < 6) return null;

  const userIdIdx = parts.indexOf("user");
  const accountIdx = parts.indexOf("account");
  const sessionIdx = parts.indexOf("session");

  if (userIdIdx === -1 || accountIdx === -1 || sessionIdx === -1) return null;

  const userId = parts[userIdIdx + 1];
  const accountId = parts[accountIdx + 1];
  const sessionId = parts[sessionIdx + 1];

  if (!userId || !accountId || !sessionId) return null;

  return { userId, accountId, sessionId };
}

export function createDataPoint(
  metricType: string,
  value: number,
  timestampMs: number,
  metadata: {
    requestId: string;
    model: string;
    tokenType?: string;
    serviceName: string;
    serviceVersion: string;
    userId?: string;
    userEmail?: string;
    userAccountId?: string;
    sessionId?: string;
  },
): AnalyticsEngineDataPoint {
  return {
    blobs: [
      metricType,
      metadata.serviceName,
      metadata.serviceVersion,
      null,
      metadata.userId || null,
      metadata.userAccountId || null,
      metadata.userEmail || null,
      metadata.sessionId || null,
      metadata.requestId,
      metadata.model,
      metadata.tokenType || null,
    ],
    doubles: [timestampMs, value],
  };
}

export function extractMetricsFromResponse(
  response: AnthropicResponse,
  latencyMs: number,
  context?: RequestContext
): ProxyMetrics {
  const { serviceName, serviceVersion } = parseUserAgent(context?.userAgent || "");
  
  return {
    requestId: response.id,
    model: response.model,
    usage: response.usage,
    latencyMs,
    isStreaming: false,
    serviceName,
    serviceVersion,
    userId: context?.userId,
    userAccountId: context?.userAccountId,
    userEmail: context?.userEmail,
    sessionId: context?.sessionId,
  };
}

export function extractMetricsFromStreamingResponse(
  events: AnthropicStreamingEvent[],
  latencyMs: number,
  context?: RequestContext
): ProxyMetrics | null {
  let requestId = "";
  let model = "";
  let usage: AnthropicUsage | null = null;

  for (const event of events) {
    if (event.type === "message_start" && event.message) {
      requestId = event.message.id;
      model = event.message.model;

      // input usage is fixed at here
      // caching ttl info is only available in message_start
      usage = event.message.usage;
    }
    if (event.type === "message_delta" && event.usage) {
      if (!usage) usage = event.usage;

      // output usage need to update to the latest snapshot
      usage.output_tokens = event.usage.output_tokens;
    }
    if (event.type === "message_stop" && usage) {
      const { serviceName, serviceVersion } = parseUserAgent(context?.userAgent || "");
      
      return {
        requestId,
        model,
        usage,
        latencyMs,
        isStreaming: true,
        serviceName,
        serviceVersion,
        userId: context?.userId,
        userAccountId: context?.userAccountId,
        userEmail: context?.userEmail,
        sessionId: context?.sessionId,
      };
    }
  }

  return null;
}

export function metricsToDataPoints(metrics: ProxyMetrics): AnalyticsEngineDataPoint[] {
  const points: AnalyticsEngineDataPoint[] = [];
  const timestampMs = Date.now();
  const { requestId, model, usage, serviceName, serviceVersion, userId, userAccountId, userEmail, sessionId } = metrics;

  const price = getModelPrice(model);
  if (!price) {
    console.warn("No price information found for model: %s", model);
  }

  const effectiveInputContext = usage.input_tokens 
    + (usage.cache_read_input_tokens || 0)
    + (usage.cache_creation_input_tokens || 0);

  const isLongContext = effectiveInputContext > 200_000;

  points.push(
    createDataPoint(
      "api_request",
      1,
      timestampMs,
      { requestId, model, serviceName, serviceVersion, userId, userAccountId, userEmail, sessionId },
    ),
  );

  points.push(
    createDataPoint(
      "api_latency_ms",
      metrics.latencyMs,
      timestampMs,
      { requestId, model, serviceName, serviceVersion, userId, userAccountId, userEmail, sessionId },
    ),
  );

  if (usage.input_tokens) {
    points.push(
      createDataPoint(
        "token_usage",
        usage.input_tokens,
        timestampMs,
        { requestId, model, serviceName, serviceVersion, userId, userAccountId, userEmail, sessionId, tokenType: "input" },
      ),
    );
    if (price) {
      let cost = (usage.input_tokens / 1_000_000) * price.input;
      if (isLongContext) {
        cost *= CostMultiplier.Long_Context_Input;
      }
      if (usage.inference_geo === "us") {
        cost *= CostMultiplier.US_Only;
      }
      points.push(
        createDataPoint(
          "cost_usage",
          cost,
          timestampMs,
          { requestId, model, serviceName, serviceVersion, userId, userAccountId, userEmail, sessionId, tokenType: "input" },
        ),
      );
    }
  }

  if (usage.output_tokens) {
    points.push(
      createDataPoint(
        "token_usage",
        usage.output_tokens,
        timestampMs,
        { requestId, model, serviceName, serviceVersion, userId, userAccountId, userEmail, sessionId, tokenType: "output" },
      ),
    );
    if (price) {
      let cost = usage.output_tokens / 1_000_000 * price.output;
      if (isLongContext) {
        cost *= CostMultiplier.Long_Context_Output;
      }
      if (usage.inference_geo === "us") {
        cost *= CostMultiplier.US_Only;
      }
      points.push(
        createDataPoint(
          "cost_usage",
          cost,
          timestampMs,
          { requestId, model, serviceName, serviceVersion, userId, userAccountId, userEmail, sessionId, tokenType: "output" },
        ),
      );
    }
  }

  if (usage.cache_read_input_tokens) {
    points.push(
      createDataPoint(
        "token_usage",
        usage.cache_read_input_tokens,
        timestampMs,
        { requestId, model, serviceName, serviceVersion, userId, userAccountId, userEmail, sessionId, tokenType: "cache_read" },
      )
    );
    if (price) {
      let cost = (usage.cache_read_input_tokens / 1_000_000) * price.input * CostMultiplier.Cache_Read;
      if (isLongContext) {
        cost *= CostMultiplier.Long_Context_Input;
      }
      if (usage.inference_geo === "us") {
        cost *= CostMultiplier.US_Only;
      }
      points.push(
        createDataPoint(
          "cost_usage",
          cost,
          timestampMs,
          { requestId, model, serviceName, serviceVersion, userId, userAccountId, userEmail, sessionId, tokenType: "cache_read" },
        )
      );
    }
  }

  if (usage.cache_creation) {
    if (usage.cache_creation.ephemeral_5m_input_tokens) {
      points.push(
        createDataPoint(
          "token_usage",
          usage.cache_creation.ephemeral_5m_input_tokens,
          timestampMs,
          { requestId, model, serviceName, serviceVersion, userId, userAccountId, userEmail, sessionId, tokenType: "cache_creation_5m" },
        )
      );
      if (price) {
        let cost = (usage.cache_creation.ephemeral_5m_input_tokens / 1_000_000) * price.input * CostMultiplier.Cache_Write_5m;
        if (isLongContext) {
          cost *= CostMultiplier.Long_Context_Input;
        }
        if (usage.inference_geo === "us") {
          cost *= CostMultiplier.US_Only;
        }
        points.push(
          createDataPoint(
            "cost_usage",
            cost,
            timestampMs,
            { requestId, model, serviceName, serviceVersion, userId, userAccountId, userEmail, sessionId, tokenType: "cache_creation_5m" },
          )
        );
      }
    }
    if (usage.cache_creation.ephemeral_1h_input_tokens) {
      points.push(
        createDataPoint(
          "token_usage",
          usage.cache_creation.ephemeral_1h_input_tokens,
          timestampMs,
          { requestId, model, serviceName, serviceVersion, userId, userAccountId, userEmail, sessionId, tokenType: "cache_creation_1h" },
        )
      );
      if (price) {
        let cost = (usage.cache_creation.ephemeral_1h_input_tokens / 1_000_000) * price.input * CostMultiplier.Cache_Write_1h;
        if (isLongContext) {
          cost *= CostMultiplier.Long_Context_Input;
        }
        if (usage.inference_geo === "us") {
          cost *= CostMultiplier.US_Only;
        }
        points.push(
          createDataPoint(
            "cost_usage",
            cost,
            timestampMs,
            { requestId, model, serviceName, serviceVersion, userId, userAccountId, userEmail, sessionId, tokenType: "cache_creation_1h" },
          )
        );
      }
    }
  } else if (usage.cache_creation_input_tokens) {
    points.push(
      createDataPoint(
        "token_usage",
        usage.cache_creation_input_tokens,
        timestampMs,
        { requestId, model, serviceName, serviceVersion, userId, userAccountId, userEmail, sessionId, tokenType: "cache_creation_5m" },
      )
    );
    if (price) {
      let cost = (usage.cache_creation_input_tokens / 1_000_000) * price.input * CostMultiplier.Cache_Write_5m;
      if (isLongContext) {
        cost *= CostMultiplier.Long_Context_Input;
      }
      if (usage.inference_geo === "us") {
        cost *= CostMultiplier.US_Only;
      }
      points.push(
        createDataPoint(
          "cost_usage",
          cost,
          timestampMs,
          { requestId, model, serviceName, serviceVersion, userId, userAccountId, userEmail, sessionId, tokenType: "cache_creation_5m" },
        )
      );
    }
  }

  return points;
}

async function extractRequestContext(req: Request): Promise<RequestContext> {
  const userAgent = req.headers.get("user-agent") || undefined;
  const userEmail = req.headers.get("x-proxy-user-email") || undefined;

  const context: RequestContext = { userAgent, userEmail };

  try {
    if (req.body) {
      const cloned = req.clone(); // tee-ing body stream
      const parsed = await cloned.json<AnthropicRequest>();
      const userIdField = parsed.metadata?.user_id;
      if (userIdField) {
        const parsedIds = parseClaudeCodeUserId(userIdField);
        if (parsedIds) {
          context.userId = parsedIds.userId;
          context.userAccountId = parsedIds.accountId;
          context.sessionId = parsedIds.sessionId;
        }
      }
    }
  } catch (error) {
    console.error("Failed to parse request body for extracting extra metadata", error);
  }

  return context;
}

async function handleStreamingResponse(
  response: Response,
  startTime: number,
  writeMetrics: (points: AnalyticsEngineDataPoint[]) => void,
  contextPromise: Promise<RequestContext>,
  ctx: ExecutionContext
): Promise<Response> {
  if (!response.body) {
    return response;
  }

  const [passthrough, metricsStream] = response.body.tee();

  const metricsPipeline = (async () => {
    try {
      const context = await contextPromise;
      
      await metricsStream
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new LineSplitTransform())
        .pipeThrough(new SSEParserTransform())
        .pipeThrough(new SSEMetricsTransform(startTime, writeMetrics, context))
        .getReader()
        .read();
    } catch (error) {
      console.error("Metrics pipeline error:", error);
    }
  })();

  ctx.waitUntil(metricsPipeline);

  return new Response(passthrough, {
    status: response.status,
    headers: response.headers,
  });
}

async function handleNonStreamingResponse(
  response: Response,
  startTime: number,
  writeMetrics: (points: AnalyticsEngineDataPoint[]) => void,
  contextPromise: Promise<RequestContext>
): Promise<Response> {
  const body = await response.text();
  const latencyMs = Date.now() - startTime;

  try {
    const context = await contextPromise;
    const data: AnthropicResponse = JSON.parse(body);
    const metrics = extractMetricsFromResponse(data, latencyMs, context);
    const points = metricsToDataPoints(metrics);
    writeMetrics(points);
  } catch (error) {
    console.error("Failed to parse response for metrics", error);
  }

  return new Response(body, {
    status: response.status,
    headers: response.headers,
  });
}

export async function proxyRequest(
  ctx: Context,
  writeMetrics: (points: AnalyticsEngineDataPoint[]) => void,
): Promise<Response> {
  const req = ctx.req.raw;
  const url = new URL(req.url);
  const targetUrl = new URL(`${url.pathname.replace(/^\/proxy/, "")}${url.search}`, ANTHROPIC_API_BASE);

  const startTime = Date.now();

  const proxyHeaders = new Headers(req.headers);
  proxyHeaders.set("host", ANTHROPIC_API_BASE.host);

  const contextPromise = extractRequestContext(req);
  const proxyRequest = new Request(targetUrl, {
    method: req.method,
    body: req.body,
    headers: proxyHeaders,
    redirect: "follow",
  });

  const response = await fetch(proxyRequest);

  if (targetUrl.pathname === "/v1/messages") {
    const isStreaming = response.headers.get("content-type")?.includes("text/event-stream");
    return isStreaming
      ? handleStreamingResponse(response, startTime, writeMetrics, contextPromise, ctx.executionCtx)
      : handleNonStreamingResponse(response, startTime, writeMetrics, contextPromise);
  }

  return response;
}
