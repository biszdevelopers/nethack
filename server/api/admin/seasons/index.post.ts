import { NethackPermissions } from "~~/shared/permissions";
import { CreateSeasonRequest } from "~~/shared/schemas";
import { rubricVersions, seasons } from "~~/server/database/schema";
import { eq } from "drizzle-orm";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { getActiveSeason, setActiveSeason } from "~~/server/utils/database/seasons";
import { getRubricVersionForSeason } from "~~/server/utils/database/rubrics";
import { isUniqueViolation } from "~~/server/utils/database/query";
import { writeAuditEvent } from "~~/server/utils/audit";

/** Settings a fresh season inherits; operational switches never carry over. */
function pickScheduleAndTheme(source: Season): Record<string, unknown> {
    const values: Record<string, unknown> = {
        schedule_start: source.schedule_start,
        schedule_end: source.schedule_end,
        start_timestamp: source.start_timestamp,
        end_timestamp: source.end_timestamp,
        voting_start_timestamp: source.voting_start_timestamp,
        voting_end_timestamp: source.voting_end_timestamp,
        results_open_timestamp: source.results_open_timestamp,
        theme_name: source.theme_name,
        theme_description: source.theme_description,
    };
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Seasons.create);

        const body = await readValidatedBody(event, CreateSeasonRequest.parse);
        const copyLiveSettings = body.copy_live_settings !== false;
        const isActive = body.is_active ?? 0;

        if (isActive === 1 && !copyLiveSettings) {
            throw createError({
                statusCode: 409,
                message: "A blank-start season must be configured and approved before activation.",
            });
        }

        if (isActive === 1) {
            await requireUser(event, NethackPermissions.Seasons.activate);
        }

        const active = copyLiveSettings ? await getActiveSeason(event) : null;
        const rubric = active ? await getRubricVersionForSeason(event, active.id) : null;
        const seed: Record<string, unknown> =
            copyLiveSettings && active ? pickScheduleAndTheme(active) : {};

        const created = await (async () => {
            const work = async (tx: typeof event.context.drizzle) => {
                let row: { id: number } | undefined;
                try {
                    [row] = await tx
                        .insert(seasons)
                        .values({
                            ...seed,
                            name: body.name,
                            // A new row cannot be inserted as active while the current
                            // season is protected by the one-active-season constraint.
                            is_active: 0,
                            is_blank_start: copyLiveSettings ? 0 : 1,
                            status: "not_started",
                            voting_enabled: 0,
                            results_published: 0,
                            results_published_at: null,
                            results_snapshot: null,
                            show_scores: 0,
                            show_ranking: 0,
                            judging_open: 0,
                            max_votes_per_user: 0,
                            announcement: null,
                            score_curve_preset: "original",
                        } as typeof seasons.$inferInsert)
                        .returning({ id: seasons.id });
                } catch (error) {
                    if (isUniqueViolation(error)) {
                        throw createError({
                            statusCode: 409,
                            message: "A season with that name already exists",
                        });
                    }
                    throw error;
                }

                if (!row) return undefined;
                if (rubric) {
                    // Copy the immutable definition into this season's own version.
                    // Scores can never point across seasons.
                    const [version] = await tx
                        .insert(rubricVersions)
                        .values({
                            season_id: row.id,
                            version: 1,
                            name: rubric.name,
                            definition: rubric.definition,
                            source_template_id: rubric.source_template_id,
                            created_at: new Date(),
                        })
                        .returning({ id: rubricVersions.id });
                    await tx
                        .update(seasons)
                        .set({ rubric_version_id: version!.id })
                        .where(eq(seasons.id, row.id));
                }

                await writeAuditEvent(tx, event, {
                    action: "season.create",
                    entity_type: "season",
                    entity_id: row.id,
                    after: {
                        name: body.name,
                        copied_schedule: copyLiveSettings,
                        rubric_copied: !!rubric,
                    },
                });
                return row;
            };
            return typeof event.context.drizzle.transaction === "function"
                ? event.context.drizzle.transaction(work)
                : work(event.context.drizzle);
        })();

        if (isActive === 1 && created) {
            try {
                await setActiveSeason(event, created.id);
            } catch (error) {
                // Do not leave a stray season behind when activation fails.
                try {
                    await event.context.drizzle.delete(seasons).where(eq(seasons.id, created.id));
                } catch {
                    // Preserve the original activation failure.
                }
                throw error;
            }
        }

        const allSeasons = await getSeasons(event);
        return { seasons: allSeasons };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
