import type { H3Event } from "h3";
import { and, eq, inArray } from "drizzle-orm";
import { awards, teamAwards } from "~~/server/database/schema";
import { firstRow } from "./query";

export interface ResolvedAward {
    team_id: number;
    namespace: string;
    name: string;
    description: string;
    icon: string;
    meta: Record<string, unknown>;
    color: string;
    text: string;
}

function parseMeta(meta: string | null): Record<string, unknown> {
    if (!meta) return {};
    try {
        return JSON.parse(meta) as Record<string, unknown>;
    } catch {
        return {};
    }
}

function resolveAward(row: {
    team_id: number;
    namespace: string;
    name: string;
    description: string;
    icon: string;
    color: string;
    meta: string | null;
}): ResolvedAward {
    const meta = parseMeta(row.meta);

    return {
        team_id: row.team_id,
        namespace: row.namespace,
        name: row.name,
        description: row.description,
        icon: row.icon,
        meta,
        color: row.color,
        text: row.description,
    };
}

export async function getAwards(event: H3Event, teamId: number): Promise<ResolvedAward[]> {
    const rows = await event.context.drizzle
        .select({
            team_id: teamAwards.team_id,
            namespace: awards.namespace,
            name: awards.name,
            description: awards.description,
            icon: awards.icon,
            color: awards.color,
            meta: teamAwards.meta,
        })
        .from(teamAwards)
        .innerJoin(awards, eq(teamAwards.award, awards.namespace))
        .where(eq(teamAwards.team_id, teamId));

    return rows.map(resolveAward);
}

export async function getAwardsForTeams(
    event: H3Event,
    teamIds: number[],
): Promise<Record<number, ResolvedAward[]>> {
    if (teamIds.length === 0) return {};

    const rows = await event.context.drizzle
        .select({
            team_id: teamAwards.team_id,
            namespace: awards.namespace,
            name: awards.name,
            description: awards.description,
            icon: awards.icon,
            color: awards.color,
            meta: teamAwards.meta,
        })
        .from(teamAwards)
        .innerJoin(awards, eq(teamAwards.award, awards.namespace))
        .where(inArray(teamAwards.team_id, teamIds));

    const result: Record<number, ResolvedAward[]> = {};
    for (const row of rows) {
        const award = resolveAward(row);
        if (!result[row.team_id]) result[row.team_id] = [];
        result[row.team_id]!.push(award);
    }

    return result;
}

export async function createAward(
    event: H3Event,
    teamId: number,
    award: string,
    meta?: string,
): Promise<TeamAward> {
    const row = (await firstRow(
        event.context.drizzle
            .insert(teamAwards)
            .values({ team_id: teamId, award, meta: meta ?? "{}" })
            .returning(),
    ))!;

    return row as TeamAward;
}

export async function deleteTeamAwards(event: H3Event, teamId: number) {
    await event.context.drizzle.delete(teamAwards).where(eq(teamAwards.team_id, teamId));
}

export async function deleteAward(event: H3Event, teamId: number, award: string) {
    await event.context.drizzle
        .delete(teamAwards)
        .where(and(eq(teamAwards.team_id, teamId), eq(teamAwards.award, award)));
}
