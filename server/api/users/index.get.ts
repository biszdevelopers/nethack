import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { NethackPermissions } from "~~/shared/permissions";
import { isInitialAdminEmail } from "~~/server/utils/initial-admins";
import { userPastTeams, users } from "~~/server/database/schema";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Users.list);

        const [results, pastTeams] = await Promise.all([
            event.context.drizzle
                .select({
                    id: users.id,
                    email: users.email,
                    name: users.name,
                    team_id: users.team_id,
                    profile_theme: users.profile_theme,
                    profile_picture: users.profile_picture,
                    is_admin: users.is_admin,
                })
                .from(users)
                .orderBy(users.id),
            event.context.drizzle.select().from(userPastTeams),
        ]);

        const pastTeamIdsByUser = new Map<number, number[]>();
        for (const membership of pastTeams) {
            const ids = pastTeamIdsByUser.get(membership.user_id) ?? [];
            ids.push(membership.team_id);
            pastTeamIdsByUser.set(membership.user_id, ids);
        }

        return results.map((user) => ({
            ...convertUserToPublic(user as User),
            is_admin: Boolean(user.is_admin),
            is_initial_admin: isInitialAdminEmail(user.email),
            past_team_ids: pastTeamIdsByUser.get(user.id)?.join(",") ?? null,
        }));
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
