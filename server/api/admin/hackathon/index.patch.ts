import { NethackPermissions } from "~~/shared/permissions";
import { AdminUpdateHackathonRequest, LIVE_OVERRIDE_KEYS } from "~~/shared/schemas";
import { hackathon, seasons } from "~~/server/database/schema";
import { eq } from "drizzle-orm";
import {
    invalidateHackathonCache,
    pickDivergingLiveOverrides,
} from "~~/server/utils/database/hackathon";
import { firstRow, lockForUpdateIfSupported } from "~~/server/utils/database/query";
import { getSeasons } from "~~/server/utils/database/seasons";
import { calculateSeasonScoresWithDatabase } from "~~/server/utils/scoring";
import { writeAuditEvent } from "~~/server/utils/audit";
import { invalidateEventStateCache } from "~~/server/utils/event-state";
import { notifySeasonParticipants } from "~~/server/utils/notifications";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import {
    getHackathonConfigSource,
    hackathonUsesYaml,
    readHackathonConfig,
    writeHackathonConfig,
} from "~~/server/utils/hackathon-config";

async function readManifestSettings(): Promise<Record<string, unknown> | null> {
    if (!hackathonUsesYaml()) return null;
    try {
        const { rubric, ...settings } = await readHackathonConfig();
        return settings as Record<string, unknown>;
    } catch {
        return null;
    }
}

function divergingOverrides(
    manifest: Record<string, unknown> | null,
    operational: Record<string, unknown>,
    existing: Record<string, unknown>,
): Record<string, unknown> {
    return pickDivergingLiveOverrides(manifest, operational, existing);
}

async function applyResultFreeze(
    tx: any,
    season: Season,
    config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    if (config.results_published !== 1 || season.results_published === 1) return config;

    const standings = await calculateSeasonScoresWithDatabase(tx, season.id, false);
    const publishedAt = new Date();
    return {
        ...config,
        // Publication closes judging and voting unless the same request
        // reopens them explicitly.
        ...(Object.hasOwn(config, "judging_open") ? {} : { judging_open: 0 }),
        ...(Object.hasOwn(config, "voting_enabled") ? {} : { voting_enabled: 0 }),
        results_published_at: publishedAt,
        results_snapshot: {
            season_id: season.id,
            generated_at: publishedAt.toISOString(),
            standings: standings.map((team) => ({
                team_id: team.id,
                name: team.name,
                pathway: team.pathway,
                status: team.status,
                score: team.score,
                score_exact: team.score_exact,
                rank: team.rank,
                submitted_at: team.submitted_at,
            })),
        } satisfies Record<string, unknown>,
    };
}

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Hackathon.update);

        const body = await readValidatedBody(event, AdminUpdateHackathonRequest.parse);

        if (Object.keys(body).length === 0) {
            throw createError({ statusCode: 400, message: "No fields to update" });
        }

        const { season_id, ...rawConfig } = body as Record<string, any>;
        const configFields: Record<string, any> = {};
        for (const [key, value] of Object.entries(rawConfig)) {
            if (value !== undefined) configFields[key] = value;
        }
        if (Object.keys(configFields).length === 0) {
            throw createError({ statusCode: 400, message: "No fields to update" });
        }

        const db = event.context.drizzle;
        const [activeSeason] = await db
            .select()
            .from(seasons)
            .where(eq(seasons.is_active, 1))
            .limit(1);
        const targetsLiveSettings = season_id === undefined || season_id === activeSeason?.id;
        const targetSeasonId = season_id ?? activeSeason?.id ?? null;

        let publishedResults = false;
        let publishedSeasonId: number | null = null;

        if (hackathonUsesYaml() && targetsLiveSettings) {
            const operational: Record<string, unknown> = {};
            const statics: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(configFields)) {
                if ((LIVE_OVERRIDE_KEYS as readonly string[]).includes(key)) {
                    operational[key] = value;
                } else {
                    statics[key] = value;
                }
            }
            if (Object.keys(statics).length > 0 && getHackathonConfigSource() !== "local") {
                throw createError({
                    statusCode: 409,
                    message:
                        "Schedule and theme come from the remote HACKATHON.yml. Only status and visibility switches can change here.",
                });
            }

            const manifest = await readManifestSettings();
            const snapshot = await db.transaction(async (tx) => {
                const previousSeason =
                    targetSeasonId === null
                        ? undefined
                        : await firstRow(
                              lockForUpdateIfSupported(
                                  tx
                                      .select()
                                      .from(seasons)
                                      .where(eq(seasons.id, targetSeasonId))
                                      .limit(1),
                              ),
                          );
                const previousLive = await firstRow(
                    lockForUpdateIfSupported(
                        tx.select().from(hackathon).where(eq(hackathon.id, 1)).limit(1),
                    ),
                );
                if (!previousLive || (season_id !== undefined && !previousSeason)) {
                    throw createError({ statusCode: 404, message: "Live settings not found" });
                }

                const seasonConfig = previousSeason
                    ? await applyResultFreeze(tx, previousSeason, configFields)
                    : configFields;
                if (
                    previousSeason &&
                    seasonConfig.results_published === 1 &&
                    previousSeason.results_published !== 1
                ) {
                    publishedResults = true;
                    publishedSeasonId = previousSeason.id;
                }
                const overrides = divergingOverrides(
                    manifest,
                    operational,
                    previousLive.live_overrides ?? {},
                );

                if (previousSeason) {
                    await tx
                        .update(seasons)
                        .set({ ...statics, ...seasonConfig })
                        .where(eq(seasons.id, previousSeason.id));
                }
                await tx
                    .update(hackathon)
                    .set({ ...statics, ...seasonConfig, live_overrides: overrides })
                    .where(eq(hackathon.id, 1));

                await writeAuditEvent(tx, event, {
                    action: "hackathon.update",
                    entity_type: "season",
                    entity_id: targetSeasonId ?? "live",
                    before: previousSeason
                        ? {
                              status: previousSeason.status,
                              voting_enabled: previousSeason.voting_enabled,
                              results_published: previousSeason.results_published,
                              judging_open: previousSeason.judging_open,
                              show_scores: previousSeason.show_scores,
                              show_ranking: previousSeason.show_ranking,
                          }
                        : null,
                    after: seasonConfig,
                });

                return { previousSeason, previousLive };
            });

            if (Object.keys(statics).length > 0) {
                try {
                    await writeHackathonConfig(statics);
                } catch (error) {
                    // The manifest is the source of truth for schedule and
                    // theme. Restore the exact rows we changed rather than
                    // reporting a save the manifest never received.
                    try {
                        await db.transaction(async (tx) => {
                            if (snapshot.previousSeason) {
                                await lockForUpdateIfSupported(
                                    tx
                                        .select()
                                        .from(seasons)
                                        .where(eq(seasons.id, snapshot.previousSeason.id))
                                        .limit(1),
                                );
                            }
                            await lockForUpdateIfSupported(
                                tx.select().from(hackathon).where(eq(hackathon.id, 1)).limit(1),
                            );
                            if (snapshot.previousSeason) {
                                const { id, ...seasonRow } = snapshot.previousSeason;
                                await tx
                                    .update(seasons)
                                    .set(seasonRow as typeof seasons.$inferInsert)
                                    .where(eq(seasons.id, id));
                            }
                            const { id: liveId, ...liveRow } = snapshot.previousLive;
                            await tx
                                .update(hackathon)
                                .set(liveRow as typeof hackathon.$inferInsert)
                                .where(eq(hackathon.id, liveId));
                        });
                    } catch {
                        // Preserve the original manifest failure for the caller.
                    }
                    throw error;
                }
            }
        } else if (hackathonUsesYaml()) {
            if (season_id === undefined) {
                throw createError({ statusCode: 400, message: "season_id is required" });
            }
            await requireUser(event, NethackPermissions.Seasons.update);
            publishedResults = await db.transaction(async (tx) => {
                const previousSeason = await firstRow(
                    lockForUpdateIfSupported(
                        tx.select().from(seasons).where(eq(seasons.id, season_id)).limit(1),
                    ),
                );
                if (!previousSeason) {
                    throw createError({ statusCode: 404, message: "Season not found" });
                }
                const seasonConfig = await applyResultFreeze(tx, previousSeason, configFields);
                await tx.update(seasons).set(seasonConfig).where(eq(seasons.id, season_id));
                await writeAuditEvent(tx, event, {
                    action: "season.update",
                    entity_type: "season",
                    entity_id: season_id,
                    before: { status: previousSeason.status },
                    after: seasonConfig,
                });
                publishedSeasonId = season_id;
                return (
                    seasonConfig.results_published === 1 && previousSeason.results_published !== 1
                );
            });
        } else {
            // Database mode: one transaction covers the season row and the
            // global singleton in the same lock order activation uses.
            publishedResults = await db.transaction(async (tx) => {
                const previousSeason =
                    targetSeasonId === null
                        ? undefined
                        : await firstRow(
                              lockForUpdateIfSupported(
                                  tx
                                      .select()
                                      .from(seasons)
                                      .where(eq(seasons.id, targetSeasonId))
                                      .limit(1),
                              ),
                          );
                const previousLive = await firstRow(
                    lockForUpdateIfSupported(
                        tx.select().from(hackathon).where(eq(hackathon.id, 1)).limit(1),
                    ),
                );
                if (season_id !== undefined && !previousSeason) {
                    throw createError({ statusCode: 404, message: "Season not found" });
                }

                if (season_id !== undefined && activeSeason?.id !== season_id) {
                    await requireUser(event, NethackPermissions.Seasons.update);
                }

                const seasonConfig = previousSeason
                    ? await applyResultFreeze(tx, previousSeason, configFields)
                    : configFields;
                if (previousSeason) {
                    await tx
                        .update(seasons)
                        .set(seasonConfig)
                        .where(eq(seasons.id, previousSeason.id));
                }
                if (
                    previousLive &&
                    (previousSeason === undefined || previousSeason.is_active === 1)
                ) {
                    await tx.update(hackathon).set(seasonConfig).where(eq(hackathon.id, 1));
                }

                await writeAuditEvent(tx, event, {
                    action: "hackathon.update",
                    entity_type: "season",
                    entity_id: targetSeasonId ?? "live",
                    before: previousSeason
                        ? { results_published: previousSeason.results_published }
                        : null,
                    after: seasonConfig,
                });
                if (previousSeason) publishedSeasonId = previousSeason.id;
                return (
                    previousSeason !== undefined &&
                    seasonConfig.results_published === 1 &&
                    previousSeason.results_published !== 1
                );
            });
        }

        invalidateHackathonCache(event);
        invalidateEventStateCache(event);
        if (publishedResults && publishedSeasonId !== null) {
            await notifySeasonParticipants(event, publishedSeasonId, {
                type: "results_published",
                title: "Results are published",
                body: "The event results and score feedback are now available.",
                link: "/dashboard/results",
            });
        }

        const updated = await getHackathon(event);
        const allSeasons = await getSeasons(event);
        return { hackathon: updated, seasons: allSeasons };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
