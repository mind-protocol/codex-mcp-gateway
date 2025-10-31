# codex-mcp-gateway

Remote MCP server exposing GitHub-backed tools for launching Codex tasks, reviewing pull requests, gating merges, and triggering validations. Implements the MCP Streamable HTTP transport with SSE fallback.

## Features

- `initialize`, `tools/list`, and `tools/call` JSON-RPC endpoints on a single `/mcp` route
- Streamable HTTP responses with optional `text/event-stream` transport
- Event emission for Codex and PR activities (codex.task.* and pr.*)
- GitHub workflow dispatch, PR review, gate evaluation, merging, and validation triggering tools
- Bearer token authentication, origin validation, and rate limiting
- Zod-based runtime validation of tool arguments

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy environment variables and configure:

   ```bash
   cp .env.example .env
   # edit .env with AUTH_TOKEN, GITHUB_TOKEN, ALLOWED_ORIGINS, etc.
   ```

3. Build and run:

   ```bash
   npm run build
   npm start
   ```

   or start in development mode with live reload:

   ```bash
   npm run dev
   ```

## MCP endpoints

- `POST /mcp` — Streamable HTTP endpoint accepting JSON-RPC 2.0 payloads
- `GET /mcp` — Opens an SSE stream for server-pushed events
- `GET /sse` — Legacy alias redirecting to `/mcp`

Include the following headers on requests:

- `Authorization: Bearer <AUTH_TOKEN>` — matches `AUTH_TOKEN` from configuration
- `MCP-Protocol-Version: 2025-06-18`
- `Mcp-Session-Id` — required after the initial `initialize` handshake

### Initialize

```bash
curl -X POST http://localhost:8080/mcp \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"clientInfo":{"name":"curl","version":"0.0.1"}}}'
```

### List tools

```bash
curl -X POST http://localhost:8080/mcp \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -H "Mcp-Session-Id: <session-id-from-initialize>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

### Call a tool

```bash
curl -X POST http://localhost:8080/mcp \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -H "Mcp-Session-Id: <session-id>" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"launch_codex_task","arguments":{"owner":"your-org","repo":"your-repo","ref":"main","instruction":"Add tests"}}}'
```

## Docker

```bash
docker build -t codex-mcp-gateway .
docker run --env-file .env -p 8080:8080 codex-mcp-gateway
```

## Testing

```bash
npm test
```

## Connectors configuration

In ChatGPT Connectors, configure a new MCP server with:

- **URL**: `https://<host>/mcp`
- **Headers**: include the `Authorization` bearer token and `MCP-Protocol-Version`
- **SSE URL**: optional; the server automatically supports GET `/mcp`

## License

MIT
