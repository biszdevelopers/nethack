import type { H3Event } from "h3";
import { eq, asc } from "drizzle-orm";
import { hackathon, seasons } from "~~/server/database/schema";
import { getHackathon } from "./hackathon";
import { firstRow } from "./query";
import { hackathonUsesYaml } from "../hackathon-config";

/**
 * Per-season tweakable settings. In PostgreSQL rollback mode these fields
 * also synchronize with the legacy live singleton.
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
    const rows = (await event.context.drizzle
        .select()
        .from(seasons)
        .orderBy(asc(seasons.id))) as Season[];
    const active = rows.findIndex((season) => season.is_active === 1);
    if (active >= 0) rows[active] = await withLiveConfig(event, rows[active]!);
    return rows;
}

async function withLiveConfig(event: H3Event, season: Season): Promise<Season> {
    if (season.is_active !== 1 || !hackathonUsesYaml()) return season;
    const config = await getHackathon(event);
    return { ...season, ...config, id: season.id };
}

export async function getSeasonById(event: H3Event, seasonId: number): Promise<Season | null> {
    const row = await firstRow(
        event.context.drizzle.select().from(seasons).where(eq(seasons.id, seasonId)).limit(1),
    );

    return row ? withLiveConfig(event, row as Season) : null;
}

export async function getActiveSeason(event: H3Event): Promise<Season | null> {
    const row = await firstRow(
        event.context.drizzle.select().from(seasons).where(eq(seasons.is_active, 1)).limit(1),
    );

    return row ? withLiveConfig(event, row as Season) : null;
}

export interface ScoreRankVisibility {
    resultsPublished: boolean;
    showScores: boolean;
    showRanking: boolean;
}

/**
 * Resolve score/rank visibility from live YAML for the active season and
 * from stored settings for past seasons. Keep unknown seasons private in YAML mode.
 */
export async function getScoreRankVisibilityResolver(
    event: H3Event,
): Promise<(seasonId: number | null | undefined) => ScoreRankVisibility> {
    const allSeasons = await getSeasons(event);
    const hackathonRow = hackathonUsesYaml() ? null : await getHackathon(event);

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
 * Update a season's stored tweaks. Live YAML settings are edited at their source.
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
            if (season.is_active === 1 && hackathonUsesYaml()) {
                throw createError({
                    statusCode: 409,
                    message: "Edit the configured HACKATHON.yml to change live settings.",
                });
            }
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
    const liveConfig = hackathonUsesYaml() ? await getHackathon(event) : null;
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

        if (liveConfig && season?.is_active !== 1) {
            const { id, submitted_count, ...settings } = liveConfig;
            await tx.update(seasons).set(settings).where(eq(seasons.is_active, 1));
        }
        await tx.update(seasons).set({ is_active: 0 });

        if (seasonId !== null && season) {
            await tx.update(seasons).set({ is_active: 1 }).where(eq(seasons.id, seasonId));

            if (!hackathonUsesYaml()) {
                const tweaks = pickTweaks(season as unknown as Record<string, unknown>);
                await tx.update(hackathon).set(tweaks).where(eq(hackathon.id, 1));
            }
        }
    });
}
