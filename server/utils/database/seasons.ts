import type { H3Event } from "h3";
import { eq, asc, sql } from "drizzle-orm";
import { hackathon, seasons } from "~~/server/database/schema";
import { LIVE_OVERRIDE_KEYS } from "~~/shared/schemas";
import { getHackathon, invalidateHackathonCache } from "./hackathon";
import { firstRow } from "./query";
import {
    getHackathonConfigSource,
    hackathonUsesYaml,
    writeHackathonConfig,
} from "../hackathon-config";

/**
 * Per-season tweakable settings. In PostgreSQL rollback mode these fields
 * also synchronize with the legacy live singleton.
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

/** Advisory-lock key shared by every process that can switch the active season. */
const ACTIVATION_LOCK_KEY = 0x4e455448;

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
    const currentLive = await getHackathon(event);
    const liveConfig = hackathonUsesYaml() ? currentLive : null;
    const [previousActive] = await event.context.drizzle
        .select({ id: seasons.id })
        .from(seasons)
        .where(eq(seasons.is_active, 1))
        .limit(1);
    const [previousLive] = await event.context.drizzle.select().from(hackathon).limit(1);
    let activationSettings: Record<string, unknown> | null = null;

    await event.context.drizzle.transaction(async (tx) => {
        // The in-memory queue only covers one process. A transaction-scoped
        // advisory lock also serializes activations across app instances;
        // SQLite fixtures have no `FOR UPDATE`, so skip it there.
        const probe = tx.select().from(seasons).limit(1) as { for?: unknown };
        if (typeof probe.for === "function") {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(${ACTIVATION_LOCK_KEY})`);
        }

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

            const blockers = getSeasonActivationBlockers(season);
            if (blockers.length > 0) {
                throw createError({
                    statusCode: 409,
                    statusMessage: "season_not_ready",
                    message: `Configure this season's ${blockers.join(", ")} before activation.`,
                });
            }
        }

        if (liveConfig && season?.is_active !== 1) {
            const { id, submitted_count, live_overrides, ...settings } = liveConfig;
            await tx.update(seasons).set(settings).where(eq(seasons.is_active, 1));
        }

        await tx.update(seasons).set({ is_active: 0 });

        if (seasonId !== null && season) {
            await tx.update(seasons).set({ is_active: 1 }).where(eq(seasons.id, seasonId));

            if (!hackathonUsesYaml()) {
                // The singleton feeds every public read in database mode, so it
                // needs the activated season's full settings, not three tweaks.
                const settings = pickSeasonConfig(season as unknown as Record<string, unknown>);
                await tx.update(hackathon).set(settings).where(eq(hackathon.id, 1));
            } else if (season.is_active !== 1) {
                // Activating in manifest mode must move the operational switches
                // with it. PostgreSQL stores them so no manifest write is needed.
                const stored = pickSeasonConfig(season as unknown as Record<string, unknown>);
                activationSettings = stored;
                const operationalOverrides = Object.fromEntries(
                    Object.entries(activationSettings).filter(([key]) =>
                        (LIVE_OVERRIDE_KEYS as readonly string[]).includes(key),
                    ),
                );
                await tx
                    .update(hackathon)
                    .set({ ...activationSettings, live_overrides: operationalOverrides })
                    .where(eq(hackathon.id, 1));
            }
        }
    });

    // A remote manifest cannot be rewritten. The operational switches were
    // already stored in PostgreSQL, so activation still applies them; only the
    // manifest-owned schedule and theme stay under the remote file.
    if (activationSettings && getHackathonConfigSource() === "local") {
        try {
            await writeHackathonConfig(activationSettings);
        } catch (error) {
            // Restore the previous active season instead of reporting a switch
            // whose manifest write did not apply.
            try {
                await event.context.drizzle.transaction(async (tx) => {
                    await tx.update(seasons).set({ is_active: 0 }).where(eq(seasons.is_active, 1));
                    if (previousActive) {
                        await tx
                            .update(seasons)
                            .set({ is_active: 1 })
                            .where(eq(seasons.id, previousActive.id));
                    }
                    if (previousLive) {
                        const { id, ...previousSettings } = previousLive;
                        await tx.update(hackathon).set(previousSettings).where(eq(hackathon.id, 1));
                    }
                });
            } catch {
                // Preserve the original activation failure for the caller.
            }
            throw error;
        }
    }
}
