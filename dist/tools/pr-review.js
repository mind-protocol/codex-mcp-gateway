import { z } from "zod";
const ReviewEvent = z.enum(["COMMENT", "APPROVE", "REQUEST_CHANGES"]);
const InlineComment = z.object({
    path: z.string().min(1),
    body: z.string().min(1),
    position: z.number().int().positive().optional(),
    line: z.number().int().positive().optional(),
    side: z.enum(["LEFT", "RIGHT"]).optional()
});
export const PrReviewInput = z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    number: z.number().int().positive(),
    body: z.string().optional(),
    event: ReviewEvent,
    comments: z.array(InlineComment).optional(),
    correlation_id: z.string().optional()
});
export async function submitPullRequestReview(input, github, events) {
    const response = await github.createReview({
        owner: input.owner,
        repo: input.repo,
        number: input.number,
        event: input.event,
        body: input.body,
        comments: input.comments?.map((comment) => ({
            path: comment.path,
            body: comment.body,
            position: comment.position,
            line: comment.line,
            side: comment.side
        }))
    });
    events.emit("pr.reviewed", {
        owner: input.owner,
        repo: input.repo,
        number: input.number,
        review_id: response.id,
        state: response.state
    }, input.correlation_id);
    return { review_id: response.id, html_url: response.html_url };
}
