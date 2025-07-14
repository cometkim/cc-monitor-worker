# AGENT.md - Cloudflare Workers OTLP Metrics Endpoint

## Commands
- **Dev**: `bun run dev` (or `wrangler dev`)
- **Deploy**: `bun run deploy` (or `wrangler deploy --minify`)
- **Type generation**: `bun run cf-typegen` (or `wrangler types --env-interface CloudflareBindings`)
- **Build**: TypeScript compilation handled by Wrangler
- **Test endpoint**: `curl -X POST http://localhost:8787/v1/metrics -H "Content-Type: application/json" -H "Authorization: Bearer your-secret-here" -d @test/sample-metrics.jsonl` (auth optional if AUTH_SECRET not set)
- **Set auth secret**: `wrangler secret put AUTH_SECRET` (for production deployment)

## Architecture
- **Type**: Cloudflare Workers project with Hono framework implementing OTLP HTTP/JSON metrics endpoint
- **Entry point**: `src/index.ts` (configured in `wrangler.jsonc`)
- **Main framework**: Hono for HTTP handling
- **Protocol**: OpenTelemetry Protocol (OTLP) for metrics ingestion
- **Endpoint**: `POST /v1/metrics` - accepts OTLP JSON format
- **Security**: Optional Bearer token authentication - uses bearerAuth middleware when AUTH_SECRET is set, otherwise logs warning and continues
- **Storage**: Converts OTLP metrics to Cloudflare Analytics Engine format
- **Types**: OTLP types defined in `src/types/otlp.ts`
- **Converter**: `src/analytics-metrics.ts` - refactored config-driven approach
- **Test data**: `test/sample-metrics.jsonl` - actual Claude Code usage metrics
- **Observability**: Enabled in Cloudflare Workers runtime

## Analytics Engine Data Structure

### Blob Schema
- **blob1**: `metric_type` (session_count, cost_usage, token_usage, etc.)
- **blob2**: `service.name` (e.g., "claude-code")
- **blob3**: `service.version` (e.g., "1.0.48")
- **blob4**: `organization.id` (UUID)
- **blob5**: `user.id` (hashed user ID)
- **blob6**: `user.account_uuid` (UUID)
- **blob7**: `user.email` (email address)
- **blob8**: `session.id` (UUID)
- **blob9**: `terminal.type` (e.g., "alacritty")
- **blob10**: `model` (for metrics that have it, e.g., "claude-3-5-haiku-20241022")
- **blob11+**: Metric-specific attributes (type, decision, language, tool, etc.)

### Index Strategy
- **index1**: `user.account_uuid` - User UUID for sampling (Analytics Engine allows only one index)

### Doubles
- **double1**: `metric_value` - The actual metric value
- **double2**: `timestamp_ms` - Timestamp in milliseconds (converted from OTLP nanoseconds)

## Supported Claude Code Metrics
- `claude_code.session.count` - CLI session starts
- `claude_code.cost.usage` - Usage costs in USD
- `claude_code.token.usage` - Token consumption (input/output/cache)
- `claude_code.active_time.total` - Active time tracking (user/cli)
- `claude_code.lines_of_code.count` - Code changes (added/removed)
- `claude_code.pull_request.count` - PR creation events
- `claude_code.commit.count` - Commit events
- `claude_code.code_edit_tool.decision` - Tool acceptance/rejection

## Converter Implementation Details
- **Config-driven**: `METRIC_CONFIGS` object defines all metric handling
- **Blob positions**: Numbers instead of strings (e.g., `{ 10: "model", 11: "type" }`)
- **Timestamp handling**: Converts OTLP nanoseconds to milliseconds, validates presence
- **Error handling**: Individual metric point errors don't crash entire conversion
- **Validation**: All required attributes are asserted, missing ones throw errors

## Code Style
- **Module system**: ES modules (`"type": "module"`)
- **TypeScript**: Strict mode enabled, ESNext target
- **Imports**: ES6 imports, no file extensions needed
- **Types**: Cloudflare Workers types auto-generated via `worker-configuration.d.ts`
- **Error handling**: Returns proper OTLP Status objects with gRPC error codes
- **Naming**: Kebab-case for project name, camelCase for variables
- **Runtime**: Cloudflare Workers (not Node.js)
- **Converter**: Config-driven approach with `METRIC_CONFIGS` for maintainability
