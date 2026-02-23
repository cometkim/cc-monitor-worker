# Claude Code Monitoring w/ Cloudflare Workers

Monitor your Claude Code usage with Cloudflare Workers and [Workers Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/).

- **Public, Secure** endpoint
- Powerful analytics via **SQL**
- Truly **Serverless**, zero-maintenance

One-click deployment with

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cometkim/cc-monitor-worker)

## Two-modes of Monitoring

There are two option to monitoring your Claude Code usage:

1. Using [OpenTelemetry](https://code.claude.com/docs/en/monitoring-usage)
2. Using [LLM Gateway](https://code.claude.com/docs/en/llm-gateway)

Each has its own needs and pros and cons. You should choose an option based on your needs.

### Monitoring via OpenTelemetry

This is officially supported, and recommended way to monitor Claude Code usage.

Claude exports precise activities and use cases into a defined metrics schema. It includes all the context for analyzing costs, productivity, and usage patterns.

However, Claude Code's OTEL integration is not durable. A lot of data will not being collected. It's better suited for tracking trends rather than accurate usage data.

See [README_OTEL](README_OTEL.md) for more details.

### Monitoring via API Proxy

Claude Code also allow to use a custom LLM gateway.

Implementing an LLM gateway allows you to intercept all requests to Claude Code and calculate exact API costs. It can be used to monitor other coding agents such as OpenCode as well.

However, API requests don't include the context of the Claude Code application, making it difficult to analyze accurate usage patterns.

See [README_PROXY](README_PROXY.md) for more details.

## Data Retention

Cloudflare Analytics Engine only stores data for the past three months.

To analyze older data, you must archive it separately.

## Security

The endpoint uses Bearer token authentication:
- **Development**: Set `AUTH_SECRET` in `.dev.vars`
- **Production**: Use `wrangler secret put AUTH_SECRET`

Use strong, randomly generated secrets and rotate secrets regularly.

## License

[MIT](LICENSE)
