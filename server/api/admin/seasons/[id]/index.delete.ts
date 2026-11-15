import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { NethackPermissions } from "~~/shared/permissions";
import { PositiveIntParam } from "~~/shared/schemas";
import {
    judgingDrafts,
    rubricVersions,
    seasons,
    teamScores,
    teams,
} from "~~/server/database/schema";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { firstRow } from "~~/server/utils/database/query";

const SeasonIdParams = z.object({ id: PositiveIntParam });

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Seasons.delete);

        const { id } = await getValidatedRouterParams(event, SeasonIdParams.parse);

        const outcome = await event.context.drizzle.transaction(async (tx) => {
            const existing = await firstRow(
                tx.select().from(seasons).where(eq(seasons.id, id)).limit(1),
            );
            if (!existing) return "missing" as const;
            if (existing.is_active === 1) return "active" as const;

            const existingTeam = await firstRow(
                tx.select({ id: teams.id }).from(teams).where(eq(teams.season_id, id)).limit(1),
            );
            if (existingTeam) return "hasTeams" as const;

            const versions = await tx
                .select({ id: rubricVersions.id })
                .from(rubricVersions)
                .where(eq(rubricVersions.season_id, id));
            const versionIds = versions.map(({ id: versionId }) => versionId);
            if (versionIds.length > 0) {
                const scoreReference = await firstRow(
                    tx
                        .select({ team_id: teamScores.team_id })
                        .from(teamScores)
                        .where(inArray(teamScores.rubric_version_id, versionIds))
                        .limit(1),
                );
                const draftReference = await firstRow(
                    tx
                        .select({ team_id: judgingDrafts.team_id })
                        .from(judgingDrafts)
                        .where(inArray(judgingDrafts.rubric_version_id, versionIds))
                        .limit(1),
                );
                if (scoreReference || draftReference) return "hasHistory" as const;

                // Break the season-to-current-rubric pointer before removing
                // its immutable versions; published scores and drafts were
                // checked above and remain protected by restrictive FKs.
                await tx.update(seasons).set({ rubric_version_id: null }).where(eq(seasons.id, id));
                await tx.delete(rubricVersions).where(eq(rubricVersions.season_id, id));
            }

            await tx.delete(seasons).where(eq(seasons.id, id));
            return "deleted" as const;
        });

        if (outcome === "missing") {
            throw createError({
                statusCode: 404,
                message: "Season not found",
            });
        }
        if (outcome === "active") {
            throw createError({
                statusCode: 409,
                message: "The active season cannot be deleted.",
            });
        }
        if (outcome === "hasTeams" || outcome === "hasHistory") {
            throw createError({
                statusCode: 409,
                message: "This season contains team or judging history and cannot be deleted.",
            });
        }

        const allSeasons = await getSeasons(event);
        return { seasons: allSeasons };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
