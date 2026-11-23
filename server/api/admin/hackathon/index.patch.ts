import { NethackPermissions } from "~~/shared/permissions";
import { AdminUpdateHackathonRequest } from "~~/shared/schemas";
import { hackathon, seasons } from "~~/server/database/schema";
import { eq } from "drizzle-orm";
import {
    invalidateHackathonCache,
    mergeLiveOverrides,
    pickDivergingLiveOverrides,
} from "~~/server/utils/database/hackathon";
import { firstRow, lockForUpdateIfSupported } from "~~/server/utils/database/query";
import { getSeasons } from "~~/server/utils/database/seasons";
import { calculateSeasonScoresWithDatabase } from "~~/server/utils/scoring";
import { writeAuditEvent } from "~~/server/utils/audit";
import { invalidateEventStateCache } from "~~/server/utils/event-state";
import { notifySeasonParticipants } from "~~/server/utils/notifications";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { hackathonUsesYaml, readHackathonConfig } from "~~/server/utils/hackathon-config";

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
    baseline: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
    const effective = { ...season, ...baseline, ...config };
    const scheduleKeys = [
        "start_timestamp",
        "end_timestamp",
        "voting_start_timestamp",
        "voting_end_timestamp",
        "results_open_timestamp",
    ];
    const touchesSchedule = scheduleKeys.some((key) => Object.hasOwn(config, key));
    const start = Number(effective.start_timestamp);
    const end = Number(effective.end_timestamp);
    const votingStart = Number(effective.voting_start_timestamp);
    const votingEnd = Number(effective.voting_end_timestamp);
    const resultsOpen = Number(effective.results_open_timestamp);
    if (touchesSchedule && start > 0 && end > 0 && end <= start) {
        throw createError({
            statusCode: 400,
            message: "The event must end after it starts.",
        });
    }
    if (touchesSchedule && votingStart > 0 && votingEnd > 0 && votingEnd <= votingStart) {
        throw createError({
            statusCode: 400,
            message: "Voting must end after voting starts.",
        });
    }
    if (touchesSchedule && votingEnd > 0 && resultsOpen > 0 && resultsOpen < votingEnd) {
        throw createError({
            statusCode: 400,
            message: "Results must open after voting closes.",
        });
    }

    if (config.results_published === 0 && season.results_published === 1) {
        return {
            ...config,
            results_published_at: null,
            results_snapshot: null,
        };
    }

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
            const manifest = await readManifestSettings();
            await db.transaction(async (tx) => {
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
                    ? await applyResultFreeze(tx, previousSeason, configFields, {
                          ...(manifest ?? {}),
                          ...mergeLiveOverrides(previousLive.live_overrides ?? {}, {}),
                      })
                    : configFields;
                if (
                    previousSeason &&
                    seasonConfig.results_published === 1 &&
                    previousSeason.results_published !== 1
                ) {
                    publishedResults = true;
                    publishedSeasonId = previousSeason.id;
                }

                // Every editable setting is a PostgreSQL live override. The
                // manifest is a seed and comparison source only; the portal
                // never writes it, so schedule and theme edits apply instantly.
                // Use the frozen config so publication also closes judging and
                // voting in the overrides the YAML read path actually applies.
                const overrides = divergingOverrides(
                    manifest,
                    seasonConfig,
                    previousLive.live_overrides ?? {},
                );
                const hackathonConfig = Object.fromEntries(
                    Object.entries(seasonConfig).filter(
                        ([key]) => key !== "results_published_at" && key !== "results_snapshot",
                    ),
                );

                // The active season may have changed while the manifest was
                // being read. Never write the old season's settings into the
                // live overrides; an explicit inactive target only updates its
                // own row.
                const targetStillLive = previousSeason
                    ? previousSeason.is_active === 1
                    : season_id === undefined;
                if (!targetStillLive && season_id === undefined) {
                    throw createError({
                        statusCode: 409,
                        message: "The active season changed. Reload and try again.",
                    });
                }

                if (previousSeason) {
                    await tx
                        .update(seasons)
                        .set(seasonConfig)
                        .where(eq(seasons.id, previousSeason.id));
                }
                if (targetStillLive) {
                    await tx
                        .update(hackathon)
                        .set({ ...hackathonConfig, live_overrides: overrides })
                        .where(eq(hackathon.id, 1));
                }

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
            });
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
            try {
                await notifySeasonParticipants(event, publishedSeasonId, {
                    type: "results_published",
                    title: "Results are published",
                    body: "The event results and score feedback are now available.",
                    link: "/dashboard/results",
                });
            } catch (error) {
                // Publication is already committed; a notification failure must
                // not make the organizer retry a completed publication.
                console.error("results notification failed", error);
            }
        }

        const updated = await getHackathon(event);
        const allSeasons = await getSeasons(event);
        return { hackathon: updated, seasons: allSeasons };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
