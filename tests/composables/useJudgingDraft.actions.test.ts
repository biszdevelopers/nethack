import { useJudgingDraft } from "~/app/composables/useJudgingDraft";
import { DEFAULT_RUBRIC_DEFINITION } from "~~/shared/rubric";

describe("useJudgingDraft action and recovery paths", () => {
    const fetchMock = vi.fn();
    const rubric = {
        version_id: 7,
        name: "Current rubric",
        tracks: DEFAULT_RUBRIC_DEFINITION.tracks,
    };

    const savedDraft = (overrides: Record<string, unknown> = {}) => ({
        scores: { originality: 3 },
        reasoning: "Saved note",
        rubric_version_id: rubric.version_id,
        updated_at: "2026-11-10T08:00:00.000Z",
        ...overrides,
    });

    const response = (draft: ReturnType<typeof savedDraft> | null = null, version = rubric) => ({
        rubric: version,
        draft,
    });

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
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-11-12T12:00:00.000Z"));
        fetchMock.mockReset();
        vi.stubGlobal("$fetch", fetchMock);
        vi.stubGlobal("tryUseNuxtApp", () => null);
        vi.stubGlobal("getErrorMessage", (error: unknown) =>
            error instanceof Error ? error.message : "Request failed",
        );
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("ignores edits before a project is loaded and treats an empty retry as a no-op", async () => {
        const draft = useJudgingDraft();

        draft.state.reasoning = "Premature edit";
        draft.markChanged();
        await draft.retryLoad();
        await draft.flush();

        expect(fetchMock).not.toHaveBeenCalled();
        expect(draft.dirty.value).toBe(false);
        expect(draft.status.value).toBe("saved");
    });

    it("surfaces an unknown-track error and retries the same project after failure", async () => {
        fetchMock
            .mockResolvedValueOnce(response(null, { ...rubric, tracks: {} }))
            .mockResolvedValueOnce(response());
        const draft = useJudgingDraft();

        await draft.load(11, "junior");

        expect(draft.loaded.value).toBe(false);
        expect(draft.status.value).toBe("error");
        expect(draft.errorMessage.value).toBe(
            "This project does not match a track in its saved rubric.",
        );
        expect(draft.rubricVersionId.value).toBe(rubric.version_id);

        await draft.retryLoad();

        expect(draft.loaded.value).toBe(true);
        expect(draft.status.value).toBe("saved");
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("uses null for an invalid saved timestamp and skips duplicate same-project loads", async () => {
        fetchMock.mockResolvedValue(response(savedDraft({ updated_at: "not-a-date" })));
        const draft = useJudgingDraft();

        await draft.load(12, "junior");
        await draft.load(12, "junior");

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(draft.lastSavedAt.value).toBeNull();
        expect(draft.state.scores.originality).toBe(3);
    });

    it("allows retryLoad to refresh a clean project after the rubric changes", async () => {
        const nextRubric = { ...rubric, version_id: 8, name: "Updated rubric" };
        fetchMock
            .mockResolvedValueOnce(response(savedDraft()))
            .mockResolvedValueOnce(
                response(savedDraft({ scores: { originality: 5 } }), nextRubric),
            );
        const draft = useJudgingDraft();

        await draft.load(13, "junior");
        await draft.retryLoad();

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(draft.rubric.value?.name).toBe("Updated rubric");
        expect(draft.rubricVersionId.value).toBe(8);
        expect(draft.state.scores.originality).toBe(5);
        expect(draft.status.value).toBe("saved");
    });

    it("preserves a clean draft when refreshing it fails", async () => {
        fetchMock
            .mockResolvedValueOnce(response(savedDraft()))
            .mockRejectedValueOnce(new Error("Refresh unavailable"));
        const draft = useJudgingDraft();
        await draft.load(14, "junior");

        await draft.retryLoad();

        expect(draft.loaded.value).toBe(true);
        expect(draft.state.scores.originality).toBe(3);
        expect(draft.state.reasoning).toBe("Saved note");
        expect(draft.status.value).toBe("error");
        expect(draft.errorMessage.value).toBe("Refresh unavailable");
    });

    it("ignores the stale response when a judge quickly opens another project", async () => {
        const first = deferred<ReturnType<typeof response>>();
        const second = deferred<ReturnType<typeof response>>();
        fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const draft = useJudgingDraft();

        const firstLoad = draft.load(21, "junior");
        const secondLoad = draft.load(22, "senior");
        first.resolve(response(savedDraft({ scores: { originality: 1 } })));
        await firstLoad;
        expect(draft.loaded.value).toBe(false);
        second.resolve(response(savedDraft({ scores: { originality: 5 } })));
        await secondLoad;

        expect(draft.loaded.value).toBe(true);
        expect(draft.state.scores.originality).toBe(5);
        expect(draft.status.value).toBe("saved");
    });

    it("does not start a duplicate refresh while the initial project load is pending", async () => {
        const loading = deferred<ReturnType<typeof response>>();
        fetchMock.mockReturnValueOnce(loading.promise);
        const draft = useJudgingDraft();

        const pendingLoad = draft.load(23, "junior");
        await draft.retryLoad();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        loading.resolve(response(null));
        await pendingLoad;
        expect(draft.loaded.value).toBe(true);
        expect(draft.status.value).toBe("saved");
    });

    it("saves a dirty project before loading the next project", async () => {
        fetchMock
            .mockResolvedValueOnce(response(null))
            .mockResolvedValueOnce({ saved: true })
            .mockResolvedValueOnce(response(savedDraft({ scores: { originality: 4 } })));
        const draft = useJudgingDraft();
        await draft.load(31, "junior");

        draft.state.scores.originality = 2;
        draft.state.reasoning = "Saved before moving on";
        draft.markChanged();
        await draft.load(32, "senior");

        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
            "/api/judging/drafts/31",
            "/api/judging/drafts/31",
            "/api/judging/drafts/32",
        ]);
        expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
            method: "PUT",
            body: {
                scores: expect.objectContaining({ originality: 2 }),
                reasoning: "Saved before moving on",
            },
        });
        expect(draft.state.scores.originality).toBe(4);
        expect(draft.status.value).toBe("saved");
    });

    it("keeps the current project and its edits when saving fails during navigation", async () => {
        fetchMock
            .mockResolvedValueOnce(response(null))
            .mockRejectedValueOnce(new Error("Save unavailable"));
        const draft = useJudgingDraft();
        await draft.load(33, "junior");
        draft.state.scores.impact = 4;
        draft.markChanged();

        await expect(draft.load(34, "senior")).rejects.toThrow("Save unavailable");

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(draft.state.scores.impact).toBe(4);
        expect(draft.dirty.value).toBe(true);
        expect(draft.status.value).toBe("error");
        expect(draft.errorMessage.value).toBe("Save unavailable");
    });

    it("serializes overlapping saves and persists the newest edits exactly once", async () => {
        const firstSave = deferred<{ saved: boolean }>();
        fetchMock
            .mockResolvedValueOnce(response(null))
            .mockReturnValueOnce(firstSave.promise)
            .mockResolvedValueOnce({ saved: true });
        const draft = useJudgingDraft();
        await draft.load(41, "junior");

        draft.state.scores.originality = 2;
        draft.markChanged();
        const firstFlush = draft.flush();
        expect(fetchMock).toHaveBeenCalledTimes(2);

        draft.state.scores.originality = 5;
        draft.state.reasoning = "Newest edits";
        draft.markChanged();
        const secondFlush = draft.flush();
        firstSave.resolve({ saved: true });
        await Promise.all([firstFlush, secondFlush]);

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
            method: "PUT",
            body: {
                scores: expect.objectContaining({ originality: 5 }),
                reasoning: "Newest edits",
                rubric_version_id: 7,
            },
        });
        expect(draft.dirty.value).toBe(false);
        expect(draft.status.value).toBe("saved");
        expect(draft.lastSavedAt.value).toBe(Date.now());
    });

    it("waits for an in-flight save when retrying a clean draft", async () => {
        const save = deferred<{ saved: boolean }>();
        fetchMock.mockResolvedValueOnce(response(null)).mockReturnValueOnce(save.promise);
        const draft = useJudgingDraft();
        await draft.load(42, "junior");
        draft.state.reasoning = "Pending save";
        draft.markChanged();
        const flush = draft.flush();

        const retry = draft.retryLoad();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        save.resolve({ saved: true });
        await Promise.all([flush, retry]);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(draft.dirty.value).toBe(false);
        expect(draft.status.value).toBe("saved");
    });

    it("resets a completed project, cancels pending autosave, and ignores late save failure", async () => {
        const save = deferred<{ saved: boolean }>();
        fetchMock.mockResolvedValueOnce(response(null)).mockReturnValueOnce(save.promise);
        const draft = useJudgingDraft();
        await draft.load(51, "junior");
        draft.state.scores.originality = 5;
        draft.markChanged();
        const flush = draft.flush();

        draft.resetForCompletedProject();
        const waitingFlush = draft.flush();
        save.reject(new Error("Late save failure"));
        await expect(flush).rejects.toThrow("Late save failure");
        await expect(waitingFlush).rejects.toThrow("Late save failure");

        expect(draft.loaded.value).toBe(false);
        expect(draft.dirty.value).toBe(false);
        expect(draft.status.value).toBe("saved");
        expect(draft.errorMessage.value).toBeNull();
        expect(draft.rubric.value).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(2);

        draft.markChanged();
        await vi.advanceTimersByTimeAsync(650);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("ignores late save success after the judge leaves the completed project", async () => {
        const save = deferred<{ saved: boolean }>();
        fetchMock.mockResolvedValueOnce(response(null)).mockReturnValueOnce(save.promise);
        const draft = useJudgingDraft();
        await draft.load(52, "junior");
        draft.state.reasoning = "Ready to submit";
        draft.markChanged();
        const flush = draft.flush();
        draft.resetForCompletedProject();
        save.resolve({ saved: true });

        await flush;

        expect(draft.status.value).toBe("saved");
        expect(draft.loaded.value).toBe(false);
        expect(draft.lastSavedAt.value).toBeNull();
        expect(draft.errorMessage.value).toBeNull();
    });

    it("clears only the requested draft and cancels a queued save for its active project", async () => {
        fetchMock.mockResolvedValueOnce(response(null)).mockResolvedValue({ deleted: true });
        const draft = useJudgingDraft();
        await draft.load(61, "junior");
        draft.state.reasoning = "Do not save after delete";
        draft.markChanged();

        await draft.clear(999);
        expect(draft.loaded.value).toBe(true);
        expect(draft.state.reasoning).toBe("Do not save after delete");

        await draft.clear(61);
        await vi.advanceTimersByTimeAsync(650);

        expect(fetchMock.mock.calls.map(([url, options]) => [url, options?.method])).toEqual([
            ["/api/judging/drafts/61", undefined],
            ["/api/judging/drafts/999", "DELETE"],
            ["/api/judging/drafts/61", "DELETE"],
        ]);
        expect(draft.loaded.value).toBe(false);
        expect(draft.status.value).toBe("saved");
        expect(draft.dirty.value).toBe(false);
        expect(draft.lastSavedAt.value).toBeNull();
        expect(draft.rubricVersionId.value).toBeNull();
        expect(draft.state.scores).toEqual({});
        expect(draft.state.reasoning).toBe("");
    });

    it("preserves the active draft when clearing it fails", async () => {
        fetchMock
            .mockResolvedValueOnce(response(savedDraft()))
            .mockRejectedValueOnce(new Error("Delete denied"));
        const draft = useJudgingDraft();
        await draft.load(62, "junior");

        await expect(draft.clear(62)).rejects.toThrow("Delete denied");

        expect(draft.loaded.value).toBe(true);
        expect(draft.state.scores.originality).toBe(3);
        expect(draft.status.value).toBe("saved");
    });

    it("turns non-Error load failures into a readable recovery message", async () => {
        fetchMock.mockRejectedValue("offline");
        const draft = useJudgingDraft();

        await draft.load(63, "junior");

        expect(draft.status.value).toBe("error");
        expect(draft.errorMessage.value).toBe("Request failed");
        expect(draft.loaded.value).toBe(false);
    });

    it("refuses to save when a malformed loaded rubric has no version identifier", async () => {
        const malformedRubric = { ...rubric, version_id: null as unknown as number };
        fetchMock.mockResolvedValueOnce(response(null, malformedRubric));
        const draft = useJudgingDraft();
        await draft.load(64, "junior");

        draft.state.reasoning = "Draft without rubric version";
        draft.markChanged();

        await expect(draft.flush()).rejects.toThrow(
            "Load the judging rubric before saving a draft.",
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(draft.dirty.value).toBe(true);
        expect(draft.status.value).toBe("error");
        expect(draft.errorMessage.value).toBe("Load the judging rubric before saving a draft.");
    });
});
