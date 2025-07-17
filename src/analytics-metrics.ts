import type { ExportMetricsServiceRequest, KeyValue } from "./types/otlp.ts";

function extractAttributeValue(keyValue: KeyValue): string {
  const value = keyValue.value;
  if (value.stringValue) return value.stringValue;
  if (value.intValue) return value.intValue;
  if (value.doubleValue !== undefined) return value.doubleValue.toString();
  if (value.boolValue !== undefined) return value.boolValue.toString();
  return "";
}

function extractAttributes(attributes: KeyValue[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const attr of attributes) {
    result[attr.key] = extractAttributeValue(attr);
  }
  return result;
}

function assertAttribute(attrs: Record<string, string>, key: string): string {
  const value = attrs[key];
  if (!value) {
    throw new Error(`Missing required attribute: ${key}`);
  }
  return value;
}

interface MetricConfig {
  metricType: string;
  requiredAttributes: string[];
  specificBlobs: Record<string, string>; // blob position -> attribute key
  indexes?: string[]; // attribute keys for indexes
}

const METRIC_CONFIGS: Record<string, MetricConfig> = {
  "claude_code.session.count": {
    metricType: "session_count",
    requiredAttributes: ["organization.id", "session.id", "terminal.type", "user.account_uuid", "user.email", "user.id"],
    specificBlobs: {},
  },
  "claude_code.cost.usage": {
    metricType: "cost_usage",
    requiredAttributes: ["model", "organization.id", "session.id", "terminal.type", "user.account_uuid", "user.email", "user.id"],
    specificBlobs: { 10: "model" },
  },
  "claude_code.token.usage": {
    metricType: "token_usage",
    requiredAttributes: ["model", "organization.id", "session.id", "terminal.type", "type", "user.account_uuid", "user.email", "user.id"],
    specificBlobs: { 10: "model", 11: "type" },
  },
  "claude_code.active_time.total": {
    metricType: "active_time_total",
    requiredAttributes: ["type", "organization.id", "session.id", "terminal.type", "user.account_uuid", "user.email", "user.id"],
    specificBlobs: { 11: "type" },
  },
  "claude_code.lines_of_code.count": {
    metricType: "lines_of_code",
    requiredAttributes: ["type", "organization.id", "session.id", "terminal.type", "user.account_uuid", "user.email", "user.id"],
    specificBlobs: { 11: "type" },
  },
  "claude_code.pull_request.count": {
    metricType: "pull_request_count",
    requiredAttributes: ["organization.id", "session.id", "terminal.type", "user.account_uuid", "user.email", "user.id"],
    specificBlobs: {},
  },
  "claude_code.commit.count": {
    metricType: "commit_count",
    requiredAttributes: ["organization.id", "session.id", "terminal.type", "user.account_uuid", "user.email", "user.id"],
    specificBlobs: {},
  },
  "claude_code.code_edit_tool.decision": {
    metricType: "code_edit_tool_decision",
    requiredAttributes: ["decision", "language", "organization.id", "session.id", "terminal.type", "tool_name", "user.account_uuid", "user.email", "user.id"],
    specificBlobs: { 11: "decision", 12: "language", 13: "tool_name" },
  },
};

function createBaseBlobs(
  serviceName: string,
  serviceVersion: string,
  metricType: string,
  attrs: Record<string, string>
): string[] {
  return [
    metricType,                                  // blob1: metric_type
    serviceName,                                 // blob2: service_name
    serviceVersion,                              // blob3: service_version
    assertAttribute(attrs, "organization.id"),   // blob4: organization_id
    assertAttribute(attrs, "user.id"),           // blob5: user_id
    assertAttribute(attrs, "user.account_uuid"), // blob6: user_account_uuid
    assertAttribute(attrs, "user.email"),        // blob7: user_email
    assertAttribute(attrs, "session.id"),        // blob8: session_id
    assertAttribute(attrs, "terminal.type"),     // blob9: terminal_type
    // blob10-20: specific or reserved
  ];
}

function processMetricPoint(
  point: any, 
  attrs: Record<string, string>, 
  config: MetricConfig, 
  serviceName: string,
  serviceVersion: string
): AnalyticsEngineDataPoint {
  const blobs = createBaseBlobs(serviceName, serviceVersion, config.metricType, attrs);
  // Validate required attributes
  for (const attr of config.requiredAttributes) {
    assertAttribute(attrs, attr);
  }
  // Fill specific blob positions
  for (const [blobIndex, attrKey] of Object.entries(config.specificBlobs)) {
    blobs[parseInt(blobIndex) - 1] = assertAttribute(attrs, attrKey);
  }

  const value = point.asDouble || parseFloat(point.asInt || "0");
  
  // Convert OTLP nanosecond timestamp to milliseconds
  const timestampNs = assertAttribute(point, "timeUnixNano");
  const timestampMs = Math.floor(parseInt(timestampNs) / 1_000_000);
  
  return {
    blobs,
    doubles: [timestampMs, value],
  };
}

export function convertOTLPToAnalytics(request: ExportMetricsServiceRequest): AnalyticsEngineDataPoint[] {
  const dataPoints: AnalyticsEngineDataPoint[] = [];

  for (const resourceMetric of request.resourceMetrics) {
    const resourceAttrs = extractAttributes(resourceMetric.resource?.attributes || []);
    
    // Extract and assert required resource attributes
    const serviceName = assertAttribute(resourceAttrs, "service.name");
    const serviceVersion = assertAttribute(resourceAttrs, "service.version");

    for (const scopeMetric of resourceMetric.scopeMetrics) {
      for (const metric of scopeMetric.metrics) {
        const metricName = metric.name;
        
        const config = METRIC_CONFIGS[metricName];
        if (!config) {
          console.warn(`Unknown Claude Code metric: ${metricName}`);
          continue;
        }

        if (metric.sum) {
          for (const point of metric.sum.dataPoints) {
            const attrs = extractAttributes(point.attributes);
            
            try {
              const dataPoint = processMetricPoint(point, attrs, config, serviceName, serviceVersion);
              dataPoints.push(dataPoint);
            } catch (error) {
              console.error(`Error processing metric ${metricName}:`, error);
            }
          }
        }
      }
    }
  }

  return dataPoints;
}
