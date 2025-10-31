import { z } from "zod";
export const TriggerValidationInput = z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    ref: z.string().min(1),
    workflow: z.string().min(1),
    inputs: z.record(z.string(), z.string()).optional(),
    correlation_id: z.string().optional()
});
export async function triggerValidationWorkflow(input, github, events) {
    await github.dispatchWorkflow({
        owner: input.owner,
        repo: input.repo,
        workflow: input.workflow,
        ref: input.ref,
        inputs: input.inputs
    });
    const runId = `${input.owner}/${input.repo}@${input.ref}#${input.workflow}`;
    events.emit("codex.task.completed", {
        owner: input.owner,
        repo: input.repo,
        workflow: input.workflow,
        run_id: runId
    }, input.correlation_id);
    return { run_id: runId };
}
