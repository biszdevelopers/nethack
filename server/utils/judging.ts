import type { DrizzleDatabase } from "~~/server/database";
import type { H3Event } from "h3";
import { and, eq, inArray, notInArray, or, sql, type SQL } from "drizzle-orm";
import { judgeAssignments, judgeRecusals, teams, userPastTeams } from "~~/server/database/schema";
import { firstRow } from "./database/query";

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
    /** Teams this judge left this season; a former member cannot evaluate them. */
    conflictTeamIds: number[];
}

type JudgeScopeDatabase = Pick<DrizzleDatabase, "select">;

/** Load the assignment and conflict-of-interest scope for one judge. */
export async function getJudgeScope(
    db: JudgeScopeDatabase,
    seasonId: number,
    judgeUserId: number,
): Promise<JudgeScope> {
    const [assignments, recusals, conflicts] = await Promise.all([
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
        db
            .select({ team_id: userPastTeams.team_id })
            .from(userPastTeams)
            .innerJoin(teams, eq(teams.id, userPastTeams.team_id))
            .where(and(eq(userPastTeams.user_id, judgeUserId), eq(teams.season_id, seasonId))),
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
        conflictTeamIds: conflicts.map((conflict) => conflict.team_id),
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
        // An assignment with neither a team nor a pathway means all projects
        // (`allProjects` handles that case); an empty scope here matches
        // nothing rather than leaking the full queue.
        clauses.push(scopeClauses.length > 0 ? or(...scopeClauses)! : sql`false`);
    }
    if (scope.recusedTeamIds.length > 0) {
        clauses.push(notInArray(teams.id, scope.recusedTeamIds));
    }
    if (scope.conflictTeamIds.length > 0) {
        clauses.push(notInArray(teams.id, scope.conflictTeamIds));
    }
    if (clauses.length === 0) return undefined;
    return and(...clauses);
}

/** A recused team is never available to that judge. */
export function judgeCanEvaluate(scope: JudgeScope, team: Pick<Team, "id" | "pathway">): boolean {
    if (scope.recusedTeamIds.includes(team.id)) return false;
    if (scope.conflictTeamIds.includes(team.id)) return false;
    if (!scope.assigned || scope.allProjects) return true;
    if (scope.teamIds.includes(team.id)) return true;
    return team.pathway !== null && scope.pathways.includes(team.pathway);
}

/**
 * A participant competing in a season cannot judge that season. Administrators
 * are exempt because they already hold the explicit staff grant. A stale team
 * pointer from an earlier season does not count as competing.
 */
export async function assertJudgeNotCompeting(
    event: H3Event,
    user: Pick<User, "team_id" | "is_admin">,
    seasonId: number,
): Promise<void> {
    if (user.is_admin === 1 || user.team_id === null) return;
    const competing = await firstRow(
        event.context.drizzle
            .select({ id: teams.id })
            .from(teams)
            .where(and(eq(teams.id, user.team_id), eq(teams.season_id, seasonId)))
            .limit(1),
    );
    if (competing) {
        throw createError({
            statusCode: 403,
            message: "Competing participants cannot judge this season",
        });
    }
}
