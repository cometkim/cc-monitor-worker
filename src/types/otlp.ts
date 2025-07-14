// OTLP (OpenTelemetry Protocol) Types for Metrics
// Based on opentelemetry-proto definitions

import type { Enum } from "./util.ts";

export interface ExportMetricsServiceRequest {
  resourceMetrics: ResourceMetrics[];
}

export interface ExportMetricsServiceResponse {
  partialSuccess?: PartialSuccess;
}

export interface PartialSuccess {
  rejectedDataPoints: number;
  errorMessage?: string;
}

export interface ResourceMetrics {
  resource?: Resource;
  scopeMetrics: ScopeMetrics[];
  schemaUrl?: string;
}

export interface Resource {
  attributes: KeyValue[];
  droppedAttributesCount: number;
}

export interface ScopeMetrics {
  scope?: InstrumentationScope;
  metrics: Metric[];
  schemaUrl?: string;
}

export interface InstrumentationScope {
  name: string;
  version?: string;
  attributes: KeyValue[];
  droppedAttributesCount: number;
}

export interface Metric {
  name: string;
  description?: string;
  unit?: string;
  gauge?: Gauge;
  sum?: Sum;
  histogram?: Histogram;
  exponentialHistogram?: ExponentialHistogram;
  summary?: Summary;
}

export interface Gauge {
  dataPoints: NumberDataPoint[];
}

export interface Sum {
  dataPoints: NumberDataPoint[];
  aggregationTemporality: AggregationTemporality;
  isMonotonic: boolean;
}

export interface Histogram {
  dataPoints: HistogramDataPoint[];
  aggregationTemporality: AggregationTemporality;
}

export interface ExponentialHistogram {
  dataPoints: ExponentialHistogramDataPoint[];
  aggregationTemporality: AggregationTemporality;
}

export interface Summary {
  dataPoints: SummaryDataPoint[];
}

export interface NumberDataPoint {
  attributes: KeyValue[];
  startTimeUnixNano?: string;
  timeUnixNano: string;
  asDouble?: number;
  asInt?: string;
  exemplars: Exemplar[];
  flags: number;
}

export interface HistogramDataPoint {
  attributes: KeyValue[];
  startTimeUnixNano?: string;
  timeUnixNano: string;
  count: string;
  sum?: number;
  bucketCounts: string[];
  explicitBounds: number[];
  exemplars: Exemplar[];
  flags: number;
  min?: number;
  max?: number;
}

export interface ExponentialHistogramDataPoint {
  attributes: KeyValue[];
  startTimeUnixNano?: string;
  timeUnixNano: string;
  count: string;
  sum?: number;
  scale: number;
  zeroCount: string;
  positive?: Buckets;
  negative?: Buckets;
  flags: number;
  exemplars: Exemplar[];
  min?: number;
  max?: number;
}

export interface SummaryDataPoint {
  attributes: KeyValue[];
  startTimeUnixNano?: string;
  timeUnixNano: string;
  count: string;
  sum: number;
  quantileValues: QuantileValue[];
  flags: number;
}

export interface Buckets {
  offset: number;
  bucketCounts: string[];
}

export interface QuantileValue {
  quantile: number;
  value: number;
}

export interface Exemplar {
  filteredAttributes: KeyValue[];
  timeUnixNano: string;
  asDouble?: number;
  asInt?: string;
  spanId?: string;
  traceId?: string;
}

export interface KeyValue {
  key: string;
  value: AnyValue;
}

export interface AnyValue {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string;
  doubleValue?: number;
  arrayValue?: ArrayValue;
  kvlistValue?: KeyValueList;
  bytesValue?: string;
}

export interface ArrayValue {
  values: AnyValue[];
}

export interface KeyValueList {
  values: KeyValue[];
}

export type AggregationTemporality = Enum<typeof AggregationTemporality>;
export const AggregationTemporality = {
  AGGREGATION_TEMPORALITY_UNSPECIFIED: 0,
  AGGREGATION_TEMPORALITY_DELTA: 1,
  AGGREGATION_TEMPORALITY_CUMULATIVE: 2,
} as const;

// Status for error responses
export interface Status {
  code: number;
  message: string;
  details?: any[];
}
