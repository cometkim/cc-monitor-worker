# Claude Code Monitoring w/ Cloudflare Workers

Monitor your Claude Code usage with Cloudflare Workers and [Workers Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/).

- **Public, Secure** endpoint for OpenTelemetry/OTLP
- Powerful analytics via **ClickHouse SQL**
- Truly **Serverless**, zero-maintenance

One-click deployment with

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cometkim/cc-monitor-worker)

## Setup Monitoring

Monitoring via OpenTelemetry is the Claude Code built-in feature.

Once you deploy the worker to the `https://cc-monitor.your-org.workers.dev`, you can enable monitoring with env settings like:

```jsonc
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",

    // Currently support metrics only
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "https://cc-monitor.your-org.workers.dev",
    "OTEL_METRIC_EXPORT_INTERVAL": 10000,

    // See security section below
    "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer token"
  }
}
```

You can leverage your company's MDM solution to deploy this as [org-managed settings](https://docs.anthropic.com/en/docs/claude-code/monitoring-usage#administrator-configuration).

See more details from the [Claude Code official guide](https://docs.anthropic.com/en/docs/claude-code/monitoring-usage).

## How to Query

You can query the collected data in the Cloudflare Console (Analytics Engine Studio), [Cloudflare API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/) or [Grafana Dashboard](https://developers.cloudflare.com/analytics/analytics-engine/grafana/).

### Analytics Engine Schema

**Blobs (Fixed Schema):**
- `blob1`: `metric_type` (`session_count`, `cost_usage`, etc.)
- `blob2`: `service.name` (e.g. `claude-code`)
- `blob3`: `service.version` (e.g. `1.0.48`)
- `blob4`: `organization.id` (UUID)
- `blob5`: `user.id` (hashed user ID)
- `blob6`: `user.account_uuid` (UUID)
- `blob7`: `user.email` (email address)
- `blob8`: `session.id` (UUID)
- `blob9`: `terminal.type` (e.g. `iTerm`)
- `blob10+`: Metric-specific attributes

**Doubles:**
- `double1`: `metric_value` - The actual metric value
- `double2`: `timestamp_ms` - Timestamp in milliseconds

### Supported Metrics

The endpoint processes the following Claude Code metrics:

| Metric Name | Description | Additional Attributes |
|-------------|-------------|------------|
| `claude_code.session.count` | CLI session starts |  |
| `claude_code.cost.usage` | Usage costs in USD | `model` |
| `claude_code.token.usage` | Token consumption | `model` |
| `claude_code.active_time.total` | Active time tracking |  |
| `claude_code.lines_of_code.count` | Code changes | |
| `claude_code.pull_request.count` | PR creation events |  |
| `claude_code.commit.count` | Commit events |  |
| `claude_code.code_edit_tool.decision` | Tool decisions | `decision`, `language`, `tool` |


### Example Analytics Engine Query

```sql
SELECT 
  blob1 as metric_type,
  blob7 as user_email,
  SUM(double1) as total_value
FROM claude_code_metrics
WHERE metric_type = 'cost_usage'
GROUP BY metric_type, user_email
ORDER BY total_value DESC
```

## Architecture

```
Claude Code → OTLP/HTTP → Cloudflare Worker → Analytics Engine
```

The worker acts as a bridge between Claude Code's OTLP metrics and Cloudflare's Analytics Engine:

1. **Receives** OTLP metrics via HTTP/JSON POST requests
2. **Authenticates** requests using Bearer token validation
3. **Transforms** OTLP data to Analytics Engine format
4. **Stores** metrics in Analytics Engine for querying

## Security

The endpoint uses Bearer token authentication:
- **Development**: Set `AUTH_SECRET` in `.dev.vars`
- **Production**: Use `wrangler secret put AUTH_SECRET`

Use strong, randomly generated secrets and rotate secrets regularly.

## License

[MIT](LICENSE)
