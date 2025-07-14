import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { bearerAuth } from "hono/bearer-auth";
import type {
  ExportMetricsServiceRequest,
  ExportMetricsServiceResponse,
  Status,
} from "./types/otlp.ts";
import { convertOTLPToAnalytics } from "./analytics-metrics.ts";

const app = new Hono<{ Bindings: CloudflareBindings }>();

const auth = createMiddleware(async (c, next) => {
  const token = c.env.AUTH_SECRET;
  if (token) {
    const auth = bearerAuth({ token });
    return auth(c, next);
  }
  console.warn("Authorization header checking is skipped. Consider to set AUTH_SECRET for your worker security.");
  await next();
});

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
    const analyticsDataPoints = convertOTLPToAnalytics(metricsRequest);
    
    // Write metrics to Analytics Engine
    let writtenDataPoints = 0;
    let rejectedDataPoints = 0;
    
    for (const dataPoint of analyticsDataPoints) {
      try {
        c.env.ANALYTICS_ENGINE.writeDataPoint(dataPoint);
        writtenDataPoints++;
      } catch (error) {
        console.error("Failed to write data point:", error, dataPoint);
        rejectedDataPoints++;
      }
    }

    console.log(`Processed ${analyticsDataPoints.length} data points: ${writtenDataPoints} written, ${rejectedDataPoints} rejected`);

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
    console.error("Error processing metrics:", error);
    
    const errorResponse: Status = {
      code: 13, // INTERNAL
      message: "Internal server error",
    };
    return c.json(errorResponse, 500);
  }
});

export default app;
