import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";
import { NethackPermissions } from "~~/shared/permissions";
import { users } from "~~/server/database/schema";

export default defineEventHandler(
    applyRateLimit(async (event) => {
        await requireUser(event, NethackPermissions.Users.list);

        const results = await event.context.drizzle
            .select({
                id: users.id,
                email: users.email,
                name: users.name,
                team_id: users.team_id,
                profile_theme: users.profile_theme,
                profile_picture: users.profile_picture,
            })
            .from(users)
            .orderBy(users.id);

        return results.map((user) => convertUserToPublic(user as User)) satisfies APIUser[];
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
