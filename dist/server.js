import 'dotenv/config';
import express from "express";
import cors from "cors";
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
    app.use(express.urlencoded({ extended: true, limit: "1mb" }));
    app.use(createRateLimiter());
    const eventBus = new EventBus();
    const github = options?.githubClient ?? new GitHubClient({ config });
    const handler = new McpHandler(config, github, eventBus);
    app.use((req, res, next) => validateOrigin(config, req, res, next));
    // OpenID Discovery endpoint (no auth required)
    // Enable CORS for web-based MCP clients
    app.get("/.well-known/openid-configuration", cors(), (req, res) => {
        const base = config.publicBaseUrl || `http://localhost:${config.port}`;
        res.json({
            issuer: config.oidcIssuer,
            token_endpoint: `${base}/oauth/token`,
            authorization_endpoint: `${base}/oauth/authorize`,
            grant_types_supported: ["authorization_code", "client_credentials"],
            token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
            response_types_supported: ["code", "token"],
            code_challenge_methods_supported: ["S256"]
        });
    });
    // OAuth metadata endpoint (no auth required - MCP standard)
    // Enable CORS for web-based MCP clients
    app.get("/oauth/metadata", cors(), (req, res) => {
        const base = config.publicBaseUrl || `http://localhost:${config.port}`;
        res.json({
            issuer: config.oidcIssuer,
            token_endpoint: `${base}/oauth/token`,
            authorization_endpoint: `${base}/oauth/authorize`,
            jwks_uri: config.oidcJwksUrl,
            grant_types_supported: ["authorization_code", "client_credentials"],
            token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
            response_types_supported: ["code", "token"],
            code_challenge_methods_supported: ["S256"],
            scopes_supported: ["mcp.codex.launch", "mcp.pr.review", "mcp.pr.merge", "mcp.pr.gate", "mcp.validation.trigger", "mcp.tools.list", "mcp.tools.call"]
        });
    });
    // MCP metadata endpoint (no auth required - for OAuth discovery)
    // Enable CORS for web-based MCP clients
    app.get("/mcp", cors(), (req, res, next) => {
        const accept = req.header("accept");
        // If it's an SSE request, let it pass through to the SSE handler
        if (accept && accept.includes("text/event-stream")) {
            return next();
        }
        // Otherwise, return OAuth metadata in standard format
        const base = config.publicBaseUrl || `http://localhost:${config.port}`;
        res.json({
            issuer: config.oidcIssuer,
            token_endpoint: `${base}/oauth/token`,
            authorization_endpoint: `${base}/oauth/authorize`,
            grant_types_supported: ["authorization_code", "client_credentials"],
            token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
            response_types_supported: ["code", "token"],
            code_challenge_methods_supported: ["S256"]
        });
    });
    // OAuth authorization endpoint proxy (no auth required)
    // Redirects to Auth0 for Authorization Code flow
    app.get("/oauth/authorize", cors(), (req, res) => {
        const { client_id, redirect_uri, state, response_type, code_challenge, code_challenge_method, scope, resource } = req.query;
        // Security: only allow known client
        if (!client_id || client_id !== config.oauthAllowedClientId) {
            return res.status(401).json({ error: "unauthorized_client" });
        }
        if (!config.auth0Domain) {
            return res.status(500).json({ error: "OAuth proxy not configured" });
        }
        // Build Auth0 authorization URL
        const auth0AuthUrl = new URL(`https://${config.auth0Domain}/authorize`);
        auth0AuthUrl.searchParams.set("client_id", client_id);
        auth0AuthUrl.searchParams.set("response_type", response_type || "code");
        auth0AuthUrl.searchParams.set("redirect_uri", redirect_uri);
        if (state)
            auth0AuthUrl.searchParams.set("state", state);
        if (code_challenge)
            auth0AuthUrl.searchParams.set("code_challenge", code_challenge);
        if (code_challenge_method)
            auth0AuthUrl.searchParams.set("code_challenge_method", code_challenge_method);
        if (scope)
            auth0AuthUrl.searchParams.set("scope", scope);
        if (config.auth0Audience)
            auth0AuthUrl.searchParams.set("audience", config.auth0Audience);
        // Redirect to Auth0
        res.redirect(auth0AuthUrl.toString());
    });
    // OAuth token proxy endpoint (no auth required - this IS the auth endpoint)
    // Enable CORS for web-based MCP clients
    app.post("/oauth/token", cors(), async (req, res) => {
        try {
            // Accept JSON or x-www-form-urlencoded
            const { client_id, client_secret, grant_type = "client_credentials", code, code_verifier, redirect_uri, audience = config.auth0Audience } = req.body;
            // Security: only allow known client
            if (!client_id || client_id !== config.oauthAllowedClientId) {
                return res.status(401).json({ error: "unauthorized_client" });
            }
            if (!["client_credentials", "authorization_code"].includes(grant_type)) {
                return res.status(400).json({ error: "unsupported_grant_type" });
            }
            if (!config.auth0TokenUrl) {
                return res.status(500).json({ error: "OAuth proxy not configured" });
            }
            // Relay to Auth0
            const params = new URLSearchParams();
            params.set("grant_type", grant_type);
            params.set("client_id", client_id);
            if (grant_type === "authorization_code") {
                if (!code) {
                    return res.status(400).json({ error: "invalid_request", error_description: "Missing authorization code" });
                }
                params.set("code", code);
                if (code_verifier)
                    params.set("code_verifier", code_verifier);
                if (redirect_uri)
                    params.set("redirect_uri", redirect_uri);
                // For confidential clients (Regular Web App), Auth0 requires client_secret even with PKCE
                if (client_secret)
                    params.set("client_secret", client_secret);
            }
            else {
                // client_credentials
                if (!client_secret) {
                    return res.status(400).json({ error: "invalid_request", error_description: "Missing client_secret" });
                }
                params.set("client_secret", client_secret);
            }
            if (audience) {
                params.set("audience", audience);
            }
            const response = await fetch(config.auth0TokenUrl, {
                method: "POST",
                headers: { "content-type": "application/x-www-form-urlencoded" },
                body: params
            });
            // Return Auth0 response as-is
            const text = await response.text();
            res.status(response.status).type("application/json").send(text);
        }
        catch (error) {
            logger.error({ err: error }, "OAuth token proxy error");
            res.status(500).json({ error: "server_error" });
        }
    });
    // Apply authentication to all routes below
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
        let session = handler.getSession(sessionId ?? undefined);
        // Attach scopes to session if OAuth is enabled
        if (session && req.scopes && config.requireOAuth) {
            session.scopes = req.scopes;
        }
        try {
            const { response, session: newSession } = await handler.handleRequest(session, request);
            const effectiveSession = newSession ?? session;
            // Attach scopes to new session
            if (effectiveSession && req.scopes && config.requireOAuth) {
                effectiveSession.scopes = req.scopes;
            }
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
