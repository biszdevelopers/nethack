import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getActiveSeason: vi.fn(),
    getHackathon: vi.fn(),
}));

vi.mock("~~/server/utils/database/seasons", () => ({
    getActiveSeason: mocks.getActiveSeason,
}));
vi.mock("~~/server/utils/database/hackathon", () => ({
    getHackathon: mocks.getHackathon,
}));

import {
    getEventState,
    getSubmissionGraceMs,
    invalidateEventStateCache,
    isDeadlineEnforcementEnabled,
    isNotificationsEnabled,
    isPeopleChoiceEnabled,
    isPublicGalleryEnabled,
    resolveEventGates,
} from "~~/server/utils/event-state";

const NOW = 1_700_000_000_000;

function hackathon(overrides: Record<string, unknown> = {}) {
    return {
        status: "in_progress",
        voting_enabled: 0,
        results_published: 0,
        judging_open: 0,
        start_timestamp: NOW - 10_000,
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
    mocks.getActiveSeason.mockReset();
    mocks.getHackathon.mockReset();
});

describe("deadline environment flags", () => {
    it.each([
        ["", true],
        ["on", true],
        ["TRUE", true],
        ["1", true],
        ["yes", true],
        ["enabled", true],
        ["off", false],
        ["FALSE", false],
        ["0", false],
        ["no", false],
        ["disabled", false],
        ["maybe", true],
    ])("parses ENFORCE_DEADLINES=%j", (raw, expected) => {
        if (raw === "") vi.stubEnv("ENFORCE_DEADLINES", "");
        else vi.stubEnv("ENFORCE_DEADLINES", raw);

        expect(isDeadlineEnforcementEnabled()).toBe(expected);
    });

    it("uses the environment switch when gates are resolved without options", () => {
        vi.stubEnv("ENFORCE_DEADLINES", "0");
        vi.stubEnv("SUBMISSION_GRACE_MS", "0");

        const state = resolveEventGates(hackathon(), season(), { now: NOW + 999_999 });

        expect(state.submissionsOpen).toBe(true);
        expect(state.submissionsClosed).toBe(false);
    });

    it("defaults the clock to the current time", () => {
        const state = resolveEventGates(
            hackathon({ start_timestamp: 0, end_timestamp: Date.now() + 3_600_000 }),
            season(),
        );

        expect(state.submissionsOpen).toBe(true);
    });

    it.each([
        ["PUBLIC_GALLERY_MODE", isPublicGalleryEnabled],
        ["PEOPLES_CHOICE_ENABLED", isPeopleChoiceEnabled],
        ["NOTIFICATIONS_ENABLED", isNotificationsEnabled],
    ])("parses the %s switch", (name, read) => {
        vi.stubEnv(name, "disabled");
        expect(read()).toBe(false);
        vi.stubEnv(name, "enabled");
        expect(read()).toBe(true);
        vi.stubEnv(name, "");
        expect(read()).toBe(true);
    });

    it("hides the gallery when the public gallery switch is off", () => {
        vi.stubEnv("PUBLIC_GALLERY_MODE", "0");

        const state = resolveEventGates(hackathon({ status: "voting" }), season(), { now: NOW });

        expect(state.submissionsClosed).toBe(true);
        expect(state.galleryPublic).toBe(false);
    });

    it.each([
        ["not a number", 0],
        ["-500", 0],
        ["0", 0],
        ["Infinity", 0],
        ["1500.9", 1500],
    ])("parses SUBMISSION_GRACE_MS=%j", (raw, expected) => {
        vi.stubEnv("SUBMISSION_GRACE_MS", raw);

        expect(getSubmissionGraceMs()).toBe(expected);
    });

    it("defaults the grace window to zero when unset", () => {
        vi.stubEnv("SUBMISSION_GRACE_MS", "");

        expect(getSubmissionGraceMs()).toBe(0);
    });

    it("keeps judging open after publication when JUDGING_AFTER_PUBLISH is enabled", () => {
        vi.stubEnv("JUDGING_AFTER_PUBLISH", "Enabled");

        const state = resolveEventGates(
            hackathon({ status: "finished", judging_open: 1 }),
            season({ results_published_at: new Date(NOW) }),
            { now: NOW },
        );

        expect(state.judgingOpen).toBe(true);
    });

    it("closes judging after publication when the flag is not enabled", () => {
        vi.stubEnv("JUDGING_AFTER_PUBLISH", "sometimes");

        const state = resolveEventGates(
            hackathon({ status: "finished", judging_open: 1 }),
            season({ results_published_at: new Date(NOW) }),
            { now: NOW },
        );

        expect(state.judgingOpen).toBe(false);
    });
});

describe("getEventState", () => {
    it("resolves and caches the merged state once per request", async () => {
        const live = hackathon({ judging_open: 1 });
        const active = season({ id: 3 });
        mocks.getHackathon.mockResolvedValue(live);
        mocks.getActiveSeason.mockResolvedValue(active);
        const event = { context: {} } as any;

        const first = getEventState(event, NOW);
        const second = getEventState(event, NOW + 1);

        await expect(first).resolves.toMatchObject({
            season: active,
            hackathon: live,
            now: NOW,
            submissionsOpen: true,
        });
        expect(second).toBe(first);
        expect(mocks.getHackathon).toHaveBeenCalledTimes(1);
        expect(mocks.getActiveSeason).toHaveBeenCalledTimes(1);
    });

    it("re-reads the state after invalidation", async () => {
        mocks.getHackathon.mockResolvedValue(hackathon());
        mocks.getActiveSeason.mockResolvedValue(season());
        const event = { context: {} } as any;

        await getEventState(event, NOW);
        invalidateEventStateCache(event);
        await getEventState(event, NOW);

        expect(mocks.getHackathon).toHaveBeenCalledTimes(2);
        expect(mocks.getActiveSeason).toHaveBeenCalledTimes(2);
    });

    it("drops a failed lookup so the next call can retry", async () => {
        mocks.getHackathon.mockResolvedValue(hackathon());
        mocks.getActiveSeason.mockRejectedValueOnce(new Error("database offline"));
        mocks.getActiveSeason.mockResolvedValueOnce(season());
        const event = { context: {} } as any;

        await expect(getEventState(event, NOW)).rejects.toThrow("database offline");
        await expect(getEventState(event, NOW)).resolves.toMatchObject({
            season: { results_published_at: null },
        });

        expect(mocks.getActiveSeason).toHaveBeenCalledTimes(2);
    });
});
