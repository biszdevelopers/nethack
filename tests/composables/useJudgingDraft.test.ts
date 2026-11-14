import { useJudgingDraft } from "~/app/composables/useJudgingDraft";
import { DEFAULT_RUBRIC_DEFINITION } from "~~/shared/rubric";

describe("useJudgingDraft", () => {
    const fetchMock = vi.fn();
    const rubric = {
        version_id: 3,
        name: "Test rubric",
        tracks: DEFAULT_RUBRIC_DEFINITION.tracks,
    };

    beforeEach(() => {
        vi.useFakeTimers();
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

    it("loads a saved draft and fills any missing criteria from the rubric defaults", async () => {
        fetchMock.mockResolvedValue({
            rubric,
            draft: {
                scores: { originality: 4 },
                reasoning: "Clear and thoughtful work.",
                rubric_version_id: 3,
                updated_at: "2026-11-10T08:00:00.000Z",
            },
        });
        const draft = useJudgingDraft();

        await draft.load(42, "junior");

        expect(draft.state.scores).toEqual({
            originality: 4,
            presentation: 0,
            technicality: 0,
            theme: 0,
            impact: 0,
        });
        expect(draft.state.reasoning).toBe("Clear and thoughtful work.");
        expect(draft.rubricVersionId.value).toBe(3);
        expect(draft.status.value).toBe("saved");
        expect(fetchMock).toHaveBeenCalledWith("/api/judging/drafts/42", undefined);
    });

    it("initializes a new draft at each criterion's configured minimum score", async () => {
        const customRubric = {
            ...rubric,
            tracks: {
                ...rubric.tracks,
                junior: {
                    ...rubric.tracks.junior,
                    criteria: rubric.tracks.junior.criteria.map((criterion) =>
                        criterion.id === "impact"
                            ? { ...criterion, minScore: 2, maxScore: 7 }
                            : criterion,
                    ),
                },
            },
        };
        fetchMock.mockResolvedValue({ rubric: customRubric, draft: null });
        const draft = useJudgingDraft();

        await draft.load(43, "junior");

        expect(draft.state.scores).toEqual({
            originality: 0,
            presentation: 0,
            technicality: 0,
            theme: 0,
            impact: 2,
        });
    });

    it("debounces changes and persists the latest score and reasoning", async () => {
        fetchMock.mockResolvedValue({ rubric, draft: null });
        const draft = useJudgingDraft();
        await draft.load(9, "junior");

        draft.state.scores.originality = 2;
        draft.markChanged();
        await vi.advanceTimersByTimeAsync(400);
        draft.state.scores.originality = 5;
        draft.state.reasoning = "Strong execution and a clear demo.";
        draft.markChanged();
        await vi.advanceTimersByTimeAsync(650);

        expect(fetchMock).toHaveBeenLastCalledWith("/api/judging/drafts/9", {
            method: "PUT",
            body: {
                scores: {
                    originality: 5,
                    presentation: 0,
                    technicality: 0,
                    theme: 0,
                    impact: 0,
                },
                reasoning: "Strong execution and a clear demo.",
                rubric_version_id: 3,
            },
        });
        expect(draft.status.value).toBe("saved");
        expect(draft.dirty.value).toBe(false);
    });

    it("keeps an unsaved draft in memory and allows retry after a failed save", async () => {
        fetchMock
            .mockResolvedValueOnce({ rubric, draft: null })
            .mockRejectedValueOnce(new Error("offline"));
        const draft = useJudgingDraft();
        await draft.load(12, "junior");

        draft.state.scores.impact = 4;
        draft.markChanged();
        await vi.advanceTimersByTimeAsync(650);

        expect(draft.status.value).toBe("error");
        expect(draft.errorMessage.value).toBe("offline");
        expect(draft.dirty.value).toBe(true);
        expect(draft.state.scores.impact).toBe(4);

        fetchMock.mockResolvedValueOnce({});
        await draft.flush();

        expect(draft.status.value).toBe("saved");
        expect(draft.dirty.value).toBe(false);
    });

    it("retries saving dirty work against its pinned rubric without reloading a changed rubric", async () => {
        fetchMock
            .mockResolvedValueOnce({ rubric, draft: null })
            .mockRejectedValueOnce(new Error("The rubric changed"));
        const draft = useJudgingDraft();
        await draft.load(27, "junior");

        draft.state.scores.originality = 4;
        draft.state.reasoning = "A saved explanation that must stay with this rubric.";
        draft.markChanged();
        await expect(draft.flush()).rejects.toThrow("The rubric changed");

        fetchMock.mockResolvedValueOnce({ saved: true });
        await draft.retryLoad();

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(fetchMock).toHaveBeenLastCalledWith("/api/judging/drafts/27", {
            method: "PUT",
            body: {
                scores: {
                    originality: 4,
                    presentation: 0,
                    technicality: 0,
                    theme: 0,
                    impact: 0,
                },
                reasoning: "A saved explanation that must stay with this rubric.",
                rubric_version_id: 3,
            },
        });
        expect(draft.state.scores.originality).toBe(4);
        expect(draft.rubricVersionId.value).toBe(3);
        expect(draft.dirty.value).toBe(false);
        expect(draft.status.value).toBe("saved");
    });

    it("does not save scores until a rubric version has loaded", async () => {
        fetchMock.mockRejectedValue(new Error("offline"));
        const draft = useJudgingDraft();
        await draft.load(18, "junior");

        draft.state.scores.originality = 4;
        draft.markChanged();
        await expect(draft.flush()).resolves.toBeUndefined();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(draft.dirty.value).toBe(false);
    });
});
