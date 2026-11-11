import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { H3Event } from "h3";
import { calculateWeightedRubricScore, validateRubricScores } from "~~/shared/rubric";
import { rubricVersions, teamScores, teams } from "~~/server/database/schema";
import type { DrizzleDatabase } from "~~/server/database";

export interface RankedTeam extends Team {
    score: number;
    rank: number;
}

function parseScoreObject(raw: string): Record<string, number> {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        throw createError({
            statusCode: 409,
            message: "A saved judge score is not valid JSON.",
        });
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw createError({
            statusCode: 409,
            message: "A saved judge score has an invalid shape.",
        });
    }

    return value as Record<string, number>;
}

/** Compute one arithmetic mean of normalized, weighted judge scores per team. */
type ScoreDatabase = Pick<DrizzleDatabase, "select" | "update">;

export async function calculateSeasonScoresWithDatabase(
    db: ScoreDatabase,
    seasonId: number,
    persist = false,
): Promise<RankedTeam[]> {
    const [seasonTeams, judgeScores, versions] = await Promise.all([
        db
            .select()
            .from(teams)
            .where(and(eq(teams.season_id, seasonId), eq(teams.project_submitted, 1)))
            .orderBy(asc(teams.id)),
        db.select().from(teamScores).where(eq(teamScores.season_id, seasonId)),
        db.select().from(rubricVersions).where(eq(rubricVersions.season_id, seasonId)),
    ]);

    const teamById = new Map(seasonTeams.map((team) => [team.id, team]));
    const versionById = new Map(versions.map((version) => [version.id, version]));
    const totals = new Map<number, { sum: number; count: number }>();

    for (const judgeScore of judgeScores) {
        const team = teamById.get(judgeScore.team_id);
        const version = versionById.get(judgeScore.rubric_version_id);
        if (!team || !version) {
            throw createError({
                statusCode: 409,
                message: "A saved judge score is missing its team or rubric version.",
            });
        }

        const track = team.pathway ? version.definition.tracks[team.pathway] : undefined;
        if (!track) {
            throw createError({
                statusCode: 409,
                message: "A saved judge score does not match its rubric track.",
            });
        }

        const scores = parseScoreObject(judgeScore.scores);
        const issues = validateRubricScores(track, scores);
        if (issues.length > 0) {
            throw createError({
                statusCode: 409,
                message: "A saved judge score does not match its rubric version.",
            });
        }

        const total = totals.get(team.id) ?? { sum: 0, count: 0 };
        total.sum += calculateWeightedRubricScore(track, scores);
        total.count += 1;
        totals.set(team.id, total);
    }

    const ranked: RankedTeam[] = seasonTeams.map((team) => ({
        ...(team as Team),
        score: Math.round((totals.get(team.id)?.sum ?? 0) / (totals.get(team.id)?.count || 1)),
        rank: 0,
    }));

    const byTrack = new Map<string, RankedTeam[]>();
    for (const team of ranked) {
        const trackKey = team.pathway ?? "unassigned";
        const track = byTrack.get(trackKey) ?? [];
        track.push(team);
        byTrack.set(trackKey, track);
    }

    for (const trackTeams of byTrack.values()) {
        trackTeams.sort((a, b) => b.score - a.score || a.id - b.id);
        let previousScore: number | undefined;
        let previousRank = 0;
        trackTeams.forEach((team, index) => {
            if (team.score !== previousScore) previousRank = index + 1;
            team.rank = previousRank;
            previousScore = team.score;
        });
    }

    if (persist && ranked.length > 0) {
        for (let offset = 0; offset < ranked.length; offset += 250) {
            const rows = ranked.slice(offset, offset + 250);
            const scoreCase = sql<number>`CASE ${teams.id} ${sql.join(
                rows.map((team) => sql`WHEN ${team.id} THEN ${team.score}`),
                sql` `,
            )} ELSE ${teams.score} END`;
            const rankCase = sql<number>`CASE ${teams.id} ${sql.join(
                rows.map((team) => sql`WHEN ${team.id} THEN ${team.rank}`),
                sql` `,
            )} ELSE ${teams.rank} END`;

            await db
                .update(teams)
                .set({ score: scoreCase, rank: rankCase })
                .where(
                    inArray(
                        teams.id,
                        rows.map((team) => team.id),
                    ),
                );
        }
    }

    return ranked.sort(
        (a, b) =>
            (a.pathway ?? "").localeCompare(b.pathway ?? "") || a.rank - b.rank || a.id - b.id,
    );
}

export async function calculateSeasonScores(
    event: H3Event,
    seasonId: number,
    persist = false,
): Promise<RankedTeam[]> {
    return calculateSeasonScoresWithDatabase(event.context.drizzle, seasonId, persist);
}

/** Kept as a small compatibility wrapper for internal callers. */
export async function computeScores(event: H3Event, seasonId: number): Promise<void> {
    await calculateSeasonScores(event, seasonId, true);
}
