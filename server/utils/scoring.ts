import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
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

type RankCandidate = {
    id: number;
    pathway: string | null;
    score: number;
    rank: number;
};

function scoreSavedEvaluation(
    team: Pick<Team, "pathway">,
    judgeScore: TeamScores,
    version: typeof rubricVersions.$inferSelect | undefined,
): number {
    if (!version) {
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
    if (validateRubricScores(track, scores).length > 0) {
        throw createError({
            statusCode: 409,
            message: "A saved judge score does not match its rubric version.",
        });
    }

    return calculateWeightedRubricScore(track, scores);
}

function assignCompetitionRanks<T extends RankCandidate>(ranked: T[]): void {
    const byTrack = new Map<string, T[]>();
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
}

async function persistTeamResults(
    db: ScoreDatabase,
    ranked: Pick<RankCandidate, "id" | "score" | "rank">[],
): Promise<void> {
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

        const total = totals.get(team.id) ?? { sum: 0, count: 0 };
        total.sum += scoreSavedEvaluation(team, judgeScore, version);
        total.count += 1;
        totals.set(team.id, total);
    }

    const ranked: RankedTeam[] = seasonTeams.map((team) => ({
        ...(team as Team),
        score: Math.round((totals.get(team.id)?.sum ?? 0) / (totals.get(team.id)?.count || 1)),
        rank: 0,
    }));

    assignCompetitionRanks(ranked);

    if (persist && ranked.length > 0) {
        await persistTeamResults(db, ranked);
    }

    return ranked.sort(
        (a, b) =>
            (a.pathway ?? "").localeCompare(b.pathway ?? "") || a.rank - b.rank || a.id - b.id,
    );
}

/** Recompute one finalized project and repair only ranking rows that changed. */
export async function recalculateTeamScoreAfterSubmission(
    db: ScoreDatabase,
    seasonId: number,
    team: typeof teams.$inferSelect,
    activeVersion: typeof rubricVersions.$inferSelect,
): Promise<void> {
    const trackFilter =
        team.pathway === null ? isNull(teams.pathway) : eq(teams.pathway, team.pathway);
    const [judgeScores, trackTeams] = await Promise.all([
        db
            .select()
            .from(teamScores)
            .where(and(eq(teamScores.season_id, seasonId), eq(teamScores.team_id, team.id))),
        db
            .select({ id: teams.id, pathway: teams.pathway, score: teams.score, rank: teams.rank })
            .from(teams)
            .where(and(eq(teams.season_id, seasonId), eq(teams.project_submitted, 1), trackFilter)),
    ]);

    const historicalVersionIds = [
        ...new Set(
            judgeScores
                .map((judgeScore) => judgeScore.rubric_version_id)
                .filter((versionId) => versionId !== activeVersion.id),
        ),
    ];
    const historicalVersions = historicalVersionIds.length
        ? await db
              .select()
              .from(rubricVersions)
              .where(
                  and(
                      eq(rubricVersions.season_id, seasonId),
                      inArray(rubricVersions.id, historicalVersionIds),
                  ),
              )
        : [];
    const versionsById = new Map([
        [activeVersion.id, activeVersion],
        ...historicalVersions.map((version) => [version.id, version] as const),
    ]);

    let total = 0;
    for (const judgeScore of judgeScores) {
        total += scoreSavedEvaluation(
            team,
            judgeScore,
            versionsById.get(judgeScore.rubric_version_id),
        );
    }
    const teamScore = Math.round(total / (judgeScores.length || 1));
    const rankedTrack = trackTeams.map((trackTeam) => ({
        id: trackTeam.id,
        pathway: trackTeam.pathway,
        score: trackTeam.id === team.id ? teamScore : (trackTeam.score ?? 0),
        rank: trackTeam.rank ?? 0,
        previousScore: trackTeam.score,
        previousRank: trackTeam.rank,
    }));
    assignCompetitionRanks(rankedTrack);

    const changed = rankedTrack.filter(
        (trackTeam) =>
            trackTeam.score !== trackTeam.previousScore ||
            trackTeam.rank !== trackTeam.previousRank,
    );
    await persistTeamResults(db, changed);
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
