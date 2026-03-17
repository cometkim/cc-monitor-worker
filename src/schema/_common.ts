import type { CCRequestContext } from "#src/claude/context.ts";

export interface MetricParams<_Name extends string, Values> {
  timestampMs: number;
  values: Values;
  context: CCRequestContext;
}

type MetricName<Params> = Params extends MetricParams<infer Name, unknown> ? Name : never;

/**
 * Pre-filled common blob fields
 *
 * blob1: metric_name
 * blob2: service_name
 * blob3: service_version?
 * blob4: organization_id?
 * blob5: hashed_user_id?
 * blob6: user_account_id?
 * blob7: user_email?
 */
export function createBaseBlobs<const Params extends MetricParams<string, unknown>>(
  metricName: MetricName<Params>,
  params: Params,
): Array<ArrayBuffer | string | null> {
  const blobs = Array.from({ length: 20 }).fill(null) as Array<ArrayBuffer | string | null>;
  blobs[0] = metricName;
  blobs[1] = params.context.userAgent.name;
  blobs[2] = params.context.userAgent.version || null;
  blobs[3] = params.context.organizationId ?? null;
  if (params.context.target === "/v1/messages") {
    blobs[4] = params.context.userMetadata?.userId ?? null;
    blobs[5] = params.context.userMetadata?.userAccountId ?? null;
  }
  blobs[6] = params.context.userEmail ?? null;

  return blobs;
}
