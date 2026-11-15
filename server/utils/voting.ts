/** Peer voting is open only during the voting phase when the toggle is enabled. */
export function isVotingOpen(
    hackathon: Pick<Hackathon, "status" | "voting_enabled"> | null | undefined,
): boolean {
    return hackathon?.status === "voting" && Boolean(hackathon.voting_enabled);
}
