# Claude Code Monitoring w/ Cloudflare Workers

Monitor your Claude Code usage with Cloudflare Workers and [Workers Analytics Engine].

- Public, secure endpoint for OpenTelemetry/OTLP
- Powerful analytics via SQL
- Truly serverless, zero maintenence
- One-click deployment

## Setup Monitoring

Monitoring via OpenTelemetry is the Claude Code built-in feature.

Once you deploy the worker to the `https://cc-monitor.your-org.workers.dev`, you can enable monitoring with env settings like:

```jsonc
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",

    # Currently support metrics only
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "https://cc-monitor.your-org.workers.dev",

    # See security section below
    "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer token"
  }
}
```

You can leverage your company's MDM solution to deploy this as [org-managed settings](https://docs.anthropic.com/en/docs/claude-code/monitoring-usage#administrator-configuration).

See more detail from the [Claude Code official guide](https://docs.anthropic.com/en/docs/claude-code/monitoring-usage).

## How to Query

You can query the collected data in the Cloudflare Console (Analytics Engine Studio), [Cloudflare API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/) or [Grafana Dashboard](https://developers.cloudflare.com/analytics/analytics-engine/grafana/).
## Supported Metrics

The endpoint processes the following Claude Code metrics:


| Metric Name | Description | Attributes |
|-------------|-------------|------------|
| `claude_code.session.count` | CLI session starts | `user.id`, `organization.id`, `session.id`, `terminal.type` |
| `claude_code.cost.usage` | Usage costs in USD | `model`, `user.id`, `organization.id`, `session.id` |
| `claude_code.token.usage` | Token consumption | `model`, `type`, `user.id`, `organization.id`, `session.id` |
| `claude_code.active_time.total` | Active time tracking | `type`, `user.id`, `organization.id`, `session.id` |
| `claude_code.lines_of_code.count` | Code changes | `type`, `user.id`, `organization.id`, `session.id` |
| `claude_code.pull_request.count` | PR creation events | `user.id`, `organization.id`, `session.id` |
| `claude_code.commit.count` | Commit events | `user.id`, `organization.id`, `session.id` |
| `claude_code.code_edit_tool.decision` | Tool decisions | `decision`, `language`, `tool`, `user.id`, `organization.id` |


## Data Structure

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
- `blob10`: `model` (e.g. `claude-sonnet-4-20250514`)
- `blob10+`: Metric-specific attributes

**Doubles:**
- `double1`: `metric_value` - The actual metric value
- `double2`: `timestamp_ms` - Timestamp in milliseconds

**Index**:
- `index1`: `metric_type`

(Only one index is allowed)

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

### Authentication

The endpoint uses Bearer token authentication:
- **Development**: Set `AUTH_SECRET` in `.dev.vars`
- **Production**: Use `wrangler secret put AUTH_SECRET`

### Token Validation

Uses Hono's `bearerAuth` middleware with secure token comparison:
- Constant-time comparison prevents timing attacks
- Proper Bearer token format validation
- Automatic error responses for invalid tokens

### Best Practices

- Use strong, randomly generated secrets
- Rotate secrets regularly
- Monitor authentication failures

## Monitoring

### Observability

The worker includes built-in observability:
- Automatic request/response logging
- Error tracking and reporting
- Performance metrics via Cloudflare dashboard

### Key Metrics to Monitor

- Request volume and latency
- Authentication failure rate
- Data point processing errors
- Analytics Engine write failures

### Alerts

Set up alerts for:
- High error rates (>5%)
- Authentication failures
- Slow response times (>500ms)
- Analytics Engine write failures

## Troubleshooting

### Common Issues

**401 Unauthorized:**
- Check Bearer token format: `Authorization: Bearer <token>`
- Verify `AUTH_SECRET` is set correctly
- Ensure token matches secret exactly

**400 Bad Request:**
- Verify `Content-Type: application/json` header
- Check OTLP JSON format
- Validate required metric attributes

**500 Internal Server Error:**
- Check worker logs in Cloudflare dashboard
- Verify Analytics Engine binding configuration
- Check for missing required attributes

### Debug Mode

Enable debug logging in development:

```typescript
// Add to src/index.ts
console.log("Processing metrics:", metricsRequest);
```

### Testing

Test with curl:

```bash
# Test authentication
curl -X POST http://localhost:8787/v1/metrics \
  -H "Authorization: Bearer wrong-token" \
  -d "{}"
# Should return 401

# Test valid request
curl -X POST http://localhost:8787/v1/metrics \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret" \
  -d @test/sample-metrics.jsonl
# Should return 200
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Update documentation
6. Submit a pull request

## License

[MIT](LICENSE)
