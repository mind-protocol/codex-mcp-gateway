import request from "supertest";
import { describe, expect, it, beforeEach } from "vitest";
import type { AppConfig } from "../src/config.js";
import { createServer } from "../src/server.js";
import type { GitHubClient } from "../src/github/client.js";

class FakeGitHub implements Partial<GitHubClient> {
  public dispatchCalls: unknown[] = [];
  public reviewCalls: unknown[] = [];
  public mergeCalls: unknown[] = [];

  async dispatchWorkflow(params: unknown) {
    this.dispatchCalls.push(params);
    return {};
  }

  async createReview() {
    const review = { id: 42, html_url: "https://example.com/review/42", state: "APPROVED" };
    this.reviewCalls.push(review);
    return review;
  }

  async getPullRequest() {
    return {
      state: "open",
      mergeable: true,
      mergeable_state: "clean",
      base: { ref: "main" },
      head: { sha: "abc" },
      number: 1,
      html_url: "https://example.com/pr/1"
    };
  }

  async listRequiredStatusChecks() {
    return { state: "success", statuses: [] };
  }

  async listReviews() {
    return [{ id: 1, html_url: "https://example.com/review/1", state: "APPROVED" }];
  }

  async mergePullRequest() {
    const mergeResult = { merged: true, message: "merged" };
    this.mergeCalls.push(mergeResult);
    return mergeResult;
  }
}

describe("MCP server", () => {
  const testConfig: AppConfig = {
    port: 0,
    authToken: "test-token",
    allowedOrigins: [],
    githubToken: "ghp_test",
    logLevel: "silent",
    protocolVersion: "2025-06-18"
  };
  let fakeGithub: FakeGitHub;
  let app: ReturnType<typeof createServer>["app"];

  beforeEach(() => {
    fakeGithub = new FakeGitHub();
    const { app: expressApp } = createServer({
      config: testConfig,
      githubClient: fakeGithub as unknown as GitHubClient
    });
    app = expressApp;
  });

  async function initializeSession() {
    const response = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer test-token")
      .set("Content-Type", "application/json")
      .set("MCP-Protocol-Version", "2025-06-18")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          clientInfo: { name: "vitest" }
        }
      });
    return response;
  }

  it("performs initialize handshake", async () => {
    const response = await initializeSession();
    expect(response.status).toBe(200);
    expect(response.headers["mcp-session-id"]).toBeDefined();
    expect(response.body.result.protocolVersion).toBe("2025-06-18");
  });

  it("lists tools", async () => {
    const initResponse = await initializeSession();
    const sessionId = initResponse.headers["mcp-session-id"] as string;
    const response = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer test-token")
      .set("Content-Type", "application/json")
      .set("MCP-Protocol-Version", "2025-06-18")
      .set("Mcp-Session-Id", sessionId)
      .send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(response.status).toBe(200);
    expect(response.body.result.tools).toHaveLength(5);
  });

  it("dispatches launch_codex_task tool", async () => {
    const initResponse = await initializeSession();
    const sessionId = initResponse.headers["mcp-session-id"] as string;
    const response = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer test-token")
      .set("Content-Type", "application/json")
      .set("MCP-Protocol-Version", "2025-06-18")
      .set("Mcp-Session-Id", sessionId)
      .send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "launch_codex_task",
          arguments: {
            owner: "openai",
            repo: "codex",
            ref: "main",
            instruction: "test"
          }
        }
      });
    expect(response.status).toBe(200);
    expect(fakeGithub.dispatchCalls).toHaveLength(1);
    expect(response.body.result.content[0].json.run_id).toContain("openai/codex");
  });
});
