import { useJudgingDraft } from "~/app/composables/useJudgingDraft";
import { DEFAULT_RUBRIC_DEFINITION } from "~~/shared/rubric";

describe("useJudgingDraft load races", () => {
    const fetchMock = vi.fn();
    const rubric = {
        version_id: 3,
        name: "Test rubric",
        tracks: DEFAULT_RUBRIC_DEFINITION.tracks,
    };

    function deferred<T>() {
        let resolve!: (value: T) => void;
        let reject!: (reason?: unknown) => void;
        const promise = new Promise<T>((resolvePromise, rejectPromise) => {
            resolve = resolvePromise;
            reject = rejectPromise;
        });
        return { promise, resolve, reject };
    }

    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal("$fetch", fetchMock);
        vi.stubGlobal("getErrorMessage", (error: unknown) =>
            error instanceof Error ? error.message : "Request failed",
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("ignores a rejected load after a newer project has loaded", async () => {
        const olderLoad = deferred<{
            rubric: typeof rubric;
            draft: null;
        }>();
        fetchMock.mockReturnValueOnce(olderLoad.promise).mockResolvedValueOnce({
            rubric,
            draft: {
                scores: { originality: 4 },
                reasoning: "Current project draft",
                rubric_version_id: 3,
                updated_at: "2026-11-12T08:00:00.000Z",
            },
        });
        const draft = useJudgingDraft();

        const firstLoad = draft.load(41, "junior");
        await draft.load(42, "junior");

        expect(draft.loaded.value).toBe(true);
        expect(draft.status.value).toBe("saved");
        expect(draft.state.scores.originality).toBe(4);
        expect(draft.state.reasoning).toBe("Current project draft");

        olderLoad.reject(new Error("Stale project request failed"));
        await firstLoad;

        expect(draft.loaded.value).toBe(true);
        expect(draft.status.value).toBe("saved");
        expect(draft.errorMessage.value).toBeNull();
        expect(draft.state.scores.originality).toBe(4);
        expect(draft.state.reasoning).toBe("Current project draft");
    });

    it("cancels a project switch when the current draft is reset while saving", async () => {
        const pendingSave = deferred<Record<string, never>>();
        fetchMock
            .mockResolvedValueOnce({ rubric, draft: null })
            .mockReturnValueOnce(pendingSave.promise);
        const draft = useJudgingDraft();

        await draft.load(45, "junior");
        draft.markChanged();
        const nextProjectLoad = draft.load(46, "junior");

        expect(fetchMock).toHaveBeenCalledTimes(2);
        draft.resetForCompletedProject();
        pendingSave.resolve({});
        await nextProjectLoad;

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(draft.loaded.value).toBe(false);
        expect(draft.status.value).toBe("saved");
        expect(draft.rubric.value).toBeNull();
    });

    it.each(["clear", "reset"] as const)(
        "does not restore a stale response after %s invalidates the project",
        async (action) => {
            const pendingLoad = deferred<{
                rubric: typeof rubric;
                draft: null;
            }>();
            fetchMock.mockReturnValueOnce(pendingLoad.promise);
            if (action === "clear") fetchMock.mockResolvedValueOnce({ deleted: true });
            const draft = useJudgingDraft();

            const loadPromise = draft.load(43, "junior");
            if (action === "clear") await draft.clear(43);
            else draft.resetForCompletedProject();

            pendingLoad.resolve({ rubric, draft: null });
            await loadPromise;

            expect(draft.loaded.value).toBe(false);
            expect(draft.status.value).toBe("saved");
            expect(draft.rubric.value).toBeNull();
            expect(draft.state.scores).toEqual({});
            expect(draft.state.reasoning).toBe("");
        },
    );

    it("keeps a pending load usable when clearing its draft fails", async () => {
        const pendingLoad = deferred<{
            rubric: typeof rubric;
            draft: null;
        }>();
        fetchMock
            .mockReturnValueOnce(pendingLoad.promise)
            .mockRejectedValueOnce(new Error("Could not clear the draft"));
        const draft = useJudgingDraft();

        const loadPromise = draft.load(44, "junior");
        await expect(draft.clear(44)).rejects.toThrow("Could not clear the draft");
        pendingLoad.resolve({ rubric, draft: null });
        await loadPromise;

        expect(draft.loaded.value).toBe(true);
        expect(draft.status.value).toBe("saved");
        expect(draft.rubric.value?.version_id).toBe(rubric.version_id);
    });
});
