import fetch, { Headers } from "node-fetch";
export class GitHubClient {
    config;
    baseUrl = "https://api.github.com";
    constructor(options) {
        this.config = options.config;
    }
    buildHeaders() {
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
    async request(path, init) {
        const response = await fetch(`${this.baseUrl}${path}`, {
            ...init,
            headers: { ...Object.fromEntries(this.buildHeaders()), ...(init.headers ?? {}) }
        });
        const text = await response.text();
        const data = text ? JSON.parse(text) : undefined;
        if (!response.ok) {
            throw new GitHubError(response.status, data);
        }
        return data;
    }
    dispatchWorkflow(params) {
        return this.request(`/repos/${params.owner}/${params.repo}/actions/workflows/${params.workflow}/dispatches`, {
            method: "POST",
            body: JSON.stringify({ ref: params.ref, inputs: params.inputs })
        });
    }
    createReview(params) {
        return this.request(`/repos/${params.owner}/${params.repo}/pulls/${params.number}/reviews`, {
            method: "POST",
            body: JSON.stringify({
                event: params.event,
                body: params.body,
                comments: params.comments
            })
        });
    }
    getPullRequest(params) {
        return this.request(`/repos/${params.owner}/${params.repo}/pulls/${params.number}`, {
            method: "GET"
        });
    }
    listRequiredStatusChecks(params) {
        return this.request(`/repos/${params.owner}/${params.repo}/commits/${params.ref}/status`, {
            method: "GET"
        });
    }
    listReviews(params) {
        return this.request(`/repos/${params.owner}/${params.repo}/pulls/${params.number}/reviews`, {
            method: "GET"
        });
    }
    mergePullRequest(params) {
        return this.request(`/repos/${params.owner}/${params.repo}/pulls/${params.number}/merge`, {
            method: "PUT",
            body: JSON.stringify({ merge_method: params.method ?? "merge" })
        });
    }
}
export class GitHubError extends Error {
    status;
    payload;
    constructor(status, payload) {
        super(`GitHub API error: ${status}`);
        this.status = status;
        this.payload = payload;
    }
}
