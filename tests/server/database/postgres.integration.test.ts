import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDatabase, createDrizzleDatabase, type DrizzleDatabase } from "~~/server/database";
import { createAndMigrateDatabase } from "~~/server/database/migrate";
import {
    judgingDrafts,
    rubricVersions,
    seasons,
    teamScores,
    teams,
    users,
} from "~~/server/database/schema";

const enabled = process.env.BASISHACKS_POSTGRES_TEST === "1";
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled || !hasDatabaseUrl)("PostgreSQL integration", () => {
    let database: DrizzleDatabase | undefined;
    let createdTeamId: number | undefined;
    let createdUserId: number | undefined;

    beforeAll(async () => {
        database = await createDrizzleDatabase();
        await createAndMigrateDatabase(database);
    });

    afterAll(async () => {
        if (!database) return;
        if (createdTeamId !== undefined) {
            await database.delete(teams).where(eq(teams.id, createdTeamId));
        }
        if (createdUserId !== undefined) {
            await database.delete(users).where(eq(users.id, createdUserId));
        }
        await closeDatabase();
    });

    it("migrates PostgreSQL tables, stores rubric JSON, and enforces relationships", async () => {
        const db = database!;
        const activeSeason = (
            await db.select().from(seasons).where(eq(seasons.is_active, 1)).limit(1)
        )[0];
        expect(activeSeason).toBeDefined();
        expect(activeSeason?.rubric_version_id).toBeTypeOf("number");

        const activeRubric = (
            await db
                .select()
                .from(rubricVersions)
                .where(
                    and(
                        eq(rubricVersions.id, activeSeason!.rubric_version_id!),
                        eq(rubricVersions.season_id, activeSeason!.id),
                    ),
                )
                .limit(1)
        )[0];
        expect(activeRubric?.definition.tracks.junior?.criteria.length).toBeGreaterThan(0);

        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const [user] = await db
            .insert(users)
            .values({ email: `pg-integration-${suffix}@example.invalid`, name: "PG integration" })
            .returning();
        createdUserId = user!.id;

        const [team] = await db
            .insert(teams)
            .values({
                name: `PG integration ${suffix}`,
                pathway: "junior",
                season_id: activeSeason!.id,
                project_submitted: 1,
            })
            .returning();
        createdTeamId = team!.id;

        const track = activeRubric!.definition.tracks.junior!;
        const criterion = track.criteria[0]!;
        const draftScores = { [criterion.id]: criterion.maxScore };
        const [draft] = await db
            .insert(judgingDrafts)
            .values({
                team_id: team!.id,
                judge_user_id: user!.id,
                rubric_version_id: activeRubric!.id,
                scores: draftScores,
                reasoning: "A persisted PostgreSQL draft",
            })
            .returning();
        expect(draft?.scores).toEqual(draftScores);

        const finalScores = Object.fromEntries(
            track.criteria.map((item) => [item.id, item.maxScore]),
        );
        const [score] = await db
            .insert(teamScores)
            .values({
                team_id: team!.id,
                judge_user_id: user!.id,
                season_id: activeSeason!.id,
                rubric_version_id: activeRubric!.id,
                scores: JSON.stringify(finalScores),
                reasoning: "A persisted PostgreSQL score",
            })
            .returning();
        expect(score?.season_id).toBe(activeSeason!.id);

        await expect(
            db.insert(teamScores).values({
                team_id: team!.id,
                judge_user_id: user!.id,
                season_id: activeSeason!.id,
                rubric_version_id: activeRubric!.id,
                scores: JSON.stringify(finalScores),
                reasoning: "Duplicate judge score",
            }),
        ).rejects.toMatchObject({ cause: { code: "23505" } });

        await expect(
            db.insert(teamScores).values({
                team_id: team!.id,
                judge_user_id: -1,
                season_id: activeSeason!.id,
                rubric_version_id: activeRubric!.id,
                scores: JSON.stringify(finalScores),
                reasoning: "Must fail its user foreign key",
            }),
        ).rejects.toMatchObject({ cause: { code: "23503" } });
    });
});
