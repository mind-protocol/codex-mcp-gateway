import { z } from "zod";
import { evaluatePullRequestGate, PrGateInput } from "./pr-gate.js";
export const PrMergeInput = PrGateInput.extend({
    method: z.enum(["merge", "squash", "rebase"]).optional()
});
export async function mergePullRequest(input, github, events) {
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
    events.emit("pr.merged", {
        owner: input.owner,
        repo: input.repo,
        number: input.number,
        method: input.method ?? "merge"
    }, input.correlation_id);
    return { merged: response.merged, message: response.message };
}
