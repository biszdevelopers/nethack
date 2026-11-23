import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
    resolve(import.meta.dirname, "../../drizzle/postgres/0016_event_readiness_hardening.sql"),
    "utf8",
);

describe("0016 event readiness migration", () => {
    it("adds the video, team-size, and invitation columns", () => {
        expect(sql).toContain('ALTER TABLE "teams" ADD COLUMN "project_video_url" text');
        expect(sql).toContain(
            'ALTER TABLE "seasons" ADD COLUMN "max_team_members" integer DEFAULT 6 NOT NULL',
        );
        expect(sql).toContain(
            '"seasons_max_team_members_check" CHECK ("seasons"."max_team_members" BETWEEN 1 AND 20)',
        );
        expect(sql).toContain('ALTER TABLE "team_invites" ADD COLUMN "token" text');
        expect(sql).toContain(
            'ALTER TABLE "team_invites" ADD COLUMN "expires_at" timestamp with time zone',
        );
        expect(sql).toContain(
            'CREATE UNIQUE INDEX "team_invites_token_unique" ON "team_invites" USING btree ("token")',
        );
    });

    it("gives pending pre-migration invitations a seven-day lifetime", () => {
        const backfill = sql.indexOf('UPDATE "team_invites"');
        const expiryColumn = sql.indexOf('ADD COLUMN "expires_at"');
        expect(expiryColumn).toBeGreaterThan(-1);
        expect(backfill).toBeGreaterThan(expiryColumn);
        expect(sql).toContain(`INTERVAL '7 days'`);
    });

    it("creates judge flags with a single open row per judge and team", () => {
        expect(sql).toContain('CREATE TABLE "judge_flags"');
        expect(sql).toContain(
            'CREATE UNIQUE INDEX "judge_flags_season_judge_team" ON "judge_flags" USING btree ("season_id","judge_user_id","team_id")',
        );
        expect(sql).toContain('"resolved_by" integer');
        expect(sql).not.toMatch(/DROP\s+TABLE/i);
    });
});
