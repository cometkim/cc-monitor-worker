import type {
  Message,
  RawMessageStartEvent,
  RawMessageDeltaEvent,
} from "@anthropic-ai/sdk/resources";
import type { Context } from "hono";

import { 
  parseRequest,
  type CCRequestContextForMessage,
} from "./claude/context.ts";
import { normalizeMessageParams } from "./claude/message.ts";
import {
  calculateCost,
  normalizeUsage,
  normalizeEndTurnUsage,
  forceEndTurnUsage, 
  type NormalizedUsage,
} from "./claude/cost.ts";
import * as schema from "./schema/claude_proxy_metrics_v20260316.ts";

/**
 * Pass-through stream that collects metrics from the Anthropic's SSE stream.
 *
 * Implemented a low-overhead as possible to avoid blocking the response stream.
 * Zero-copy byte-level parsing in a single pass.
 */
class SSEMetricCollectorStream extends TransformStream<Uint8Array, Uint8Array> {
  #textDecoder = new TextDecoder();

  #buffer = new Uint8Array(512);
  #cursor = 0;

  #eventCount = 0;
  #eventType = "";
  #dataView = new Uint8Array(0);

  #collect: (usage: NormalizedUsage) => void;

  constructor(collect: (usage: NormalizedUsage) => void) {
    super({
      transform: (chunk, controller) => {
        try {
          if (this.#cursor + chunk.byteLength > this.#buffer.byteLength) {
            this.#growBuffer(this.#cursor + chunk.byteLength);
          }

          this.#buffer.set(chunk, this.#cursor);
          this.#cursor += chunk.byteLength;

          let start = 0;
          for (let i = 0; i < this.#cursor; i++) {
            if (this.#buffer[i] !== 10) continue;

            const line = this.#buffer.subarray(start, i);
            start = i + 1;

            if (
              line.length > 6 &&
              line[0] === 101 && // e
              line[1] === 118 && // v
              line[2] === 101 && // e
              line[3] === 110 && // n
              line[4] === 116 && // t
              line[5] ===  58    // :
            ) {
              this.#eventType = this.#textDecoder.decode(line.subarray(6)).trim();
              continue;
            }

            if (
              line.length > 5 &&
              line[0] === 100 && // d
              line[1] ===  97 && // a
              line[2] === 116 && // t
              line[3] ===  97 && // a
              line[4] ===  58    // :
            ) {
               this.#dataView = line.subarray(5);
               continue;
            }

            /* blank line = event end */
            if (line.length === 0) {
              this.#onEvent(this.#eventType, this.#dataView);

              this.#eventType = "";
              this.#cursor = 0;

              break;
            }
          }
        } catch (error) {
          console.error({
            message: "Error while processing message stream",
            cause: error instanceof Error ? error.message : (error as any)?.toString(),
          });
        }

        // Pass-through
        controller.enqueue(chunk);
      },

      flush: () => {
        this.#flush();
      },

      // errored/aborted streaming
      cancel: (reason) => {
        console.warn({
          message: "Stream cancelled",
          cause: reason instanceof Error ? reason.message : (reason as any)?.toString(),
        });
        this.#flush();
      },
    });

    this.#collect = collect;
  }

  #growBuffer(requiredSize: number) {
    let newSize = this.#buffer.byteLength * 2;
    while (requiredSize > newSize) {
      newSize *= 2;
    }
    console.debug({
      message: `Growing buffer from ${this.#buffer.byteLength} to ${newSize}`,
      size: this.#buffer.byteLength,
      requiredSize,
      newSize,
    });
    const newBuffer = new Uint8Array(newSize);
    newBuffer.set(this.#buffer);
    this.#buffer = newBuffer;
  }

  #onEvent(eventType: string, buffer: Uint8Array) {
    this.#eventCount += 1;
    // Parse only necessary event and skip for intermidiate events
    switch (eventType) {
      case "message_start": {
        const event = JSON.parse(this.#textDecoder.decode(buffer));
        this.#onMessageStartEvent(event)
        break;
      }
      case "message_delta": {
        const event = JSON.parse(this.#textDecoder.decode(buffer));
        this.#onMessageDeltaEvent(event);
        break;
      }
      default: {
        break;
      }
    }
  }

  #usage: NormalizedUsage | null = null;
  flushed = false;

  #onMessageStartEvent(event: RawMessageStartEvent) {
    this.#usage = normalizeUsage(event.message, new Date());
  }

  #onMessageDeltaEvent(event: RawMessageDeltaEvent) {
    // Seems the timer is pregressing on the response stream.
    // Not sure it's a feature or a security bug :shrug:
    if (this.#usage) {
      this.#usage = normalizeEndTurnUsage(this.#usage, event, new Date());
    }
  }

  #flush() {
    this.flushed = true;

    if (!this.#usage) {
      console.error({
        message: "No usage data to write",
        buffer: this.#textDecoder.decode(
          this.#buffer.subarray(0, Math.min(this.#cursor, 1024)),
        ),
        eventCount: this.#eventCount,
      });
      return;
    }

    // Write once to reduce total count of data points
    // Splitting data points could make querying simpler, but it amplifies Analytics Engine costs.
    //
    // See: https://developers.cloudflare.com/analytics/analytics-engine/pricing/
    this.#collect(this.#usage);
  }
}

async function handleStreamingResponse(
  response: Response,
  requestContext: CCRequestContextForMessage,
  ctx: Context<{ Bindings: Cloudflare.Env }>,
): Promise<Response> {
  if (!response.body) {
    return response;
  }

  const stream = new SSEMetricCollectorStream(usage => {
    ctx.env.PROXY_METRICS.writeDataPoint(schema.token_usage({
      timestampMs: Date.now(),
      context: requestContext,
      values: { usage },
    }));
    if (usage.state !== "end_turn") {
      console.warn("An incomplete output usage is detected");
      ctx.env.PROXY_METRICS.writeDataPoint(schema.incomplete_output_usage({
        timestampMs: Date.now(),
        context: requestContext,
        values: {
          usage,
          messageParams: normalizeMessageParams(requestContext.messageParams),
        },
      }));
    }
    const cost = calculateCost(usage);
    if (cost) {
      ctx.env.PROXY_METRICS.writeDataPoint(schema.cost_usage({
        timestampMs: Date.now(),
        context: requestContext,
        values: { usage, cost },
      }));
    }
  });
  response.body.pipeTo(stream.writable).catch(error => {
    console.error({
      message: "Error while processing a message (stream: true)",
      cause: error instanceof Error ? error.message : (error as any)?.toString(),
      flushed: stream.flushed,
    });
  });

  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");

  return new Response(stream.readable, {
    status: response.status,
    headers,
  });
}

async function handleNonStreamingResponse(
  response: Response,
  requestContext: CCRequestContextForMessage,
  ctx: Context<{ Bindings: Cloudflare.Env }>,
): Promise<Response> {
  if (!response.body) {
    return response;
  }

  async function writeMetrics(response: Response) {
    try {
      const message = await response.json<Message>();
      const usage = forceEndTurnUsage(message, requestContext.requestedAt, new Date());
      ctx.env.PROXY_METRICS.writeDataPoint(schema.token_usage({
        timestampMs: Date.now(),
        context: requestContext,
        values: { usage },
      }));

      const cost = calculateCost(usage);
      if (cost) {
        ctx.env.PROXY_METRICS.writeDataPoint(schema.cost_usage({
          timestampMs: Date.now(),
          context: requestContext,
          values: { usage, cost },
        }));
      }
    } catch (error) {
      console.log({
        message: "Error while processing a message (stream: false)",
        cause: error instanceof Error ? error.message : (error as any)?.toString(),
      });
    }
  }
  ctx.executionCtx.waitUntil(writeMetrics(response.clone()));
  return response;
}

export async function proxyRequest(
  ctx: Context<{ Bindings: Cloudflare.Env }>,
): Promise<Response> {
  const req = ctx.req.raw;

  // Parsing request is inevitable.
  // The request context is eventually necessary for metrics, controlling, etc.
  const requestContext = await parseRequest(req.clone());

  const proxyHeaders = new Headers(req.headers);
  proxyHeaders.set("host", requestContext.targetUrl.host);

  const proxyRequest = new Request(requestContext.targetUrl, {
    method: req.method,
    body: req.body,
    headers: proxyHeaders,
    redirect: "follow",

    // forward abort signal
    signal: req.signal,
  });

  let response: Response | null = null;
  try {
    response = await fetch(proxyRequest);
  } catch (error) {
    console.error({
      message: "Failed to fetch upstream",
      cause: error instanceof Error ? error.message : (error as any)?.toString(),
    });
  }

  // timers progress on I/O
  const latencyMs = Date.now() - requestContext.requestedAt.getTime();
  ctx.env.PROXY_METRICS.writeDataPoint(schema.api_request({
    timestampMs: Date.now(),
    context: requestContext,
    values: {
      latencyMs,
      url: requestContext.targetUrl.toString(),
      rayId: req.headers.get("cf-ray"),
      statusCode: response?.status || 0,
    },
  }));

  if (!response) {
    return new Response("Service Unavailable", { status: 503 });
  }

  if (response.ok && requestContext.target === "/v1/messages") {
    return requestContext.messageParams.stream === true
      ? handleStreamingResponse(response, requestContext, ctx)
      : handleNonStreamingResponse(response, requestContext, ctx);
  }

  return response;
}
