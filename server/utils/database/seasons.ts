import type { H3Event } from "h3";
import { eq, asc, sql } from "drizzle-orm";
import { hackathon, rubricVersions, seasons } from "~~/server/database/schema";
import { getHackathon, invalidateHackathonCache } from "./hackathon";
import { firstRow, supportsRowLocks } from "./query";

/**
 * Per-season tweakable settings, synchronized with the live singleton for the active season.
 */
export const SEASON_TWEAK_FIELDS = ["status", "show_scores", "show_ranking"] as const;

/** Event settings that seed a new season and keep blank seasons usable. */
const SEASON_CONFIG_FIELDS = [
    "status",
    "voting_enabled",
    "results_published",
    "show_scores",
    "show_ranking",
    "max_votes_per_user",
    "judging_open",
    "schedule_start",
    "schedule_end",
    "start_timestamp",
    "end_timestamp",
    "voting_start_timestamp",
    "voting_end_timestamp",
    "results_open_timestamp",
    "theme_name",
    "theme_description",
    "announcement",
] as const;

export type SeasonTweaks = Partial<Pick<Season, (typeof SEASON_TWEAK_FIELDS)[number]>>;

export function pickSeasonConfig(
    source: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
    const picked: Record<string, unknown> = {};
    if (!source) return picked;
    for (const field of SEASON_CONFIG_FIELDS) {
        if (source[field] !== undefined) picked[field] = source[field];
    }
    return picked;
}

/** A season nobody configured yet; activating it must not blank the event. */
export function isUnconfiguredSeason(season: Season): boolean {
    return (
        season.status === "not_started" &&
        !season.theme_name &&
        !season.theme_description &&
        season.start_timestamp === 0 &&
        season.end_timestamp === 0 &&
        season.voting_start_timestamp === 0 &&
        season.voting_end_timestamp === 0 &&
        season.results_open_timestamp === 0
    );
}

/** Return the missing season-owned details that must be present before activation. */
export function getSeasonActivationBlockers(season: Season): string[] {
    // Settings-copy seasons inherit the active season's rubric during
    // activation, so only blank-start shells require configuration up front.
    if (season.is_blank_start !== 1) return [];
    const blockers: string[] = [];
    if (!season.theme_name?.trim()) blockers.push("theme");
    if (season.start_timestamp <= 0 || season.end_timestamp <= 0) blockers.push("event dates");
    if (season.voting_start_timestamp <= 0 || season.voting_end_timestamp <= 0) {
        blockers.push("voting dates");
    }
    if (!season.rubric_version_id) blockers.push("judging rubric");
    if (!season.board_approved_at || !season.board_approved_by) blockers.push("board approval");
    return blockers;
}

function pickTweaks(source: Record<string, unknown>): Record<string, unknown> {
    const tweaks: Record<string, unknown> = {};
    for (const field of SEASON_TWEAK_FIELDS) {
        if (source[field] !== undefined) {
            tweaks[field] = source[field];
        }
    }
    return tweaks;
}

export async function getSeasons(event: H3Event): Promise<Season[]> {
    const rows = (await event.context.drizzle
        .select()
        .from(seasons)
        .orderBy(asc(seasons.id))) as Season[];
    return rows;
}

export async function getSeasonById(event: H3Event, seasonId: number): Promise<Season | null> {
    const row = await firstRow(
        event.context.drizzle.select().from(seasons).where(eq(seasons.id, seasonId)).limit(1),
    );

    return (row as Season | undefined) ?? null;
}

export async function getActiveSeason(event: H3Event): Promise<Season | null> {
    const row = await firstRow(
        event.context.drizzle.select().from(seasons).where(eq(seasons.is_active, 1)).limit(1),
    );

    return (row as Season | undefined) ?? null;
}

export interface ScoreRankVisibility {
    resultsPublished: boolean;
    showScores: boolean;
    showRanking: boolean;
}

/**
 * Resolve score/rank visibility from PostgreSQL for live and historical seasons.
 */
export async function getScoreRankVisibilityResolver(
    event: H3Event,
): Promise<(seasonId: number | null | undefined) => ScoreRankVisibility> {
    const allSeasons = await getSeasons(event);
    const hackathonRow = await getHackathon(event);

    const bySeason = new Map<number, ScoreRankVisibility>();
    for (const season of allSeasons) {
        bySeason.set(season.id, {
            resultsPublished: !!season.results_published,
            showScores: !!season.show_scores,
            showRanking: !!season.show_ranking,
        });
    }

    const fallback: ScoreRankVisibility = {
        resultsPublished: !!hackathonRow?.results_published,
        showScores: !!hackathonRow?.show_scores,
        showRanking: !!hackathonRow?.show_ranking,
    };

    return (seasonId) => (seasonId != null ? bySeason.get(seasonId) : undefined) ?? fallback;
}

/**
 * Update a season's stored tweaks and synchronize the active event.
 *
 * Returns the updated season, or null when the season does not exist.
 */
export async function updateSeasonTweaks(
    event: H3Event,
    seasonId: number,
    data: SeasonTweaks,
): Promise<Season | null> {
    const tweaks = pickTweaks(data as Record<string, unknown>);

    const updated = await event.context.drizzle.transaction(async (tx) => {
        const season = await firstRow(
            tx.select().from(seasons).where(eq(seasons.id, seasonId)).limit(1),
        );
        if (!season) return null;

        if (Object.keys(tweaks).length > 0) {
            await tx.update(seasons).set(tweaks).where(eq(seasons.id, seasonId));

            if (season.is_active === 1) {
                await tx.update(hackathon).set(tweaks).where(eq(hackathon.id, 1));
            }
        }

        return (
            ((await firstRow(
                tx.select().from(seasons).where(eq(seasons.id, seasonId)).limit(1),
            )) as Season | undefined) ?? null
        );
    });
    invalidateHackathonCache(event);
    return updated;
}

/** Advisory-lock key shared by every process that can switch the active season. */
const ACTIVATION_LOCK_KEY = 0x4e455448;

/** Take the transaction-scoped activation lock on PostgreSQL; no-op on SQLite. */
export async function acquireActivationLock(tx: {
    select: (...args: any[]) => any;
    execute: (statement: any) => Promise<unknown>;
}): Promise<void> {
    if (supportsRowLocks(tx.select().from(seasons).limit(1))) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${ACTIVATION_LOCK_KEY})`);
    }
}

let activationQueue: Promise<unknown> = Promise.resolve();

/** Serialize activations so two admin requests cannot interleave their writes. */
export function setActiveSeason(event: H3Event, seasonId: number | null) {
    invalidateHackathonCache(event);
    const run = activationQueue.then(async () => {
        invalidateHackathonCache(event);
        try {
            return await activateSeason(event, seasonId);
        } finally {
            invalidateHackathonCache(event);
        }
    });
    activationQueue = run.catch(() => undefined);
    return run;
}

async function activateSeason(event: H3Event, seasonId: number | null) {
    await event.context.drizzle.transaction(async (tx) => {
        // The in-memory queue only covers one process. A transaction-scoped
        // advisory lock also serializes activations across app instances;
        // SQLite fixtures have no `FOR UPDATE`, so skip it there.
        await acquireActivationLock(tx);

        const [previousActive] = await tx
            .select({ id: seasons.id })
            .from(seasons)
            .where(eq(seasons.is_active, 1))
            .limit(1);
        const [currentLive] = await tx.select().from(hackathon).limit(1);

        let season: Season | undefined;
        if (seasonId !== null) {
            season = (await firstRow(
                tx.select().from(seasons).where(eq(seasons.id, seasonId)).limit(1),
            )) as Season | undefined;

            if (!season) {
                throw createError({
                    status: 404,
                    message: "Season not found",
                });
            }

            // Keep the existing activation behavior for ordinary legacy season
            // shells. Blank-start seasons are intentional and must remain blank
            // until an administrator configures and approves them.
            if (
                season.is_blank_start !== 1 &&
                season.is_active !== 1 &&
                isUnconfiguredSeason(season)
            ) {
                const seed = pickSeasonConfig(currentLive as Record<string, unknown> | null);
                if (Object.keys(seed).length > 0) {
                    await tx.update(seasons).set(seed).where(eq(seasons.id, season.id));
                    Object.assign(season, seed);
                }
            }

            // A settings-copy season does not inherit the active season's
            // rubric pointer. Materialize an immutable copy so activation
            // cannot produce a season whose submissions and judging fail for
            // lack of a rubric.
            if (season.is_blank_start !== 1 && !season.rubric_version_id) {
                const [sourceSeason] = previousActive
                    ? await tx
                          .select({ rubric_version_id: seasons.rubric_version_id })
                          .from(seasons)
                          .where(eq(seasons.id, previousActive.id))
                          .limit(1)
                    : [];
                const sourceId = sourceSeason?.rubric_version_id;
                const sourceVersion = sourceId
                    ? await firstRow(
                          tx
                              .select()
                              .from(rubricVersions)
                              .where(eq(rubricVersions.id, sourceId))
                              .limit(1),
                      )
                    : undefined;
                if (sourceVersion) {
                    const existing = await firstRow(
                        tx
                            .select({ id: rubricVersions.id })
                            .from(rubricVersions)
                            .where(eq(rubricVersions.season_id, season.id))
                            .limit(1),
                    );
                    const rubricId =
                        existing?.id ??
                        (
                            await tx
                                .insert(rubricVersions)
                                .values({
                                    season_id: season.id,
                                    version: 1,
                                    name: sourceVersion.name,
                                    definition: sourceVersion.definition,
                                    created_at: new Date(),
                                })
                                .returning({ id: rubricVersions.id })
                        )[0]!.id;
                    await tx
                        .update(seasons)
                        .set({ rubric_version_id: rubricId })
                        .where(eq(seasons.id, season.id));
                    season.rubric_version_id = rubricId;
                }
            }

            const blockers = getSeasonActivationBlockers(season);
            if (blockers.length > 0) {
                throw createError({
                    statusCode: 409,
                    statusMessage: "season_not_ready",
                    message: `Configure this season's ${blockers.join(", ")} before activation.`,
                });
            }
        }

        await tx.update(seasons).set({ is_active: 0 }).where(eq(seasons.is_active, 1));

        if (seasonId !== null && season) {
            await tx.update(seasons).set({ is_active: 1 }).where(eq(seasons.id, seasonId));
            const settings = pickSeasonConfig(season as unknown as Record<string, unknown>);
            await tx.update(hackathon).set(settings).where(eq(hackathon.id, 1));
        }
    });
}
