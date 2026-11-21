import type { H3Event } from "h3";
import { and, desc, eq, isNotNull, isNull, type SQL } from "drizzle-orm";
import { judgeFlags, teams, users } from "~~/server/database/schema";
import type { DrizzleDatabase } from "~~/server/database";
import { firstRow } from "./query";
import { writeAuditEvent } from "~~/server/utils/audit";
import { createNotification } from "~~/server/utils/notifications";

type FlagDatabase = Pick<DrizzleDatabase, "select" | "insert" | "update">;

export interface JudgeFlagRecord {
    id: number;
    season_id: number;
    team_id: number;
    judge_user_id: number;
    reason: string;
    resolved_at: Date | null;
    resolved_by: number | null;
    created_at: Date;
}

/**
 * Record or reopen a judge's conflict-of-interest flag. One row exists per
 * (season, judge, team), so re-flagging refreshes the reason and reopens it.
 */
export async function upsertJudgeFlag(
    event: H3Event,
    input: { seasonId: number; teamId: number; judgeUserId: number; reason: string },
): Promise<JudgeFlagRecord> {
    return event.context.drizzle.transaction(async (tx) => {
        const flag = (await firstRow(
            tx
                .insert(judgeFlags)
                .values({
                    season_id: input.seasonId,
                    team_id: input.teamId,
                    judge_user_id: input.judgeUserId,
                    reason: input.reason,
                    created_at: new Date(),
                })
                .onConflictDoUpdate({
                    target: [judgeFlags.season_id, judgeFlags.judge_user_id, judgeFlags.team_id],
                    set: {
                        reason: input.reason,
                        resolved_at: null,
                        resolved_by: null,
                        created_at: new Date(),
                    },
                })
                .returning(),
        )) as JudgeFlagRecord | undefined;
        if (!flag) {
            throw createError({ statusCode: 500, message: "Could not record the flag" });
        }

        await writeAuditEvent(tx, event, {
            action: "judging.flag",
            entity_type: "team",
            entity_id: input.teamId,
            after: { judge_user_id: input.judgeUserId, reason: input.reason },
        });

        const admins = await tx.select({ id: users.id }).from(users).where(eq(users.is_admin, 1));
        await Promise.all(
            admins.map((admin) =>
                createNotification(tx, admin.id, {
                    type: "judge_flag",
                    title: "A judge flagged a project conflict",
                    body: input.reason,
                    link: "/developers/judging",
                }),
            ),
        );

        return flag;
    });
}

/** Resolve one flag. Administrators call this from the flag queue. */
export async function resolveJudgeFlag(
    event: H3Event,
    flagID: number,
    resolvedBy: number,
): Promise<void> {
    const changed = await event.context.drizzle
        .update(judgeFlags)
        .set({ resolved_at: new Date(), resolved_by: resolvedBy })
        .where(and(eq(judgeFlags.id, flagID), isNull(judgeFlags.resolved_at)))
        .returning({ id: judgeFlags.id });
    if (changed.length === 0) {
        throw createError({ statusCode: 404, message: "Open flag not found" });
    }
    await writeAuditEvent(event.context.drizzle, event, {
        action: "judging.flag_resolved",
        entity_type: "judge_flag",
        entity_id: flagID,
        after: { resolved_by: resolvedBy },
    });
}

/** List flags for the administration queue, newest first. */
export async function getJudgeFlags(
    db: FlagDatabase,
    options: { seasonId?: number; resolved?: boolean } = {},
) {
    const filters: SQL[] = [];
    if (options.seasonId !== undefined) {
        filters.push(eq(judgeFlags.season_id, options.seasonId));
    }
    if (options.resolved !== undefined) {
        filters.push(
            options.resolved ? isNotNull(judgeFlags.resolved_at) : isNull(judgeFlags.resolved_at),
        );
    }

    return db
        .select({
            id: judgeFlags.id,
            season_id: judgeFlags.season_id,
            team_id: judgeFlags.team_id,
            team_name: teams.name,
            judge_user_id: judgeFlags.judge_user_id,
            judge_email: users.email,
            judge_name: users.name,
            reason: judgeFlags.reason,
            resolved_at: judgeFlags.resolved_at,
            resolved_by: judgeFlags.resolved_by,
            created_at: judgeFlags.created_at,
        })
        .from(judgeFlags)
        .innerJoin(teams, eq(teams.id, judgeFlags.team_id))
        .innerJoin(users, eq(users.id, judgeFlags.judge_user_id))
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(judgeFlags.created_at));
}
