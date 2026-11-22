import { describe, expect, it } from "vitest";
import { isVotingOpen } from "~~/server/utils/voting";

const state = (overrides: Record<string, unknown> = {}) =>
    ({
        status: "voting",
        voting_enabled: 1,
        ...overrides,
    }) as Pick<Hackathon, "status" | "voting_enabled">;

describe("isVotingOpen", () => {
    it("is open when the voting toggle is on", () => {
        expect(isVotingOpen(state())).toBe(true);
    });

    it("stays open outside the voting phase so the toggle dictates state", () => {
        expect(isVotingOpen(state({ status: "finished" }))).toBe(true);
        expect(isVotingOpen(state({ status: "not_started" }))).toBe(true);
    });

    it("closes when voting is disabled", () => {
        expect(isVotingOpen(state({ voting_enabled: 0 }))).toBe(false);
    });

    it("closes while the event is paused", () => {
        expect(isVotingOpen(state({ status: "paused" }))).toBe(false);
    });

    it("closes without live state", () => {
        expect(isVotingOpen(null)).toBe(false);
    });

    it("waits for a future voting start when deadlines are enforced", () => {
        const now = Date.now();
        expect(
            isVotingOpen(state({ voting_start_timestamp: now + 60_000 }), {
                now,
                enforceDeadlines: true,
            }),
        ).toBe(false);
        expect(
            isVotingOpen(
                state({
                    voting_start_timestamp: now - 60_000,
                    voting_end_timestamp: now + 60_000,
                }),
                { now, enforceDeadlines: true },
            ),
        ).toBe(true);
    });

    it("still closes after the voting end when deadlines are enforced", () => {
        const now = Date.now();
        expect(
            isVotingOpen(state({ voting_end_timestamp: now - 1 }), {
                now,
                enforceDeadlines: true,
            }),
        ).toBe(false);
    });

    it("ignores the voting window when deadline enforcement is disabled", () => {
        const now = Date.now();
        expect(
            isVotingOpen(state({ voting_start_timestamp: now + 60_000 }), {
                now,
                enforceDeadlines: false,
            }),
        ).toBe(true);
    });
});
