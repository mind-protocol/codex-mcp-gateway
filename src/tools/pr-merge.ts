import { z } from "zod";
import type { GitHubClient } from "../github/client.js";
import type { EventBus } from "../events.js";
import { evaluatePullRequestGate, PrGateInput } from "./pr-gate.js";

export const PrMergeInput = PrGateInput.extend({
  method: z.enum(["merge", "squash", "rebase"]).optional()
});

export type PrMergeInput = z.infer<typeof PrMergeInput>;

export interface PrMergeResult {
  merged: boolean;
  message: string;
}

export async function mergePullRequest(
  input: PrMergeInput,
  github: GitHubClient,
  events: EventBus
): Promise<PrMergeResult> {
  const gate = await evaluatePullRequestGate(input, github, events);
  if (gate.verdict !== "OK") {
    return {
      merged: false,
      message: `PR blocked: ${gate.reasons.map((reason) => reason.message).join("; ")}`
    };
  }

  const response = await github.mergePullRequest({
    owner: input.owner,
    repo: input.repo,
    number: input.number,
    method: input.method
  });

  if (!response.merged) {
    return { merged: false, message: response.message };
  }

  events.emit(
    "pr.merged",
    {
      owner: input.owner,
      repo: input.repo,
      number: input.number,
      method: input.method ?? "merge"
    },
    input.correlation_id
  );

  return { merged: response.merged, message: response.message };
}
