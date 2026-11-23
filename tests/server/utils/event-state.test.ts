import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveEventGates } from "~~/server/utils/event-state";

const NOW = 1_700_000_000_000;

function hackathon(overrides: Record<string, unknown> = {}) {
    return {
        status: "in_progress",
        voting_enabled: 0,
        results_published: 0,
        judging_open: 0,
        start_timestamp: NOW - 1_000,
        end_timestamp: NOW + 60_000,
        voting_start_timestamp: NOW,
        voting_end_timestamp: NOW + 120_000,
        ...overrides,
    } as unknown as Hackathon;
}

function season(overrides: Record<string, unknown> = {}) {
    return { results_published_at: null, ...overrides } as unknown as Season;
}

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("event gates", () => {
    it("opens submissions only inside the configured phase and deadline", () => {
        expect(resolveEventGates(hackathon(), season(), { now: NOW }).submissionsOpen).toBe(true);

        const afterDeadline = resolveEventGates(hackathon(), season(), {
            now: NOW + 90_000,
            submissionGraceMs: 0,
        });
        expect(afterDeadline.submissionsOpen).toBe(false);
        expect(afterDeadline.submissionsClosed).toBe(true);
        expect(afterDeadline.galleryPublic).toBe(false);
    });

    it("keeps the grace window and deadline enforcement configurable", () => {
        const grace = resolveEventGates(hackathon(), season(), {
            now: NOW + 90_000,
            submissionGraceMs: 60_000,
        });
        expect(grace.submissionsOpen).toBe(true);

        const disabled = resolveEventGates(hackathon(), season(), {
            now: NOW + 999_999,
            enforceDeadlines: false,
        });
        expect(disabled.submissionsOpen).toBe(true);
        expect(disabled.galleryPublic).toBe(false);
    });

    it("closes every mutation while paused", () => {
        const paused = resolveEventGates(
            hackathon({ status: "paused", voting_enabled: 1, judging_open: 1 }),
            season(),
            { now: NOW },
        );
        expect(paused.paused).toBe(true);
        expect(paused.submissionsOpen).toBe(false);
        expect(paused.votingOpen).toBe(false);
        expect(paused.judgingOpen).toBe(false);
    });

    it("closes voting and judging at their configured deadlines", () => {
        const state = resolveEventGates(
            hackathon({ voting_enabled: 1, judging_open: 1 }),
            season(),
            { now: NOW + 180_000 },
        );
        expect(state.votingOpen).toBe(false);
        expect(state.judgingOpen).toBe(true);
    });

    it("keeps voting closed before the scheduled start", () => {
        const state = resolveEventGates(
            hackathon({ voting_enabled: 1, voting_start_timestamp: NOW + 60_000 }),
            season(),
            { now: NOW },
        );
        expect(state.votingOpen).toBe(false);
    });

    it("closes judging after publication unless overridden", () => {
        const afterPublish = resolveEventGates(
            hackathon({ status: "finished", judging_open: 1, results_published: 1 }),
            season({ results_published_at: new Date(NOW) }),
            { now: NOW },
        );
        expect(afterPublish.judgingOpen).toBe(false);
        expect(afterPublish.resultsVisible).toBe(true);

        const overridden = resolveEventGates(
            hackathon({ status: "finished", judging_open: 1, results_published: 1 }),
            season({ results_published_at: new Date(NOW) }),
            { now: NOW, judgingAfterPublish: true },
        );
        expect(overridden.judgingOpen).toBe(true);
    });

    it("treats a closed event phase as a closed gallery", () => {
        const voting = resolveEventGates(hackathon({ status: "voting" }), season(), { now: NOW });
        expect(voting.submissionsOpen).toBe(false);
        expect(voting.galleryPublic).toBe(true);

        const paused = resolveEventGates(hackathon({ status: "paused" }), season(), { now: NOW });
        expect(paused.galleryPublic).toBe(false);
    });

    it("keeps results hidden until published", () => {
        expect(resolveEventGates(hackathon(), season(), { now: NOW }).resultsVisible).toBe(false);
        expect(
            resolveEventGates(
                hackathon({ results_published: 1 }),
                season({ results_published: 1 }),
                { now: NOW },
            ).resultsVisible,
        ).toBe(true);
    });

    it("treats missing live configuration as fully closed", () => {
        const empty = resolveEventGates(null, null, { now: NOW });
        expect(empty).toMatchObject({
            submissionsOpen: false,
            submissionsClosed: false,
            votingOpen: false,
            judgingOpen: false,
            galleryPublic: false,
            resultsVisible: false,
        });
    });
});
