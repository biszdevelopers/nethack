/** Judging writes and queues are available only during the voting phase while judging is enabled. */
export function isJudgingOpen(
    hackathon: Pick<Hackathon, "status" | "judging_open"> | null | undefined,
): boolean {
    return hackathon?.status === "voting" && Boolean(hackathon.judging_open);
}
