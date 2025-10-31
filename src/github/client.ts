import fetch, { Headers, type RequestInit } from "node-fetch";
import type { AppConfig } from "../config.js";

export interface GitHubClientOptions {
  config: AppConfig;
}

export class GitHubClient {
  private readonly config: AppConfig;
  private readonly baseUrl = "https://api.github.com";

  constructor(options: GitHubClientOptions) {
    this.config = options.config;
  }

  private buildHeaders() {
    const headers = new Headers({
      Accept: "application/vnd.github+json",
      "User-Agent": "codex-mcp-gateway/0.1.0"
    });
    if (!this.config.githubToken) {
      throw new Error("Missing GitHub token configuration");
    }
    headers.set("Authorization", `Bearer ${this.config.githubToken}`);
    return headers;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...Object.fromEntries(this.buildHeaders()), ...(init.headers ?? {}) }
    });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as unknown) : undefined;
    if (!response.ok) {
      throw new GitHubError(response.status, data);
    }
    return data as T;
  }

  public dispatchWorkflow(params: {
    owner: string;
    repo: string;
    workflow: string;
    ref: string;
    inputs?: Record<string, string>;
  }) {
    return this.request<WorkflowDispatchResponse>(
      `/repos/${params.owner}/${params.repo}/actions/workflows/${params.workflow}/dispatches`,
      {
        method: "POST",
        body: JSON.stringify({ ref: params.ref, inputs: params.inputs })
      }
    );
  }

  public createReview(params: {
    owner: string;
    repo: string;
    number: number;
    event: string;
    body?: string;
    comments?: Array<{ path: string; body: string; position?: number; line?: number; side?: string }>;
  }) {
    return this.request<ReviewResponse>(
      `/repos/${params.owner}/${params.repo}/pulls/${params.number}/reviews`,
      {
        method: "POST",
        body: JSON.stringify({
          event: params.event,
          body: params.body,
          comments: params.comments
        })
      }
    );
  }

  public getPullRequest(params: { owner: string; repo: string; number: number }) {
    return this.request<PullRequestResponse>(
      `/repos/${params.owner}/${params.repo}/pulls/${params.number}`,
      {
        method: "GET"
      }
    );
  }

  public listRequiredStatusChecks(params: { owner: string; repo: string; ref: string }) {
    return this.request<StatusChecksResponse>(
      `/repos/${params.owner}/${params.repo}/commits/${params.ref}/status`,
      {
        method: "GET"
      }
    );
  }

  public listReviews(params: { owner: string; repo: string; number: number }) {
    return this.request<ReviewResponse[]>(
      `/repos/${params.owner}/${params.repo}/pulls/${params.number}/reviews`,
      {
        method: "GET"
      }
    );
  }

  public mergePullRequest(params: {
    owner: string;
    repo: string;
    number: number;
    method?: "merge" | "squash" | "rebase";
  }) {
    return this.request<MergeResponse>(
      `/repos/${params.owner}/${params.repo}/pulls/${params.number}/merge`,
      {
        method: "PUT",
        body: JSON.stringify({ merge_method: params.method ?? "merge" })
      }
    );
  }
}

export class GitHubError extends Error {
  public status: number;
  public payload: unknown;
  constructor(status: number, payload: unknown) {
    super(`GitHub API error: ${status}`);
    this.status = status;
    this.payload = payload;
  }
}

export interface WorkflowDispatchResponse {
  message?: string;
}

export interface ReviewResponse {
  id: number;
  html_url: string;
  state?: string;
  user?: { login: string };
  body?: string;
}

export interface PullRequestResponse {
  state: string;
  mergeable: boolean | null;
  mergeable_state?: string;
  base: { ref: string };
  head: { sha: string };
  number: number;
  html_url: string;
}

export interface StatusChecksResponse {
  state: string;
  statuses: Array<{ context: string; state: string }>;
}

export interface MergeResponse {
  merged: boolean;
  message: string;
}
