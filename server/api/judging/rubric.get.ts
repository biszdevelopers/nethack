import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { eq } from "drizzle-orm";
import { NethackPermissions } from "~~/shared/permissions";
import { getActiveSeason } from "~~/server/utils/database/seasons";
import { rubricVersions } from "~~/server/database/schema";
import { firstRow } from "~~/server/utils/database/query";
import { resolveJudgeCommentGuidance } from "~~/shared/judge-comments";
import { resolveLiveRubricVersionId } from "~~/server/utils/database/rubrics";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Judging.assignmentsRead);
        const season = await getActiveSeason(event);
        const versionId = season && (await resolveLiveRubricVersionId(event, season));
        if (!season || !versionId) {
            throw createError({
                statusCode: 409,
                message: "The active season does not have a rubric.",
            });
        }

        const version = await firstRow(
            event.context.drizzle
                .select()
                .from(rubricVersions)
                .where(eq(rubricVersions.id, versionId))
                .limit(1),
        );
        if (!version || version.season_id !== season.id) {
            throw createError({
                statusCode: 409,
                message: "The active season rubric is unavailable.",
            });
        }

        return {
            version_id: version.id,
            name: version.name,
            tracks: version.definition.tracks,
            commentGuidance: resolveJudgeCommentGuidance(version.definition.commentGuidance),
        };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
