import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { H3Event } from "h3";
import {
    calculateWeightedRubricScore,
    getRubricTrack,
    validateRubricScores,
    type RubricTrack,
} from "~~/shared/rubric";
import { rubricVersions, seasons, teamScores, teams } from "~~/server/database/schema";
import type { DrizzleDatabase } from "~~/server/database";
import { lockForUpdateIfSupported } from "./database/query";

export interface RankedTeam extends Team {
    score: number;
    score_exact: number;
    rank: number | null;
}

type RubricVersionRow = typeof rubricVersions.$inferSelect;

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

/** The criterion that decides a tie between equal exact averages. */
function getTiebreakCriterion(track: RubricTrack): string | null {
    let selected: { id: string; weight: number } | null = null;
    for (const criterion of track.criteria) {
        if (!selected || criterion.weight > selected.weight) selected = criterion;
    }
    return selected?.id ?? null;
}

type TrackLookup = { track: RubricTrack | undefined; tiebreak: string | null };

type TrackCache = Map<string, TrackLookup>;

type ScoreDatabase = Pick<DrizzleDatabase, "select" | "update">;

function resolveTrack(
    cache: TrackCache,
    version: RubricVersionRow,
    pathway: string | null,
): TrackLookup {
    const key = `${version.id}:${pathway ?? ""}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const track = getRubricTrack(version.definition, pathway);
    const lookup = { track, tiebreak: track ? getTiebreakCriterion(track) : null };
    cache.set(key, lookup);
    return lookup;
}

function scoreSavedEvaluation(
    team: Pick<Team, "pathway">,
    judgeScore: TeamScores,
    version: RubricVersionRow | undefined,
    cache: TrackCache,
): { exact: number; criterion: number | null } {
    if (!version) {
        throw createError({
            statusCode: 409,
            message: "A saved judge score is missing its team or rubric version.",
        });
    }

    const { track, tiebreak } = resolveTrack(cache, version, team.pathway);
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

    return {
        exact: calculateWeightedRubricScore(track, scores),
        criterion: tiebreak === null ? null : (scores[tiebreak] ?? null),
    };
}

type RankCandidate = {
    id: number;
    pathway: string | null;
    status: TeamStatus;
    score: number;
    score_exact: number;
    criterion: number | null;
    /** Submission time in milliseconds, resolved once per candidate. */
    time: number | null;
    rank: number | null;
};

function submissionTime(value: Date | number | null): number | null {
    if (value === null) return null;
    const time = value instanceof Date ? value.getTime() : Number(value);
    return Number.isFinite(time) ? time : null;
}

function compareCandidates(a: RankCandidate, b: RankCandidate): number {
    if (b.score_exact !== a.score_exact) return b.score_exact - a.score_exact;
    if (a.criterion !== b.criterion) {
        if (a.criterion === null) return 1;
        if (b.criterion === null) return -1;
        return b.criterion - a.criterion;
    }
    if (a.time !== b.time) {
        if (a.time === null) return 1;
        if (b.time === null) return -1;
        return a.time - b.time;
    }
    return a.id - b.id;
}

function sameCompetitionResult(a: RankCandidate, b: RankCandidate): boolean {
    return a.score_exact === b.score_exact && a.criterion === b.criterion && a.time === b.time;
}

function assignCompetitionRanks<T extends RankCandidate>(ranked: T[]): void {
    const byTrack = new Map<string, T[]>();
    for (const team of ranked) {
        // Withdrawn, disqualified, and no-show teams stay visible to admins but
        // never occupy a public rank.
        if (team.status !== "active") {
            team.rank = null;
            continue;
        }
        const trackKey = team.pathway ?? "unassigned";
        const track = byTrack.get(trackKey) ?? [];
        track.push(team);
        byTrack.set(trackKey, track);
    }

    for (const trackTeams of byTrack.values()) {
        trackTeams.sort(compareCandidates);
        let previous: T | undefined;
        let previousRank = 0;
        trackTeams.forEach((team, index) => {
            if (!previous || !sameCompetitionResult(previous, team)) previousRank = index + 1;
            team.rank = previousRank;
            previous = team;
        });
    }
}

const TEAM_RESULT_BATCH = 250;

/**
 * Persist one batch with a single `UPDATE ... FROM (VALUES ...)` statement so
 * the join is O(batch) instead of evaluating a CASE arm per updated row.
 */
async function persistTeamResults(
    db: ScoreDatabase,
    ranked: Pick<RankCandidate, "id" | "score" | "score_exact" | "rank">[],
): Promise<void> {
    for (let offset = 0; offset < ranked.length; offset += TEAM_RESULT_BATCH) {
        const rows = ranked.slice(offset, offset + TEAM_RESULT_BATCH);
        const values = sql.join(
            rows.map(
                (team) =>
                    sql`SELECT CAST(${team.id} AS INTEGER) AS id, CAST(${team.score} AS INTEGER) AS score, CAST(${team.score_exact} AS DOUBLE PRECISION) AS score_exact, CAST(${team.rank} AS INTEGER) AS rank`,
            ),
            sql` UNION ALL `,
        );

        await db
            .update(teams)
            .set({
                score: sql<number>`v.score`,
                score_exact: sql<number>`v.score_exact`,
                rank: sql<number | null>`v.rank`,
            })
            .from(sql`(${values}) AS v`)
            .where(sql`${teams.id} = v.id`);
    }
}

/** Rubric versions are immutable rows, so id lookups can be cached per database. */
const RUBRIC_VERSION_CACHE_LIMIT = 100;
const rubricVersionCaches = new WeakMap<object, Map<number, RubricVersionRow>>();

function rubricVersionStore(db: object): Map<number, RubricVersionRow> {
    const existing = rubricVersionCaches.get(db);
    if (existing) return existing;
    const store = new Map<number, RubricVersionRow>();
    rubricVersionCaches.set(db, store);
    return store;
}

/**
 * Resolve immutable rubric versions by id with a bounded process-local cache.
 * Rows are never updated in place; a new version always gets a new id.
 */
export async function getRubricVersionsByIds(
    db: ScoreDatabase,
    ids: number[],
): Promise<Map<number, RubricVersionRow>> {
    const resolved = new Map<number, RubricVersionRow>();
    if (ids.length === 0) return resolved;

    const store = rubricVersionStore(db);
    const missing: number[] = [];
    for (const id of ids) {
        const cached = store.get(id);
        if (cached) resolved.set(id, cached);
        else missing.push(id);
    }
    if (missing.length > 0) {
        const rows = await db
            .select()
            .from(rubricVersions)
            .where(inArray(rubricVersions.id, missing));
        for (const row of rows) {
            resolved.set(row.id, row);
            store.set(row.id, row);
            if (store.size > RUBRIC_VERSION_CACHE_LIMIT) {
                const oldest = store.keys().next().value;
                if (oldest !== undefined) store.delete(oldest);
            }
        }
    }
    return resolved;
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
    const trackCache: TrackCache = new Map();
    const totals = new Map<
        number,
        { sum: number; count: number; criterionSum: number; criterionCount: number }
    >();

    for (const judgeScore of judgeScores) {
        const team = teamById.get(judgeScore.team_id);
        if (!team) continue;
        const version = versionById.get(judgeScore.rubric_version_id);
        if (!version) {
            throw createError({
                statusCode: 409,
                message: "A saved judge score is missing its team or rubric version.",
            });
        }

        const { exact, criterion } = scoreSavedEvaluation(team, judgeScore, version, trackCache);
        const total = totals.get(team.id) ?? {
            sum: 0,
            count: 0,
            criterionSum: 0,
            criterionCount: 0,
        };
        total.sum += exact;
        total.count += 1;
        if (criterion !== null) {
            total.criterionSum += criterion;
            total.criterionCount += 1;
        }
        totals.set(team.id, total);
    }

    const ranked: RankedTeam[] = [];
    const candidates: RankCandidate[] = [];
    for (const team of seasonTeams) {
        const total = totals.get(team.id);
        const exact = total?.count ? total.sum / total.count : 0;
        const score = Math.round(exact);
        ranked.push({ ...(team as Team), score, score_exact: exact, rank: null });
        candidates.push({
            id: team.id,
            pathway: team.pathway,
            status: team.status as TeamStatus,
            score,
            score_exact: exact,
            criterion: total?.criterionCount ? total.criterionSum / total.criterionCount : null,
            time: submissionTime(team.submitted_at),
            rank: null,
        });
    }
    assignCompetitionRanks(candidates);
    const rankById = new Map(candidates.map((candidate) => [candidate.id, candidate.rank]));
    for (const team of ranked) team.rank = rankById.get(team.id) ?? null;

    if (persist && ranked.length > 0) {
        await persistTeamResults(db, ranked);
    }

    return ranked.sort(
        (a, b) =>
            (a.pathway ?? "").localeCompare(b.pathway ?? "") ||
            (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) ||
            a.id - b.id,
    );
}

/** Recompute one track and repair only ranking rows that changed. */
export async function recalculateTeamScoreAfterSubmission(
    db: ScoreDatabase,
    seasonId: number,
    team: typeof teams.$inferSelect,
    _activeVersion: RubricVersionRow,
): Promise<void> {
    const trackFilter =
        team.pathway === null ? isNull(teams.pathway) : eq(teams.pathway, team.pathway);
    const trackTeams = await db
        .select({
            id: teams.id,
            pathway: teams.pathway,
            status: teams.status,
            score: teams.score,
            score_exact: teams.score_exact,
            rank: teams.rank,
            submitted_at: teams.submitted_at,
        })
        .from(teams)
        .where(and(eq(teams.season_id, seasonId), eq(teams.project_submitted, 1), trackFilter));

    const trackTeamIds = trackTeams.map((trackTeam) => trackTeam.id);
    const [trackScores, versions] = await Promise.all([
        trackTeamIds.length
            ? db
                  .select()
                  .from(teamScores)
                  .where(
                      and(
                          eq(teamScores.season_id, seasonId),
                          inArray(teamScores.team_id, trackTeamIds),
                      ),
                  )
            : Promise.resolve([]),
        db.select().from(rubricVersions).where(eq(rubricVersions.season_id, seasonId)),
    ]);
    const versionsById = new Map(versions.map((version) => [version.id, version]));
    const trackTeamById = new Map(trackTeams.map((trackTeam) => [trackTeam.id, trackTeam]));
    const trackCache: TrackCache = new Map();
    const totals = new Map<
        number,
        { sum: number; count: number; criterionSum: number; criterionCount: number }
    >();
    for (const judgeScore of trackScores) {
        const scoredTeam = trackTeamById.get(judgeScore.team_id);
        if (!scoredTeam) continue;
        const { exact, criterion } = scoreSavedEvaluation(
            scoredTeam,
            judgeScore,
            versionsById.get(judgeScore.rubric_version_id),
            trackCache,
        );
        const total = totals.get(scoredTeam.id) ?? {
            sum: 0,
            count: 0,
            criterionSum: 0,
            criterionCount: 0,
        };
        total.sum += exact;
        total.count += 1;
        if (criterion !== null) {
            total.criterionSum += criterion;
            total.criterionCount += 1;
        }
        totals.set(scoredTeam.id, total);
    }

    const candidates: RankCandidate[] = trackTeams.map((trackTeam) => {
        const total = totals.get(trackTeam.id);
        const exact = total?.count ? total.sum / total.count : 0;
        return {
            id: trackTeam.id,
            pathway: trackTeam.pathway,
            status: trackTeam.status as TeamStatus,
            score: Math.round(exact),
            score_exact: exact,
            criterion: total?.criterionCount ? total.criterionSum / total.criterionCount : null,
            time: submissionTime(trackTeam.submitted_at),
            rank: trackTeam.rank,
        };
    });
    assignCompetitionRanks(candidates);

    const previousById = new Map(trackTeams.map((trackTeam) => [trackTeam.id, trackTeam]));
    const changed = candidates.filter((candidate) => {
        const previous = previousById.get(candidate.id);
        return (
            candidate.score !== previous?.score ||
            candidate.score_exact !== (previous?.score_exact ?? previous?.score ?? 0) ||
            candidate.rank !== previous?.rank
        );
    });
    await persistTeamResults(db, changed);
}

export async function calculateSeasonScores(
    event: H3Event,
    seasonId: number,
    persist = false,
): Promise<RankedTeam[]> {
    const db = event.context.drizzle;
    if (!persist) return calculateSeasonScoresWithDatabase(db, seasonId, false);

    // Judge submissions hold this same season row lock while they insert a score
    // and recalculate. Taking it here keeps a full recompute from overwriting a
    // score that commits while the recompute is reading.
    return db.transaction(async (tx) => {
        await lockForUpdateIfSupported(
            tx.select().from(seasons).where(eq(seasons.id, seasonId)).limit(1),
        );
        return calculateSeasonScoresWithDatabase(tx, seasonId, true);
    });
}

/** Kept as a small compatibility wrapper for internal callers. */
export async function computeScores(event: H3Event, seasonId: number): Promise<void> {
    await calculateSeasonScores(event, seasonId, true);
}
