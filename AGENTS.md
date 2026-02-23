# AGENTS.md - Cloudflare Workers for monitoring Claude Code

## Commands
- **Dev**: `bun run dev` (or `wrangler dev`)
- **Deploy**: `bun run deploy` (or `wrangler deploy --minify`)
- **Type generation**: `bun run cf-typegen` (or `wrangler types`)
- **Build**: TypeScript compilation handled by Wrangler
- **Set auth secret**: `wrangler secret put AUTH_SECRET` (for production deployment)

## Architecture
- **Type**: Cloudflare Workers project with Hono framework implementing OTLP HTTP/JSON metrics endpoint and Anthropic API reverse proxy
- **Entry point**: `src/index.ts` (configured in `wrangler.jsonc`)
- **Main framework**: Hono for HTTP handling
- **Endpoints**:
  - `POST /v1/metrics` - accepts OTLP JSON format
  - `ALL /proxy/*` - transparent reverse proxy to api.anthropic.com
- **Security**: Optional Bearer token authentication - uses bearerAuth middleware when AUTH_SECRET is set, otherwise logs warning and continues
- **Storage**: Cloudflare Analytics Engine
- **Observability**: Enabled in Cloudflare Workers runtime

## Code Style
- **Module system**: ES modules (`"type": "module"`)
- **TypeScript**: Strict mode enabled, ESNext target
- **Imports**: ES6 imports, no file extensions needed
- **Types**: Cloudflare Workers types auto-generated via `worker-configuration.d.ts`
- **Error handling**: Returns proper OTLP Status objects with gRPC error codes
- **Naming**: Kebab-case for project name, camelCase for variables
- **Runtime**: Cloudflare Workers (not Node.js)
- **Converter**: Config-driven approach with `METRIC_CONFIGS` for maintainability
