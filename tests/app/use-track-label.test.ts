import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

describe("useTrackLabel", () => {
    it("formats the key when no client runtime is available", async () => {
        const { useTrackLabel } = await import("~~/app/composables/useTrackLabel");

        expect(useTrackLabel()("health_access")).toBe("Health Access");
        expect(useTrackLabel()(null)).toBe("");
    });

    it("does not fetch when the client has no fetch runtime", async () => {
        vi.stubGlobal("window", {});
        const { useTrackLabel } = await import("~~/app/composables/useTrackLabel");

        expect(useTrackLabel()("health")).toBe("Health");
    });

    it("uses organizer-defined names and falls back for unnamed tracks", async () => {
        vi.stubGlobal("window", {});
        const fetchMock = vi.fn().mockResolvedValue({
            tracks: {
                health: { name: "Health & Accessibility" },
                unnamed: {},
            },
        });
        vi.stubGlobal("$fetch", fetchMock);
        const { useTrackLabel } = await import("~~/app/composables/useTrackLabel");
        const label = useTrackLabel();

        await vi.waitFor(() => expect(label("health")).toBe("Health & Accessibility"));
        expect(label("unnamed")).toBe("Unnamed");
        expect(fetchMock).toHaveBeenCalledWith("/api/seasons/active/rubric");
    });

    it("keeps the formatted fallback when the rubric request fails", async () => {
        vi.stubGlobal("window", {});
        const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
        vi.stubGlobal("$fetch", fetchMock);
        const { useTrackLabel } = await import("~~/app/composables/useTrackLabel");
        const label = useTrackLabel();

        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
        expect(label("health")).toBe("Health");
    });

    it("accepts a response without a tracks object", async () => {
        vi.stubGlobal("window", {});
        const fetchMock = vi.fn().mockResolvedValue({});
        vi.stubGlobal("$fetch", fetchMock);
        const { useTrackLabel } = await import("~~/app/composables/useTrackLabel");
        const label = useTrackLabel();

        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
        expect(label("health")).toBe("Health");
    });
});
