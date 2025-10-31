import { nanoid } from "nanoid";
import { z } from "zod";
import { LaunchCodexTaskInput, launchCodexTask } from "../tools/codex.js";
import { PrReviewInput, submitPullRequestReview } from "../tools/pr-review.js";
import { PrGateInput, evaluatePullRequestGate } from "../tools/pr-gate.js";
import { PrMergeInput, mergePullRequest } from "../tools/pr-merge.js";
import { TriggerValidationInput, triggerValidationWorkflow } from "../tools/trigger-validation.js";
import { GitHubError } from "../github/client.js";
const InitializeParams = z.object({
    protocolVersion: z.string(),
    capabilities: z.unknown(),
    clientInfo: z.object({ name: z.string(), version: z.string().optional() })
});
export class McpHandler {
    config;
    github;
    events;
    sessions = new Map();
    tools = [
        {
            name: "launch_codex_task",
            title: "Launch Codex task via GitHub",
            description: "Dispatch the codex-task workflow on a repository",
            requiredScopes: ["mcp.codex.launch"],
            inputSchema: {
                type: "object",
                required: ["owner", "repo", "ref", "instruction"],
                properties: {
                    owner: { type: "string" },
                    repo: { type: "string" },
                    ref: { type: "string" },
                    instruction: { type: "string" },
                    working_dir: { type: "string" },
                    codex_args: { type: "array", items: { type: "string" } },
                    correlation_id: { type: "string" }
                }
            },
            outputSchema: {
                type: "object",
                required: ["run_id", "audit_url"],
                properties: {
                    run_id: { type: "string" },
                    audit_url: { type: "string", format: "uri" }
                }
            }
        },
        {
            name: "pr_review",
            title: "Submit a pull request review",
            description: "Create a review on a pull request with optional inline comments",
            requiredScopes: ["mcp.pr.review"],
            inputSchema: {
                type: "object",
                required: ["owner", "repo", "number", "event"],
                properties: {
                    owner: { type: "string" },
                    repo: { type: "string" },
                    number: { type: "number" },
                    body: { type: "string" },
                    event: { type: "string", enum: ["COMMENT", "APPROVE", "REQUEST_CHANGES"] },
                    comments: {
                        type: "array",
                        items: {
                            type: "object",
                            required: ["path", "body"],
                            properties: {
                                path: { type: "string" },
                                body: { type: "string" },
                                position: { type: "number" },
                                line: { type: "number" },
                                side: { type: "string", enum: ["LEFT", "RIGHT"] }
                            }
                        }
                    },
                    correlation_id: { type: "string" }
                }
            },
            outputSchema: {
                type: "object",
                required: ["review_id", "html_url"],
                properties: {
                    review_id: { type: "number" },
                    html_url: { type: "string", format: "uri" }
                }
            }
        },
        {
            name: "pr_gate",
            title: "Evaluate pull request gate",
            description: "Gather mergeability, checks, and approvals to determine readiness",
            requiredScopes: ["mcp.pr.gate"],
            inputSchema: {
                type: "object",
                required: ["owner", "repo", "number"],
                properties: {
                    owner: { type: "string" },
                    repo: { type: "string" },
                    number: { type: "number" },
                    correlation_id: { type: "string" }
                }
            },
            outputSchema: {
                type: "object",
                required: ["verdict", "reasons"],
                properties: {
                    verdict: { type: "string", enum: ["OK", "BLOCKED"] },
                    reasons: {
                        type: "array",
                        items: {
                            type: "object",
                            required: ["type", "message"],
                            properties: {
                                type: { type: "string" },
                                message: { type: "string" }
                            }
                        }
                    },
                    mergeable_state: { type: "string" }
                }
            }
        },
        {
            name: "pr_merge",
            title: "Merge a pull request with gating",
            description: "Merge a PR after verifying gate status",
            requiredScopes: ["mcp.pr.merge"],
            inputSchema: {
                type: "object",
                required: ["owner", "repo", "number"],
                properties: {
                    owner: { type: "string" },
                    repo: { type: "string" },
                    number: { type: "number" },
                    method: { type: "string", enum: ["merge", "squash", "rebase"] },
                    correlation_id: { type: "string" }
                }
            },
            outputSchema: {
                type: "object",
                required: ["merged", "message"],
                properties: {
                    merged: { type: "boolean" },
                    message: { type: "string" }
                }
            }
        },
        {
            name: "trigger_validation",
            title: "Trigger a validation workflow",
            description: "Dispatch any workflow with optional inputs",
            requiredScopes: ["mcp.validation.trigger"],
            inputSchema: {
                type: "object",
                required: ["owner", "repo", "ref", "workflow"],
                properties: {
                    owner: { type: "string" },
                    repo: { type: "string" },
                    ref: { type: "string" },
                    workflow: { type: "string" },
                    inputs: {
                        type: "object",
                        additionalProperties: { type: "string" }
                    },
                    correlation_id: { type: "string" }
                }
            },
            outputSchema: {
                type: "object",
                required: ["run_id"],
                properties: {
                    run_id: { type: "string" }
                }
            }
        }
    ];
    constructor(config, github, events) {
        this.config = config;
        this.github = github;
        this.events = events;
    }
    getSession(sessionId) {
        return sessionId ? this.sessions.get(sessionId) : undefined;
    }
    createSession(protocolVersion) {
        const id = nanoid();
        const session = { id, protocolVersion, initialized: true };
        this.sessions.set(id, session);
        return session;
    }
    listTools() {
        return this.tools;
    }
    async handleRequest(session, request) {
        switch (request.method) {
            case "initialize":
                return this.handleInitialize(request);
            case "initialized":
                return { response: { jsonrpc: "2.0", id: request.id, result: { ok: true } } };
            case "tools/list":
                return { response: this.handleToolsList(request) };
            case "tools/call":
                return { response: await this.handleToolCall(request, session) };
            default:
                return {
                    response: {
                        jsonrpc: "2.0",
                        id: request.id,
                        error: {
                            code: -32601,
                            message: `Method ${request.method} not implemented`
                        }
                    }
                };
        }
    }
    handleInitialize(request) {
        const parseResult = InitializeParams.safeParse(request.params);
        if (!parseResult.success) {
            return {
                response: {
                    jsonrpc: "2.0",
                    id: request.id,
                    error: {
                        code: -32602,
                        message: "Invalid initialize params",
                        data: parseResult.error.format()
                    }
                }
            };
        }
        const { protocolVersion } = parseResult.data;
        if (protocolVersion !== this.config.protocolVersion) {
            return {
                response: {
                    jsonrpc: "2.0",
                    id: request.id,
                    error: {
                        code: -32001,
                        message: `Unsupported protocol version ${protocolVersion}`
                    }
                }
            };
        }
        const session = this.createSession(protocolVersion);
        return {
            response: {
                jsonrpc: "2.0",
                id: request.id,
                result: {
                    protocolVersion,
                    serverInfo: {
                        name: "codex-mcp-gateway",
                        version: "0.1.0"
                    },
                    capabilities: {
                        tools: {
                            listChanged: true
                        }
                    },
                    sessionId: session.id
                }
            },
            session
        };
    }
    handleToolsList(request) {
        return {
            jsonrpc: "2.0",
            id: request.id,
            result: {
                tools: this.listTools()
            }
        };
    }
    async handleToolCall(request, session) {
        if (!session) {
            return {
                jsonrpc: "2.0",
                id: request.id,
                error: {
                    code: -32002,
                    message: "Missing session"
                }
            };
        }
        const paramsParse = z
            .object({
            name: z.string(),
            arguments: z.unknown().optional()
        })
            .safeParse(request.params);
        if (!paramsParse.success) {
            return {
                jsonrpc: "2.0",
                id: request.id,
                error: {
                    code: -32602,
                    message: "Invalid tool call params",
                    data: paramsParse.error.format()
                }
            };
        }
        const params = paramsParse.data;
        // Check scopes if OAuth is enabled
        const tool = this.tools.find((t) => t.name === params.name);
        if (tool?.requiredScopes && this.config.requireOAuth) {
            const hasAllScopes = tool.requiredScopes.every((scope) => session.scopes?.includes(scope));
            if (!hasAllScopes) {
                return {
                    jsonrpc: "2.0",
                    id: request.id,
                    error: {
                        code: -32003,
                        message: "Insufficient permissions",
                        data: {
                            required: tool.requiredScopes,
                            provided: session.scopes
                        }
                    }
                };
            }
        }
        try {
            switch (params.name) {
                case "launch_codex_task": {
                    const input = LaunchCodexTaskInput.parse(params.arguments);
                    const result = await launchCodexTask(input, this.github, this.events);
                    return this.toolResult(request.id, result);
                }
                case "pr_review": {
                    const input = PrReviewInput.parse(params.arguments);
                    const result = await submitPullRequestReview(input, this.github, this.events);
                    return this.toolResult(request.id, result);
                }
                case "pr_gate": {
                    const input = PrGateInput.parse(params.arguments);
                    const result = await evaluatePullRequestGate(input, this.github, this.events);
                    return this.toolResult(request.id, result);
                }
                case "pr_merge": {
                    const input = PrMergeInput.parse(params.arguments);
                    const result = await mergePullRequest(input, this.github, this.events);
                    return this.toolResult(request.id, result);
                }
                case "trigger_validation": {
                    const input = TriggerValidationInput.parse(params.arguments);
                    const result = await triggerValidationWorkflow(input, this.github, this.events);
                    return this.toolResult(request.id, result);
                }
                default:
                    return {
                        jsonrpc: "2.0",
                        id: request.id,
                        error: {
                            code: -32601,
                            message: `Tool ${params.name} not found`
                        }
                    };
            }
        }
        catch (error) {
            if (error instanceof z.ZodError) {
                return this.toolError(request.id, `Validation error: ${error.message}`);
            }
            if (error instanceof GitHubError) {
                return this.toolError(request.id, `GitHub API error (${error.status})`, error.payload);
            }
            return this.toolError(request.id, error instanceof Error ? error.message : "Unknown error");
        }
    }
    toolResult(id, data) {
        return {
            jsonrpc: "2.0",
            id,
            result: {
                content: [
                    {
                        type: "json",
                        json: data
                    }
                ]
            }
        };
    }
    toolError(id, message, data) {
        return {
            jsonrpc: "2.0",
            id,
            result: {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: message
                    }
                ],
                data
            }
        };
    }
}
