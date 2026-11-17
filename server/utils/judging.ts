/** Judging is open only during voting, while enabled, and before results are published. */
export function isJudgingOpen(
    hackathon: Pick<Hackathon, "status" | "judging_open" | "results_published"> | null | undefined,
): boolean {
    return (
        hackathon?.status === "voting" &&
        Boolean(hackathon.judging_open) &&
        !hackathon.results_published
    );
}
