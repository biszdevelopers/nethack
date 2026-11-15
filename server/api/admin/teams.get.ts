import { NethackPermissions } from "~~/shared/permissions";
import { teams, seasons, users } from "~~/server/database/schema";
import { eq, isNotNull, sql } from "drizzle-orm";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Teams.list);

        const results = await event.context.drizzle
            .select({
                id: teams.id,
                name: teams.name,
                pathway: teams.pathway,
                score: teams.score,
                rank: teams.rank,
                project_name: teams.project_name,
                project_description: teams.project_description,
                project_demo_url: teams.project_demo_url,
                project_repo_url: teams.project_repo_url,
                project_submitted: teams.project_submitted,
                sourcing: teams.sourcing,
                season_id: teams.season_id,
                season_name: sql<string | null>`${seasons.name}`.as("season_name"),
            })
            .from(teams)
            .leftJoin(seasons, eq(teams.season_id, seasons.id))
            .orderBy(teams.id);

        const memberRows = await event.context.drizzle
            .select({
                id: users.id,
                name: users.name,
                email: users.email,
                profile_picture: users.profile_picture,
                team_id: users.team_id,
            })
            .from(users)
            .where(isNotNull(users.team_id))
            .orderBy(users.id);

        const membersByTeam = new Map<
            number,
            { id: number; name: string | null; email: string; profile_picture: string | null }[]
        >();
        for (const row of memberRows) {
            const list = membersByTeam.get(row.team_id!) ?? [];
            list.push({
                id: row.id,
                name: row.name,
                email: row.email,
                profile_picture: row.profile_picture,
            });
            membersByTeam.set(row.team_id!, list);
        }

        return results.map((team) => ({
            ...team,
            members: membersByTeam.get(team.id) ?? [],
        }));
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
