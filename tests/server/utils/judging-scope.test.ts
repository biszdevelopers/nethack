import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    createTestContext,
    resetTestContext,
    seedSeason,
    type TestContext,
} from "~~/tests/api/helpers";
import { judgeAssignments, judgeRecusals, teams } from "~~/server/database/schema";
import {
    getJudgeScope,
    isJudgingOpen,
    judgeCanEvaluate,
    judgeScopeWhere,
    type JudgeScope,
} from "~~/server/utils/judging";

let ctx: TestContext;

beforeEach(async () => {
    ctx = await createTestContext();
    seedSeason(ctx);
});

afterEach(() => {
    resetTestContext(ctx);
});

function seedTeam(name: string, pathway: string | null, seasonId = 1) {
    return ctx.drizzle
        .insert(teams)
        .values({ name, pathway, season_id: seasonId, project_submitted: 1 })
        .returning()
        .get();
}

function scope(overrides: Partial<JudgeScope> = {}): JudgeScope {
    return {
        assigned: false,
        allProjects: false,
        teamIds: [],
        pathways: [],
        recusedTeamIds: [],
        ...overrides,
    };
}

describe("getJudgeScope", () => {
    it("returns an unlimited scope when the judge has no assignment rows", async () => {
        const result = await getJudgeScope(ctx.drizzle as any, 1, 7);

        expect(result).toEqual(scope());
    });

    it("collects team, pathway, and all-project assignments plus recusals", async () => {
        const first = seedTeam("First", "junior");
        const second = seedTeam("Second", "senior");
        ctx.drizzle
            .insert(judgeAssignments)
            .values([
                { season_id: 1, judge_user_id: 7, team_id: first.id },
                { season_id: 1, judge_user_id: 7, pathway: "senior" },
                { season_id: 1, judge_user_id: 7, team_id: null, pathway: null },
                { season_id: 1, judge_user_id: 8, pathway: "junior" },
            ] as any)
            .run();
        ctx.drizzle
            .insert(judgeRecusals)
            .values({ season_id: 1, judge_user_id: 7, team_id: second.id, reason: "Friend" })
            .run();

        const result = await getJudgeScope(ctx.drizzle as any, 1, 7);

        expect(result.assigned).toBe(true);
        expect(result.allProjects).toBe(true);
        expect(new Set(result.teamIds)).toEqual(new Set([first.id]));
        expect(result.pathways).toEqual(["senior"]);
        expect(result.recusedTeamIds).toEqual([second.id]);
        expect(result.teamIds).not.toContain(second.id);
    });
});

describe("judgeScopeWhere", () => {
    it("returns no filter when nothing narrows the scope", () => {
        expect(judgeScopeWhere(scope())).toBeUndefined();
        expect(judgeScopeWhere(scope({ assigned: true, allProjects: true }))).toBeUndefined();
    });

    it("matches nothing when an assignment exists without a team or pathway", async () => {
        seedTeam("Any Team", "junior");

        const rows = await ctx.drizzle
            .select()
            .from(teams)
            .where(judgeScopeWhere(scope({ assigned: true }))!);

        expect(rows).toEqual([]);
    });

    it("filters by assigned teams and pathways", async () => {
        const junior = seedTeam("Junior", "junior");
        const senior = seedTeam("Senior", "senior");
        const unassigned = seedTeam("Unassigned", null);

        const byTeam = await ctx.drizzle
            .select()
            .from(teams)
            .where(judgeScopeWhere(scope({ assigned: true, teamIds: [junior.id] }))!);
        expect(byTeam.map((row) => row.id)).toEqual([junior.id]);

        const byPathway = await ctx.drizzle
            .select()
            .from(teams)
            .where(judgeScopeWhere(scope({ assigned: true, pathways: ["senior"] }))!);
        expect(byPathway.map((row) => row.id)).toEqual([senior.id]);

        const combined = await ctx.drizzle
            .select()
            .from(teams)
            .where(
                judgeScopeWhere(
                    scope({ assigned: true, teamIds: [junior.id], pathways: ["senior"] }),
                )!,
            );
        expect(combined.map((row) => row.id).sort()).toEqual([junior.id, senior.id].sort());
        expect(combined.map((row) => row.id)).not.toContain(unassigned.id);
    });

    it("excludes recused teams from an otherwise open scope", async () => {
        const kept = seedTeam("Kept", "junior");
        const recused = seedTeam("Recused", "junior");

        const rows = await ctx.drizzle
            .select()
            .from(teams)
            .where(judgeScopeWhere(scope({ recusedTeamIds: [recused.id] }))!);

        expect(rows.map((row) => row.id)).toEqual([kept.id]);
    });
});

describe("isJudgingOpen after publication", () => {
    it("closes a finished, published season when the override flag is unset", () => {
        expect(
            isJudgingOpen(
                { status: "finished", judging_open: 1 } as Pick<
                    Hackathon,
                    "status" | "judging_open"
                >,
                { results_published_at: new Date() } as Pick<Season, "results_published_at">,
            ),
        ).toBe(false);
    });
});

describe("judgeCanEvaluate", () => {
    it("always rejects a recused team", () => {
        expect(
            judgeCanEvaluate(scope({ assigned: true, allProjects: true, recusedTeamIds: [1] }), {
                id: 1,
                pathway: "junior",
            } as Team),
        ).toBe(false);
    });

    it("allows every team for an unassigned judge", () => {
        expect(judgeCanEvaluate(scope(), { id: 1, pathway: null } as Team)).toBe(true);
    });

    it("allows every team for an all-project assignment", () => {
        expect(
            judgeCanEvaluate(scope({ assigned: true, allProjects: true }), {
                id: 2,
                pathway: "senior",
            } as Team),
        ).toBe(true);
    });

    it("matches an assigned team, an assigned pathway, or a null-pathway team", () => {
        const assigned = scope({ assigned: true, teamIds: [3], pathways: ["senior"] });

        expect(judgeCanEvaluate(assigned, { id: 3, pathway: "junior" } as Team)).toBe(true);
        expect(judgeCanEvaluate(assigned, { id: 4, pathway: "senior" } as Team)).toBe(true);
        expect(judgeCanEvaluate(assigned, { id: 5, pathway: "junior" } as Team)).toBe(false);
        expect(judgeCanEvaluate(assigned, { id: 6, pathway: null } as Team)).toBe(false);
    });
});
