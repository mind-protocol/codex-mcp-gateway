import express from "express";
import pino from "pino";
import { nanoid } from "nanoid";
import { loadConfig } from "./config.js";
import { EventBus } from "./events.js";
import { GitHubClient } from "./github/client.js";
import { McpHandler } from "./mcp/handlers.js";
import { authenticate, createRateLimiter, validateOrigin } from "./security.js";
function sendSse(res, event, data, id) {
    if (id) {
        res.write(`id: ${id}\n`);
    }
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}
function registerSse(app, eventBus) {
    const sseClients = new Map();
    function broadcastEvent(data) {
        for (const client of sseClients.values()) {
            sendSse(client.res, "event", data);
        }
    }
    eventBus.subscribe((event) => {
        broadcastEvent({ type: "event", event });
    });
    app.get("/mcp", (req, res) => {
        const accept = req.header("accept");
        if (accept && !accept.includes("text/event-stream")) {
            res.status(406).send("Only text/event-stream supported");
            return;
        }
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        const clientId = nanoid();
        const client = { id: clientId, res };
        sseClients.set(clientId, client);
        sendSse(res, "ready", { ok: true }, clientId);
        req.on("close", () => {
            sseClients.delete(clientId);
        });
    });
    app.get("/sse", (req, res) => {
        res.redirect(307, "/mcp");
    });
    return sseClients;
}
export function createServer(options) {
    const config = options?.config ?? loadConfig();
    const logger = pino({ level: config.logLevel });
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use(createRateLimiter());
    const eventBus = new EventBus();
    const github = options?.githubClient ?? new GitHubClient({ config });
    const handler = new McpHandler(config, github, eventBus);
    app.use((req, res, next) => validateOrigin(config, req, res, next));
    app.use((req, res, next) => authenticate(config, req, res, next));
    registerSse(app, eventBus);
    app.post("/mcp", async (req, res) => {
        const protocolHeader = req.header("mcp-protocol-version");
        if (protocolHeader && protocolHeader !== config.protocolVersion) {
            res.status(426).json({
                jsonrpc: "2.0",
                error: { code: -32001, message: `Unsupported protocol version ${protocolHeader}` }
            });
            return;
        }
        const request = req.body;
        if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
            res.status(400).json({
                jsonrpc: "2.0",
                error: { code: -32600, message: "Invalid JSON-RPC request" }
            });
            return;
        }
        const sessionId = req.header("mcp-session-id");
        const session = handler.getSession(sessionId ?? undefined);
        try {
            const { response, session: newSession } = await handler.handleRequest(session, request);
            const effectiveSession = newSession ?? session;
            if (effectiveSession) {
                res.setHeader("Mcp-Session-Id", effectiveSession.id);
            }
            const accept = req.header("accept") ?? "application/json";
            if (accept.includes("text/event-stream")) {
                res.setHeader("Content-Type", "text/event-stream");
                res.setHeader("Cache-Control", "no-cache");
                res.setHeader("Connection", "keep-alive");
                sendSse(res, "response", response, response?.id?.toString());
                res.end();
                return;
            }
            res.json(response);
        }
        catch (error) {
            logger.error({ err: error }, "Error handling MCP request");
            res.status(500).json({
                jsonrpc: "2.0",
                id: request.id,
                error: { code: -32603, message: "Internal error" }
            });
        }
    });
    app.use((err, _req, res, _next) => {
        logger.error({ err }, "Unhandled error");
        res.status(500).json({ error: "Internal server error" });
    });
    return { app, config, handler, eventBus, logger };
}
if (import.meta.url === `file://${process.argv[1]}`) {
    const { app, config, logger } = createServer();
    const port = config.port;
    app.listen(port, () => {
        logger.info({ port }, "codex-mcp-gateway server listening");
    });
}
