import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { bearerAuth } from "hono/bearer-auth";
import type {
  ExportMetricsServiceRequest,
  ExportMetricsServiceResponse,
  Status,
} from "./types/otlp.ts";
import { convertOTLPToAnalytics } from "./analytics-metrics.ts";
import { proxyRequest } from "./proxy.ts";

type Env = { Bindings: Cloudflare.Env };

const app = new Hono<Env>();

export function createAuth(headerName?: string) {
  return createMiddleware<Env>(async (c, next) => {
    const token = c.env.AUTH_SECRET;
    if (token) {
      const auth = bearerAuth({ token, headerName });
      return auth(c, next);
    }
    console.warn("Authorization header checking is skipped. Consider to set AUTH_SECRET for your worker security.");
    await next();
  });
}

const auth = createAuth();
const proxyAuth = createAuth("X-Proxy-Authorization");

app.post("/v1/metrics", auth, async (c) => {
  try {
    // Validate content type
    const contentType = c.req.header("content-type");
    if (!contentType?.includes("application/json")) {
      const errorResponse: Status = {
        code: 3, // INVALID_ARGUMENT
        message: "Content-Type must be application/json",
      };
      return c.json(errorResponse, 400);
    }

    // Parse request body
    let metricsRequest: ExportMetricsServiceRequest;
    try {
      metricsRequest = await c.req.json();
    } catch (error) {
      const errorResponse: Status = {
        code: 3, // INVALID_ARGUMENT
        message: "Invalid JSON in request body",
      };
      return c.json(errorResponse, 400);
    }

    // Validate required fields
    if (!metricsRequest.resourceMetrics || !Array.isArray(metricsRequest.resourceMetrics)) {
      const errorResponse: Status = {
        code: 3, // INVALID_ARGUMENT
        message: "Missing or invalid resourceMetrics field",
      };
      return c.json(errorResponse, 400);
    }

    // Convert OTLP metrics to Analytics Engine format
    const points = convertOTLPToAnalytics(metricsRequest);
    
    // Write metrics to Analytics Engine
    let writtenDataPoints = 0;
    let rejectedDataPoints = 0;
    
    for (const dataPoint of points) {
      try {
        c.env.OTEL_METRICS.writeDataPoint(dataPoint);
        writtenDataPoints++;
      } catch (error) {
        console.error({
          message: "Failed to write data point", 
          cause: error instanceof Error ? error.message : (error as any).toString(), 
        });
        rejectedDataPoints++;
      }
    }
    console.debug({
      message: `Processed ${points.length} data points: ${writtenDataPoints} written, ${rejectedDataPoints} rejected`,
      writtenDataPoints,
      rejectedDataPoints,
    });

    // Return successful response
    const response: ExportMetricsServiceResponse = rejectedDataPoints > 0 ? {
      partialSuccess: {
        rejectedDataPoints,
        errorMessage: `${rejectedDataPoints} data points failed to write to Analytics Engine`
      }
    } : {};

    return c.json(response, 200, {
      "Content-Type": "application/json",
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : (error as any).toString();
    console.error({
      message: "Error processing metrics",
      cause: errorMessage,
    });
    const errorResponse: Status = {
      code: 13, // INTERNAL
      message: errorMessage,
    };
    return c.json(errorResponse, 500);
  }
});

app.all("/proxy/*", proxyAuth, async (c) => {
  try {
    const response = await proxyRequest(c);
    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : (error as any).toString();
    console.error({
      message: "Proxy error",
      cause: errorMessage,
    });
    const errorResponse: Status = {
      code: 13,
      message: errorMessage,
    };
    return c.json(errorResponse, 502);
  }
});

export default app;
