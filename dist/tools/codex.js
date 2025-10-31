import { z } from "zod";
export const LaunchCodexTaskInput = z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    ref: z.string().min(1),
    instruction: z.string().min(1),
    working_dir: z.string().optional(),
    codex_args: z.array(z.string()).optional(),
    correlation_id: z.string().optional()
});
export async function launchCodexTask(input, github, events) {
    events.emit("codex.task.requested", {
        owner: input.owner,
        repo: input.repo,
        ref: input.ref
    }, input.correlation_id);
    await github.dispatchWorkflow({
        owner: input.owner,
        repo: input.repo,
        workflow: "codex-task.yml",
        ref: input.ref,
        inputs: {
            instruction: input.instruction,
            working_dir: input.working_dir ?? "",
            codex_args: input.codex_args?.join(" ") ?? "",
            correlation_id: input.correlation_id ?? ""
        }
    });
    const runId = `${input.owner}/${input.repo}@${input.ref}`;
    const auditUrl = `https://github.com/${input.owner}/${input.repo}/actions`; // cannot know run, provide actions page
    events.emit("codex.task.accepted", {
        run_id: runId,
        audit_url: auditUrl,
        owner: input.owner,
        repo: input.repo,
        workflow: "codex-task.yml"
    }, input.correlation_id);
    events.emit("codex.task.completed", {
        owner: input.owner,
        repo: input.repo,
        workflow: "codex-task.yml",
        run_id: runId
    }, input.correlation_id);
    return { run_id: runId, audit_url: auditUrl };
}
