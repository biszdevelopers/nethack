import type { H3Event } from "h3";
import { eq, asc } from "drizzle-orm";
import { hackathon, seasons } from "~~/server/database/schema";
import { getHackathon } from "./hackathon";
import { firstRow } from "./query";

/**
 * Per-season tweakable settings. These columns exist on both the `seasons`
 * table (per-season storage) and the `hackathon` singleton (live state for
 * the currently active season).
 */
export const SEASON_TWEAK_FIELDS = ["status", "show_scores", "show_ranking"] as const;

export type SeasonTweaks = Partial<Pick<Season, (typeof SEASON_TWEAK_FIELDS)[number]>>;

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
    return (await event.context.drizzle
        .select()
        .from(seasons)
        .orderBy(asc(seasons.id))) as Season[];
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
    showScores: boolean;
    showRanking: boolean;
}

/**
 * Builds a resolver that maps a season ID to its score/rank visibility
 * settings. Each season's own tweaks are authoritative for its teams;
 * teams whose season no longer exists fall back to the live hackathon
 * singleton row.
 */
export async function getScoreRankVisibilityResolver(
    event: H3Event,
): Promise<(seasonId: number | null | undefined) => ScoreRankVisibility> {
    const allSeasons = await getSeasons(event);
    const hackathonRow = await getHackathon(event);

    const bySeason = new Map<number, ScoreRankVisibility>();
    for (const season of allSeasons) {
        bySeason.set(season.id, {
            showScores: !!season.show_scores,
            showRanking: !!season.show_ranking,
        });
    }

    const fallback: ScoreRankVisibility = {
        showScores: !!hackathonRow?.show_scores,
        showRanking: !!hackathonRow?.show_ranking,
    };

    return (seasonId) => (seasonId != null ? bySeason.get(seasonId) : undefined) ?? fallback;
}

/**
 * Updates the tweakable settings of a single season. When the season is the
 * currently active (live) season, the hackathon singleton row is updated as
 * well so the changes take effect immediately.
 *
 * Returns the updated season, or null when the season does not exist.
 */
export async function updateSeasonTweaks(
    event: H3Event,
    seasonId: number,
    data: SeasonTweaks,
): Promise<Season | null> {
    const tweaks = pickTweaks(data as Record<string, unknown>);

    return event.context.drizzle.transaction(async (tx) => {
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
}

export async function setActiveSeason(event: H3Event, seasonId: number | null) {
    await event.context.drizzle.transaction(async (tx) => {
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
        }

        await tx.update(seasons).set({ is_active: 0 });

        if (seasonId !== null && season) {
            await tx.update(seasons).set({ is_active: 1 }).where(eq(seasons.id, seasonId));

            // Copy the newly active season's tweaks into the live hackathon row
            const tweaks = pickTweaks(season as unknown as Record<string, unknown>);
            if (Object.keys(tweaks).length > 0) {
                await tx.update(hackathon).set(tweaks).where(eq(hackathon.id, 1));
            }
        }
    });
}
