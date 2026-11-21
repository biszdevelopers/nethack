import type { DrizzleDatabase } from "~~/server/database";
import { and, eq, inArray, notInArray, or, sql, type SQL } from "drizzle-orm";
import { judgeAssignments, judgeRecusals, teams } from "~~/server/database/schema";

/**
 * Judging is open while the portal `judging_open` toggle is on and the event is
 * not paused. Once results are published for a finished season, judging stays
 * closed unless the deployment explicitly opts into post-publication edits.
 */
export function isJudgingOpen(
    hackathon: Pick<Hackathon, "status" | "judging_open"> | null | undefined,
    season?: Pick<Season, "results_published_at"> | null,
): boolean {
    if (!hackathon || hackathon.status === "paused") return false;
    if (!hackathon.judging_open) return false;
    const judgingAfterPublish = process.env.JUDGING_AFTER_PUBLISH?.trim().toLowerCase();
    const allowed = ["on", "true", "1", "yes", "enabled"].includes(judgingAfterPublish ?? "");
    return !(hackathon.status === "finished" && season?.results_published_at && !allowed);
}

export interface JudgeScope {
    /** True when the organizer narrowed this judge's queue with assignment rows. */
    assigned: boolean;
    /** No pathway/team filter within the season. */
    allProjects: boolean;
    teamIds: number[];
    pathways: string[];
    recusedTeamIds: number[];
}

type JudgeScopeDatabase = Pick<DrizzleDatabase, "select">;

/** Load the assignment and conflict-of-interest scope for one judge. */
export async function getJudgeScope(
    db: JudgeScopeDatabase,
    seasonId: number,
    judgeUserId: number,
): Promise<JudgeScope> {
    const [assignments, recusals] = await Promise.all([
        db
            .select({
                pathway: judgeAssignments.pathway,
                team_id: judgeAssignments.team_id,
            })
            .from(judgeAssignments)
            .where(
                and(
                    eq(judgeAssignments.season_id, seasonId),
                    eq(judgeAssignments.judge_user_id, judgeUserId),
                ),
            ),
        db
            .select({ team_id: judgeRecusals.team_id })
            .from(judgeRecusals)
            .where(
                and(
                    eq(judgeRecusals.season_id, seasonId),
                    eq(judgeRecusals.judge_user_id, judgeUserId),
                ),
            ),
    ]);

    const teamIds = new Set<number>();
    const pathways = new Set<string>();
    let allProjects = false;
    for (const assignment of assignments) {
        if (assignment.team_id !== null) teamIds.add(assignment.team_id);
        if (assignment.pathway !== null) pathways.add(assignment.pathway);
        if (assignment.team_id === null && assignment.pathway === null) allProjects = true;
    }

    return {
        assigned: assignments.length > 0,
        allProjects,
        teamIds: [...teamIds],
        pathways: [...pathways],
        recusedTeamIds: recusals.map((recusal) => recusal.team_id),
    };
}

/** Apply an assignment scope as a SQL predicate; `undefined` means no filter. */
export function judgeScopeWhere(scope: JudgeScope): SQL | undefined {
    const clauses: SQL[] = [];
    if (scope.assigned && !scope.allProjects) {
        const scopeClauses: SQL[] = [];
        if (scope.teamIds.length > 0) {
            scopeClauses.push(inArray(teams.id, scope.teamIds));
        }
        if (scope.pathways.length > 0) {
            scopeClauses.push(inArray(teams.pathway, scope.pathways));
        }
        // An assignment with neither a team nor a pathway is filtered out by
        // the validation layer; an empty scope matches nothing.
        clauses.push(scopeClauses.length > 0 ? or(...scopeClauses)! : sql`false`);
    }
    if (scope.recusedTeamIds.length > 0) {
        clauses.push(notInArray(teams.id, scope.recusedTeamIds));
    }
    if (clauses.length === 0) return undefined;
    return and(...clauses);
}

/** A recused team is never available to that judge. */
export function judgeCanEvaluate(scope: JudgeScope, team: Pick<Team, "id" | "pathway">): boolean {
    if (scope.recusedTeamIds.includes(team.id)) return false;
    if (!scope.assigned || scope.allProjects) return true;
    if (scope.teamIds.includes(team.id)) return true;
    return team.pathway !== null && scope.pathways.includes(team.pathway);
}
