import { NethackPermissions } from "~~/shared/permissions";
import { AdminSeasonQuery } from "~~/shared/schemas";
import { getActiveSeason, getSeasonById } from "~~/server/utils/database/seasons";
import { getAwardsForTeams } from "~~/server/utils/database/awards";
import { calculateSeasonScoresWithDatabase } from "~~/server/utils/scoring";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

function csvCell(value: unknown): string {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.all);
        const query = await getValidatedQuery(event, AdminSeasonQuery.parse);
        const season = query.season_id
            ? await getSeasonById(event, query.season_id)
            : await getActiveSeason(event);
        if (!season) throw createError({ statusCode: 404, message: "Season not found" });

        const standings = await calculateSeasonScoresWithDatabase(
            event.context.drizzle,
            season.id,
            false,
        );
        const awards = await getAwardsForTeams(
            event,
            standings.map((team) => team.id),
        );

        const header = [
            "team_id",
            "team",
            "pathway",
            "status",
            "score_exact",
            "score",
            "rank",
            "awards",
            "project_name",
            "demo_url",
            "repo_url",
        ];
        const rows = standings.map((team) =>
            [
                team.id,
                team.name,
                team.pathway,
                team.status,
                Number(team.score_exact.toFixed(4)),
                team.score,
                team.rank,
                (awards[team.id] ?? []).map((award) => award.name).join("; "),
                team.project_name,
                team.project_demo_url,
                team.project_repo_url,
            ]
                .map(csvCell)
                .join(","),
        );

        setResponseHeader(event, "content-type", "text/csv; charset=utf-8");
        setResponseHeader(
            event,
            "content-disposition",
            `attachment; filename="standings-season-${season.id}.csv"`,
        );
        return [header.join(","), ...rows].join("\n") + "\n";
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
