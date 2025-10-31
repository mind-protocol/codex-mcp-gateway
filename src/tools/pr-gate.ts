import { z } from "zod";
import type { GitHubClient } from "../github/client.js";
import type { EventBus } from "../events.js";

export const PrGateInput = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  number: z.number().int().positive(),
  correlation_id: z.string().optional()
});

export type PrGateInput = z.infer<typeof PrGateInput>;

export interface PrGateReason {
  type: string;
  message: string;
}

export interface PrGateResult {
  verdict: "OK" | "BLOCKED";
  reasons: PrGateReason[];
  mergeable_state: string | undefined;
}

export async function evaluatePullRequestGate(
  input: PrGateInput,
  github: GitHubClient,
  events: EventBus
): Promise<PrGateResult> {
  const pr = await github.getPullRequest({ owner: input.owner, repo: input.repo, number: input.number });
  const status = await github.listRequiredStatusChecks({ owner: input.owner, repo: input.repo, ref: pr.head.sha });
  const reviews = await github.listReviews({ owner: input.owner, repo: input.repo, number: input.number });

  const reasons: PrGateReason[] = [];

  if (pr.mergeable === false) {
    reasons.push({ type: "mergeable", message: `Pull request is not mergeable (${pr.mergeable_state ?? "unknown"})` });
  }

  const failingStatuses = status.statuses.filter((item) => item.state !== "success");
  if (failingStatuses.length > 0) {
    reasons.push({
      type: "status_checks",
      message: `Failing status checks: ${failingStatuses.map((item) => `${item.context}:${item.state}`).join(", ")}`
    });
  }

  const approvals = reviews.filter((review) => review.state === "APPROVED");
  if (approvals.length === 0) {
    reasons.push({ type: "approvals", message: "No approving reviews" });
  }

  const verdict: "OK" | "BLOCKED" = reasons.length === 0 ? "OK" : "BLOCKED";

  const result: PrGateResult = {
    verdict,
    reasons,
    mergeable_state: pr.mergeable_state
  };

  events.emit(
    "pr.gated",
    {
      owner: input.owner,
      repo: input.repo,
      number: input.number,
      verdict,
      reasons
    },
    input.correlation_id
  );

  return result;
}
