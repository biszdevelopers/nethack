import type { H3Event } from "h3";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DrizzleDatabase } from "~~/server/database";
import { notifications, teams, users } from "~~/server/database/schema";
import { firstRow } from "~~/server/utils/database/query";
import { isNotificationsEnabled } from "~~/server/utils/event-state";

export interface NotificationInput {
    type: string;
    title: string;
    body?: string | null;
    link?: string | null;
}

type NotificationDatabase = Pick<DrizzleDatabase, "select" | "insert">;

/** Optional operator-configured webhook; fire-and-forget and HTTPS-only. */
function notifyWebhook(input: NotificationInput): void {
    const raw = process.env.NOTIFICATION_WEBHOOK_URL?.trim();
    if (!raw) return;
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return;
    }
    if (url.protocol !== "https:" || url.username || url.password) return;
    void fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            type: input.type,
            title: input.title,
            body: input.body ?? null,
            link: input.link ?? null,
        }),
        signal: AbortSignal.timeout(3000),
    }).catch(() => undefined);
}

export async function createNotification(
    db: NotificationDatabase,
    userId: number,
    input: NotificationInput,
): Promise<void> {
    if (!isNotificationsEnabled()) return;
    await db.insert(notifications).values({
        user_id: userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        created_at: new Date(),
    });
    notifyWebhook(input);
}

/** Deliver an invitation notice to an existing account with that email. */
export async function notifyUserByEmail(
    event: H3Event,
    input: NotificationInput & { email: string },
): Promise<void> {
    const target = await firstRow(
        event.context.drizzle
            .select({ id: users.id })
            .from(users)
            .where(eq(sql`lower(${users.email})`, input.email.trim().toLowerCase()))
            .limit(1),
    );
    if (!target) return;
    await createNotification(event.context.drizzle, target.id, input);
}

/** Notify the account that owns a team, falling back to its earliest member. */
export async function notifyTeamOwner(
    event: H3Event,
    team: Pick<Team, "id" | "owner_user_id">,
    input: NotificationInput,
): Promise<void> {
    if (team.owner_user_id) {
        await createNotification(event.context.drizzle, team.owner_user_id, input);
        return;
    }
    const owner = await firstRow(
        event.context.drizzle
            .select({ id: users.id })
            .from(users)
            .where(eq(users.team_id, team.id))
            .orderBy(asc(users.id))
            .limit(1),
    );
    if (owner) await createNotification(event.context.drizzle, owner.id, input);
}

/** Notify every current member of a season's submitted teams. */
export async function notifySeasonParticipants(
    event: H3Event,
    seasonId: number,
    input: NotificationInput,
): Promise<number> {
    if (!isNotificationsEnabled()) return 0;
    const rows = await event.context.drizzle
        .select({ id: users.id })
        .from(users)
        .innerJoin(teams, eq(users.team_id, teams.id))
        .where(and(eq(teams.season_id, seasonId), eq(teams.project_submitted, 1)));

    const ids = [...new Set(rows.map((row) => row.id))];
    for (let offset = 0; offset < ids.length; offset += 250) {
        const chunk = ids.slice(offset, offset + 250);
        if (chunk.length === 0) continue;
        await event.context.drizzle.insert(notifications).values(
            chunk.map((userId) => ({
                user_id: userId,
                type: input.type,
                title: input.title,
                body: input.body ?? null,
                link: input.link ?? null,
                created_at: new Date(),
            })),
        );
    }
    // One announcement reaches many recipients; dispatch the webhook once
    // instead of once per member.
    if (ids.length > 0) notifyWebhook(input);
    return ids.length;
}

/** Remove all notifications addressed to the users being deleted. */
export async function deleteNotificationsForUsers(
    db: Pick<DrizzleDatabase, "delete">,
    userIds: number[],
): Promise<void> {
    if (userIds.length === 0) return;
    await db.delete(notifications).where(inArray(notifications.user_id, userIds));
}
