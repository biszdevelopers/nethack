/**
 * Judging is open whenever the dev-portal `judging_open` toggle is on. Only the
 * explicit `paused` maintenance state overrides the toggle; the event phase and
 * published-results flag do not silently veto the organizer's choice.
 */
export function isJudgingOpen(
    hackathon: Pick<Hackathon, "status" | "judging_open"> | null | undefined,
): boolean {
    if (!hackathon || hackathon.status === "paused") return false;
    return Boolean(hackathon.judging_open);
}
