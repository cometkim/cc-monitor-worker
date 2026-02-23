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

**Table Name**: `claude_proxy_metrics_v20260223`

**Blobs (Fixed Schema):**
- `blob1`: `metric_type` (`session_count`, `cost_usage`, etc.)
- `blob2`: `service.name` (e.g. `claude-code`)
- `blob3`: `service.version` (e.g. `1.0.48`)
- `blob4`: Empty
- `blob5`: `user.id` (hashed user ID)
- `blob6`: `user.account_uuid` (UUID)
- `blob7`: `user.email` (email address)
- `blob8`: `session.id` (UUID)
- `blob9`: `request_id` (UUID)
- `blob10+`: Metric-specific attributes

**Doubles:**
- `double1`: `timestamp_ms` - Timestamp in milliseconds
- `double2`: `metric_value` - The actual metric value

### Supported Metrics

The endpoint processes the following Claude Code metrics:

| Metric Name | Description | Additional Attributes |
|-------------|-------------|------------|
| `api_request` | Processed API request |  |
| `api_latency_ms` | API latency |  |
| `token_usage` | Token consumption | `blob10` (model), `blob11` (token_type) |
| `cost_usage` | Usage costs in USD | `blob10` (model) |


### Example Analytics Engine Query

```sql
SELECT 
  blob1 as metric_type,
  blob7 as user_email,
  SUM(double2) as total_value
FROM {{TABLE_NAME}}
WHERE metric_type = 'cost_usage'
GROUP BY metric_type, user_email
ORDER BY total_value DESC
```

## Architecture

```
Client
  │  HTTP request (unchanged)
  ▼
/proxy ───────────────────────────────▶ Anthropic API
  │                                      │
  │                                      │  streaming or normal response
  │  HTTP response (unchanged)           ▼
  ◀──────────────────────────────────────┘
  │
  ├─ (side path, best-effort; never blocks)
  │    req.body.tee()  → parse user/account/session (optional)
  │    res.body.tee()  → parse SSE events (if streaming)
  │                    → write analytics (latency/tokens/cost)
  │
  └─ if analytics parsing fails: metrics are lost, proxy still succeeds
```

The `/proxy` path is a transparent proxy for the Anthropic API. Requests are passed through unmodified, and so are the responses.

The implementation parses the stream asynchronously, instead of blocking the API request response process. If an analysis error occurs, analytics data will be lost, but existing API requests will not be blocked.
