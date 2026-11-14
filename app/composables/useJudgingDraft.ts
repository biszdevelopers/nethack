import { reactive, shallowRef } from "vue";
import { apiFetch } from "./useApiFetch";

export interface JudgingDraft {
    scores: Record<string, number>;
    reasoning: string;
    rubric_version_id: number;
    updated_at: string;
}

export interface JudgingRubric {
    version_id: number;
    name: string;
    tracks: Record<string, import("~~/shared/rubric").RubricTrack>;
}

export type JudgingDraftStatus = "loading" | "saved" | "unsaved" | "saving" | "error";

/** Owns the current judge's recoverable draft and serializes writes per project. */
export function useJudgingDraft() {
    const state = reactive({ scores: {} as Record<string, number>, reasoning: "" });
    const status = shallowRef<JudgingDraftStatus>("saved");
    const errorMessage = shallowRef<string | null>(null);
    const lastSavedAt = shallowRef<number | null>(null);
    const dirty = shallowRef(false);
    const loaded = shallowRef(false);
    const rubric = shallowRef<JudgingRubric | null>(null);
    const rubricVersionId = shallowRef<number | null>(null);

    let currentTeamId: number | null = null;
    let currentTrackKey = "";
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: Promise<void> | null = null;
    let loadGeneration = 0;

    function assignState(scores: Record<string, number>, reasoning: string) {
        state.scores = { ...scores };
        state.reasoning = reasoning;
    }

    async function load(teamId: number, trackKey: string, refresh = false) {
        if (currentTeamId === teamId && status.value !== "error" && !refresh) return;

        const generation = ++loadGeneration;
        clearTimeout(saveTimer);
        if (dirty.value && currentTeamId !== null) await flush();
        if (generation !== loadGeneration) return;

        const preserveCurrentDraft = refresh && currentTeamId === teamId && loaded.value;
        currentTeamId = teamId;
        currentTrackKey = trackKey;
        if (!preserveCurrentDraft) {
            rubric.value = null;
            rubricVersionId.value = null;
            assignState({}, "");
            dirty.value = false;
            loaded.value = false;
        }
        errorMessage.value = null;
        status.value = "loading";

        try {
            const response = await apiFetch<{
                rubric: JudgingRubric;
                draft: JudgingDraft | null;
            }>(`/api/judging/drafts/${teamId}`);
            if (generation !== loadGeneration) return;

            rubric.value = response.rubric;
            rubricVersionId.value = response.rubric.version_id;
            const track = response.rubric.tracks[trackKey];
            if (!track) throw new Error("This project does not match a track in its saved rubric.");
            const defaults = Object.fromEntries(
                track.criteria.map((criterion) => [criterion.id, criterion.minScore]),
            );
            if (response.draft) {
                assignState({ ...defaults, ...response.draft.scores }, response.draft.reasoning);
                lastSavedAt.value = Date.parse(response.draft.updated_at) || null;
            } else {
                // A fresh project still needs every criterion present in state so
                // autosave and review use the rubric's score range, including any
                // non-zero minimum configured by the organizer.
                assignState(defaults, "");
                lastSavedAt.value = null;
            }
            loaded.value = true;
            status.value = "saved";
        } catch (error) {
            if (generation !== loadGeneration) return;
            loaded.value = preserveCurrentDraft;
            status.value = "error";
            errorMessage.value = getErrorMessage(error);
        }
    }

    function markChanged() {
        if (currentTeamId === null || !loaded.value || status.value === "loading") return;

        dirty.value = true;
        status.value = "unsaved";
        errorMessage.value = null;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            void flush().catch(() => undefined);
        }, 650);
    }

    async function flush() {
        clearTimeout(saveTimer);
        if (currentTeamId === null || !dirty.value) {
            if (inFlight) await inFlight;
            return;
        }

        if (rubricVersionId.value === null) {
            const error = new Error("Load the judging rubric before saving a draft.");
            status.value = "error";
            errorMessage.value = error.message;
            throw error;
        }

        if (inFlight) {
            await inFlight;
            return flush();
        }

        const teamId = currentTeamId;
        const payload = {
            scores: { ...state.scores },
            reasoning: state.reasoning,
            rubric_version_id: rubricVersionId.value,
        };
        dirty.value = false;
        status.value = "saving";

        inFlight = apiFetch(`/api/judging/drafts/${teamId}`, {
            method: "PUT",
            body: payload,
        })
            .then(() => {
                if (currentTeamId !== teamId) return;
                lastSavedAt.value = Date.now();
                status.value = "saved";
                errorMessage.value = null;
            })
            .catch((error: unknown) => {
                if (currentTeamId === teamId) {
                    dirty.value = true;
                    status.value = "error";
                    errorMessage.value = getErrorMessage(error);
                }
                throw error;
            })
            .finally(() => {
                inFlight = null;
            });

        await inFlight;
        if (dirty.value) await flush();
    }

    async function retryLoad() {
        if (currentTeamId === null) return;
        // A reload may return a newer active rubric when an organizer changes
        // the rubric while this judge is working. Keep the current scores pinned
        // to the rubric they were entered against; retry their save first and
        // leave them in place rather than silently rebasing or discarding them.
        if (dirty.value || inFlight) {
            await flush();
            return;
        }
        if (status.value === "loading") return;
        await load(currentTeamId, currentTrackKey, true);
    }

    async function clear(teamId: number) {
        await apiFetch(`/api/judging/drafts/${teamId}`, { method: "DELETE" });
        if (currentTeamId === teamId) {
            loadGeneration++;
            clearTimeout(saveTimer);
            currentTeamId = null;
            rubric.value = null;
            rubricVersionId.value = null;
            dirty.value = false;
            loaded.value = false;
            status.value = "saved";
            errorMessage.value = null;
            lastSavedAt.value = null;
            assignState({}, "");
        }
    }

    function resetForCompletedProject() {
        loadGeneration++;
        clearTimeout(saveTimer);
        currentTeamId = null;
        rubric.value = null;
        rubricVersionId.value = null;
        dirty.value = false;
        loaded.value = false;
        status.value = "saved";
        errorMessage.value = null;
    }

    return {
        state,
        status,
        errorMessage,
        lastSavedAt,
        dirty,
        loaded,
        rubric,
        rubricVersionId,
        load: (teamId: number, trackKey: string) => load(teamId, trackKey),
        markChanged,
        flush,
        retryLoad,
        clear,
        resetForCompletedProject,
    };
}
