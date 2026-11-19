import { describe, it, expect, beforeEach } from "vitest";
import { createMockEvent } from "./helpers";
import {
    getHackathon,
    invalidateHackathonCache,
    updateHackathon,
} from "~~/server/utils/database/hackathon";

describe("hackathon database helpers", () => {
    let event: Awaited<ReturnType<typeof createMockEvent>>;

    beforeEach(async () => {
        event = await createMockEvent();
    });

    describe("getHackathon", () => {
        it("returns the hackathon row when one exists", async () => {
            event.context.drizzle
                .prepare(
                    "INSERT INTO hackathon(id, status, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'in_progress', 100, 200, 300, 400, 500)",
                )
                .run();

            const hackathon = await getHackathon(event);
            expect(hackathon).not.toBeNull();
            expect(hackathon!.id).toBe(1);
            expect(hackathon!.status).toBe("in_progress");
            expect(hackathon!.start_timestamp).toBe(100);
            expect(hackathon!.end_timestamp).toBe(200);
        });

        it("returns null when no hackathon row exists", async () => {
            const hackathon = await getHackathon(event);
            expect(hackathon).toBeNull();
        });

        it("reuses the merged state within a request and refreshes after invalidation", async () => {
            event.context.drizzle
                .prepare(
                    "INSERT INTO hackathon(id, status, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'in_progress', 0, 0, 0, 0, 0)",
                )
                .run();

            const first = await getHackathon(event);
            event.context.drizzle
                .prepare("UPDATE hackathon SET status = 'finished' WHERE id = 1")
                .run();

            expect(await getHackathon(event)).toBe(first);
            invalidateHackathonCache(event);
            expect((await getHackathon(event))!.status).toBe("finished");
        });

        it("returns the correct status when set to not_started", async () => {
            event.context.drizzle
                .prepare(
                    "INSERT INTO hackathon(id, status, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'not_started', 0, 0, 0, 0, 0)",
                )
                .run();

            const hackathon = await getHackathon(event);
            expect(hackathon!.status).toBe("not_started");
        });

        it("returns the correct status when set to voting", async () => {
            event.context.drizzle
                .prepare(
                    "INSERT INTO hackathon(id, status, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'voting', 0, 0, 0, 0, 0)",
                )
                .run();

            const hackathon = await getHackathon(event);
            expect(hackathon!.status).toBe("voting");
        });

        it("returns the correct status when set to finished", async () => {
            event.context.drizzle
                .prepare(
                    "INSERT INTO hackathon(id, status, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'finished', 0, 0, 0, 0, 0)",
                )
                .run();

            const hackathon = await getHackathon(event);
            expect(hackathon!.status).toBe("finished");
        });

        it("returns the correct status when set to paused", async () => {
            event.context.drizzle
                .prepare(
                    "INSERT INTO hackathon(id, status, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'paused', 0, 0, 0, 0, 0)",
                )
                .run();

            const hackathon = await getHackathon(event);
            expect(hackathon!.status).toBe("paused");
        });

        it("returns all explicit timestamp fields correctly", async () => {
            event.context.drizzle
                .prepare(
                    "INSERT INTO hackathon(id, status, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'in_progress', 1000, 2000, 3000, 4000, 5000)",
                )
                .run();

            const h = await getHackathon(event);
            expect(h!.start_timestamp).toBe(1000);
            expect(h!.end_timestamp).toBe(2000);
            expect(h!.voting_start_timestamp).toBe(3000);
            expect(h!.voting_end_timestamp).toBe(4000);
            expect(h!.results_open_timestamp).toBe(5000);
        });

        it("returns the voting_enabled field", async () => {
            event.context.drizzle
                .prepare(
                    "INSERT INTO hackathon(id, status, voting_enabled, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'in_progress', 1, 0, 0, 0, 0, 0)",
                )
                .run();

            const h = await getHackathon(event);
            expect(h!.voting_enabled).toBe(1);
        });

        it("returns the results_published field", async () => {
            event.context.drizzle
                .prepare(
                    "INSERT INTO hackathon(id, status, results_published, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'finished', 1, 0, 0, 0, 0, 0)",
                )
                .run();

            const h = await getHackathon(event);
            expect(h!.results_published).toBe(1);
        });

        it("returns the submitted_count field", async () => {
            event.context.drizzle
                .prepare(
                    "INSERT INTO hackathon(id, status, submitted_count, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'in_progress', 5, 0, 0, 0, 0, 0)",
                )
                .run();

            const h = await getHackathon(event);
            expect(h!.submitted_count).toBe(5);
        });

        it("returns the max_votes_per_user field", async () => {
            event.context.drizzle
                .prepare(
                    "INSERT INTO hackathon(id, status, max_votes_per_user, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'voting', 3, 0, 0, 0, 0, 0)",
                )
                .run();

            const h = await getHackathon(event);
            expect(h!.max_votes_per_user).toBe(3);
        });

        it("returns the judging_open field", async () => {
            event.context.drizzle
                .prepare(
                    "INSERT INTO hackathon(id, status, judging_open, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'in_progress', 1, 0, 0, 0, 0, 0)",
                )
                .run();

            const h = await getHackathon(event);
            expect(h!.judging_open).toBe(1);
        });

        it("returns the schedule_start and schedule_end fields", async () => {
            event.context.drizzle
                .prepare(
                    "INSERT INTO hackathon(id, status, schedule_start, schedule_end, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'in_progress', '2025-01-01', '2025-12-31', 0, 0, 0, 0, 0)",
                )
                .run();

            const h = await getHackathon(event);
            expect(h!.schedule_start).toBe("2025-01-01");
            expect(h!.schedule_end).toBe("2025-12-31");
        });

        it("returns the theme_name and theme_description fields", async () => {
            event.context.drizzle
                .prepare(
                    "INSERT INTO hackathon(id, status, theme_name, theme_description, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'in_progress', 'Theme', 'Description', 0, 0, 0, 0, 0)",
                )
                .run();

            const h = await getHackathon(event);
            expect(h!.theme_name).toBe("Theme");
            expect(h!.theme_description).toBe("Description");
        });

        it("always returns id as 1", async () => {
            event.context.drizzle
                .prepare(
                    "INSERT INTO hackathon(id, status, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'not_started', 0, 0, 0, 0, 0)",
                )
                .run();

            const h = await getHackathon(event);
            expect(h!.id).toBe(1);
        });

        it("returns the same data on multiple calls", async () => {
            event.context.drizzle
                .prepare(
                    "INSERT INTO hackathon(id, status, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'in_progress', 100, 200, 300, 400, 500)",
                )
                .run();

            const h1 = await getHackathon(event);
            const h2 = await getHackathon(event);
            expect(h1).toEqual(h2);
        });
    });

    describe("updateHackathon", () => {
        function seedRow() {
            event.context.drizzle
                .prepare(
                    "INSERT INTO hackathon(id, status, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES(1, 'in_progress', 100, 200, 300, 400, 500)",
                )
                .run();
        }

        it("updates the given fields and returns the updated row", async () => {
            seedRow();

            const updated = await updateHackathon(event, {
                status: "voting",
                show_scores: 1,
                show_ranking: 1,
                theme_name: "Theme",
            });

            expect(updated).not.toBeNull();
            expect(updated!.status).toBe("voting");
            expect(updated!.show_scores).toBe(1);
            expect(updated!.show_ranking).toBe(1);
            expect(updated!.theme_name).toBe("Theme");
        });

        it("leaves other fields untouched", async () => {
            seedRow();

            const updated = await updateHackathon(event, { show_scores: 1 });

            expect(updated!.status).toBe("in_progress");
            expect(updated!.start_timestamp).toBe(100);
            expect(updated!.show_ranking).toBe(0);
        });

        it("returns null when no hackathon row exists", async () => {
            const updated = await updateHackathon(event, { show_scores: 1 });
            expect(updated).toBeNull();
        });
    });
});
