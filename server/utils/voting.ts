/**
 * Peer voting is open whenever the dev-portal `voting_enabled` toggle is on.
 * Only the explicit `paused` maintenance state overrides the toggle; the event
 * phase does not silently veto an organizer's choice.
 */
export function isVotingOpen(
    hackathon: Pick<Hackathon, "status" | "voting_enabled"> | null | undefined,
): boolean {
    if (!hackathon || hackathon.status === "paused") return false;
    return Boolean(hackathon.voting_enabled);
}
