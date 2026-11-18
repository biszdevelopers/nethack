/**
 * Judging is open when the `judging_open` portal toggle is on during the voting
 * phase. The toggle is authoritative: publishing results does not silently
 * close judging, so the dev-portal switch always dictates the effective state.
 */
export function isJudgingOpen(
    hackathon: Pick<Hackathon, "status" | "judging_open"> | null | undefined,
): boolean {
    return hackathon?.status === "voting" && Boolean(hackathon.judging_open);
}
