# Monitoring Claude Usage via API Proxy

## Claude Code Setup

Once you deploy the worker to the `https://cc-monitor.your-org.workers.dev`, you can enable monitoring with env settings like:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://cc-monitor.your-org.workers.dev/proxy",
    "ANTHROPIC_CUSTOM_HEADERS": "x-proxy-authorization: Bearer token\nx-proxy-user-email: user@example.com"
  }
}
```

You can leverage your company's MDM solution to deploy this as [org-managed settings](https://docs.anthropic.com/en/docs/claude-code/monitoring-usage#administrator-configuration).

### Custom Headers

- `X-Proxy-Authorization`: Bearer token for securing the endpoint
- `X-Proxy-User-Email` (optional): User email for tracking, your orgs' MDM may provide.

## How to Query

You can query the collected data in the Cloudflare Console (Analytics Engine Studio), [Cloudflare API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/) or [Grafana Dashboard](https://developers.cloudflare.com/analytics/analytics-engine/grafana/).

### Analytics Engine Schema

**Table Name**: `claude_proxy_metrics_v20260316`

**Blobs (Fixed Schema):**
- `blob1`: `metric_type` (`session_count`, `cost_usage`, etc.)
- `blob2`: `service.name` (e.g. `claude-code`)
- `blob3`: `service.version` (e.g. `1.0.48`)
- `blob4`: Empty
- `blob5`: `user.id` (hashed user ID)
- `blob6`: `user.account_uuid` (UUID)
- `blob7`: `user.email` (email address)
- `blob8+`: Metric-specific attributes

**Doubles:**
- `double1`: `timestamp_ms` - Timestamp in milliseconds
- `double2+`: Metric-specific attributes

### Supported Metrics

The endpoint processes the following metrics:

| Metric Name | Description | Additional Attributes |
|-------------|-------------|------------|
| `api_request` | Processed API request | url, latency, status |
| `token_usage` | Token consumption | model, input, output, cache usage |
| `cost_usage` | Usage costs in USD | calculated cost for usage |
| `incomplete_output_usage` | When a output usage is not fully collected | message params, metadata |


See below sections for more details.

#### Metric: `api_request`

Additional attributes:

- `blob8`: [Cloudflare Ray ID]
- `blob9`: Request URL
- `double2`: HTTP status code
- `double3`: Latency in milliseconds

```sql
SELECT
  blob1 as metric_type,
  blob8 as url,
  double2 as status,
  double3 as latency_ms
FROM {{TABLE_NAME}}
WHERE metric_type = 'api_request';
```

#### Metric: `token_usage`

Additional attributes:

- `blob8`: [Anthropic Message ID]
- `blob9`: Model name
- `blob10`: [Data residency option](https://platform.claude.com/docs/en/about-claude/pricing#data-residency-pricing) (default: `not_available`)
- `blob11`: Service tier (`standard`, `priority`, or `batch`)
- `blob12`: [Fast mode option](https://platform.claude.com/docs/en/about-claude/pricing#fast-mode-pricing) (`fast` or null)
- `double2`: Input tokens
- `double3`: Cache read input tokens
- `double4`: Cache creation (5m) input tokens
- `double5`: Cache creation (1h) input tokens
- `double6`: Output tokens
* `double7`: Tokens per second (zero value if not available)

```sql
SELECT
  blob1 as metric_type,
  blob8 as message_id,
  blob9 as model,
  blob10 as inference_geo,
  blob11 as service_tier,
  blob12 as speed,
  double2 as input_tokens,
  double3 as cache_read_input_tokens,
  double4 as cache_creation_5m_input_tokens,
  double5 as cache_creation_1h_input_tokens,
  double6 as output_tokens
FROM {{TABLE_NAME}}
WHERE metric_type = 'token_usage';
```


#### Metric: `cost_usage`

Additional attributes:

- `blob8`: [Anthropic Message ID]
- `blob9`: Model name
- `blob10`: [Data residency option](https://platform.claude.com/docs/en/about-claude/pricing#data-residency-pricing) (default: `not_available`)
- `blob11`: Service tier (`standard`, `priority`, or `batch`)
- `blob12`: [Fast mode option](https://platform.claude.com/docs/en/about-claude/pricing#fast-mode-pricing) (`fast` or null)
- `double2`: Estimated cost for input tokens in USD
- `double3`: Estimated cost for cache read input tokens in USD
- `double4`: Estimated cost for cache creation (5m) input tokens in USD
- `double5`: Estimated cost for cache creation (1h) input tokens in USD
- `double6`: Estimated cost for output tokens in USD

#### Metric: `incomplete_output_usage`

If a message stream terminates unexpectedly, output token usage may not be collected properly.

This metrics can be used to correct cost estimation.

Additional attributes:

- `blob8`: [Anthropic Message ID]
- `blob9`: Model name
- `blob10`: Thinking effort parameter
- `double2`: Effective input tokens (input + cache usage)
- `double3`: `max_tokens` parameter

## How it works

The proxy parses the full request body because this is necessary for request control, so some additional latency is unavoidable.

In contrast, the response path is designed to minimize overhead, using non-blocking, zero-copy processing wherever possible.

```
Client
  │
  ▼
Proxy receives request
  │
  ├─ Parse request context
  ├─ Forward request upstream
  └─ Record request latency/status
  │
  ▼
Upstream response
  │
  ├─ /*
  │    └─ Bypass response as-is
  │
  └─ /v1/messages
       │
       ├─ stream=false
       │    └─ Pass response through to client 
       │    └─ waitUntil (Read final usage → calculate cost → write metrics)
       │
       └─ stream=true (SSE)
            └─ Pass response through to client 
               ├─ Observe message_start / message_delta
               └─ On end/cancel stream → calculate cost → write metrics
```

[Cloudflare Ray ID]: https://developers.cloudflare.com/fundamentals/reference/cloudflare-ray-id/
[Anthropic Message ID]: https://platform.claude.com/docs/en/api/messages
