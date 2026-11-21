import { isDeadlineEnforcementEnabled } from "./event-state";

/**
 * Peer voting is open whenever the portal `voting_enabled` toggle is on and the
 * event is not paused. A configured voting deadline still closes it unless
 * deadline enforcement is explicitly disabled.
 */
export function isVotingOpen(
    hackathon:
        | (Pick<Hackathon, "status" | "voting_enabled"> & {
              voting_end_timestamp?: number | null;
          })
        | null
        | undefined,
    options: { now?: number; enforceDeadlines?: boolean } = {},
): boolean {
    if (!hackathon || hackathon.status === "paused") return false;
    if (!hackathon.voting_enabled) return false;
    const enforceDeadlines = options.enforceDeadlines ?? isDeadlineEnforcementEnabled();
    const votingEnd = Number(hackathon.voting_end_timestamp ?? 0);
    if (!enforceDeadlines || votingEnd <= 0) return true;
    return (options.now ?? Date.now()) <= votingEnd;
}

export interface PeerBallotRow {
    user_id: number;
    team_id: number | null;
    score: string;
}

export interface PeerVotingProject {
    team_id: number;
    name: string;
    pathway: string | null;
}

export interface PeerVotingSummary {
    votingTeams: number;
    ballots: number;
    projects: Array<{ team_id: number; average_stars: number | null; team_units: number }>;
}

/**
 * People's Choice aggregation: one unit per voting team (its members' ballots
 * averaged), then the unit values averaged across every team that voted.
 */
export function summarizePeerVoting(
    projects: PeerVotingProject[],
    ballots: PeerBallotRow[],
): PeerVotingSummary {
    const projectIds = new Set(projects.map((project) => project.team_id));
    const teamUnits = new Map<number, { sums: Map<number, number>; ballots: number }>();

    for (const ballot of ballots) {
        if (ballot.team_id === null) continue;
        let parsed: Record<string, unknown>;
        try {
            const value: unknown = JSON.parse(ballot.score);
            if (!value || typeof value !== "object" || Array.isArray(value)) continue;
            parsed = value as Record<string, unknown>;
        } catch {
            continue;
        }
        const unit = teamUnits.get(ballot.team_id) ?? { sums: new Map(), ballots: 0 };
        unit.ballots += 1;
        for (const [projectId, raw] of Object.entries(parsed)) {
            const numeric = Number(raw);
            if (!Number.isFinite(numeric) || !projectIds.has(Number(projectId))) continue;
            unit.sums.set(Number(projectId), (unit.sums.get(Number(projectId)) ?? 0) + numeric);
        }
        teamUnits.set(ballot.team_id, unit);
    }

    const votingTeams = teamUnits.size;
    return {
        votingTeams,
        ballots: ballots.length,
        projects: projects.map((project) => {
            let sum = 0;
            let contributors = 0;
            for (const unit of teamUnits.values()) {
                const value = (unit.sums.get(project.team_id) ?? 0) / Math.max(1, unit.ballots);
                sum += value;
                if (value > 0) contributors += 1;
            }
            return {
                team_id: project.team_id,
                average_stars: votingTeams > 0 ? Math.round((sum / votingTeams) * 100) / 100 : null,
                team_units: contributors,
            };
        }),
    };
}
