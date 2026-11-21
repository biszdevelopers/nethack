<script setup lang="ts">
import { apiFetch } from "~~/app/composables/useApiFetch";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import JudgingCard from "~/components/JudgingCard.vue";
import JudgingReview from "~/components/JudgingReview.vue";
import { useJudgingDraft } from "~/composables/useJudgingDraft";
import type { RubricDefinition } from "~~/shared/rubric";
import { NethackPermissions } from "~~/shared/permissions";
import {
    commentContainsJudgeIdentity,
    JUDGE_COMMENT_IDENTITY_ERROR,
} from "~~/shared/judge-comments";
import { getJudgingQueueScanRanges } from "~/utils/judging-queue";
import { WEBSITE_NAME } from "~/utils/consts";

interface JudgingRubric extends RubricDefinition {
    version_id: number;
}

interface FinalizedEvaluation {
    scores: Record<string, number>;
    reasoning: string;
}

definePageMeta({
    layout: "fullwidth",
    hideFooter: true,
    middleware: ["auth"],
});
useHead({ title: `Judging queue | ${WEBSITE_NAME}` });

const { data: hackathon } = await useApiFetch("/api/seasons/active", { $fetch: globalThis.$fetch });
// The server computes this with the same gate the queue endpoint enforces;
// duplicating the predicate here drifted once results were published.
if (!hackathon.value?.is_judging_open) {
    throw await navigateTo("/");
}

const { user, error: userError } = await useApiUser();
const { can } = useNethackPermissions();
if (userError.value) throw userError.value;
if (!can(NethackPermissions.Judging.assignmentsRead)) {
    throw await navigateTo("/");
}
if (!can(NethackPermissions.Judging.scoresWriteAssigned)) {
    throw await navigateTo("/judging");
}

const queuePageSize = 20;
const [queueFetch, summaryFetch, rubricFetch] = await Promise.all([
    useApiFetch<GetJudgingQueueResponse>(
        `/api/teams?judging=true&page=1&page_size=${queuePageSize}`,
        {
            server: false,
        },
    ),
    useApiFetch<GetBallotSummaryResponse>("/api/ballot/summary", { server: false }),
    useApiFetch<JudgingRubric>("/api/judging/rubric", { server: false }),
]);

const queuePages = shallowRef<Record<number, JudgeQueueItem[]>>({});
const pageRequests = new Map<number, Promise<JudgeQueueItem[]>>();
const navigatorOpen = ref(false);
const navigatorLoading = ref(false);
const navigatorError = shallowRef<unknown>(null);
const navigatorFilter = ref<"all" | "pending" | "evaluated">("all");
const navigatorFilters = [
    { value: "all", label: "All" },
    { value: "pending", label: "Not scored" },
    { value: "evaluated", label: "Scored" },
] as const;
const totalProjects = shallowRef(0);
const totalPages = shallowRef(0);
const navigationError = shallowRef<unknown>(null);
const currentPage = shallowRef(1);
const activeIndex = shallowRef(0);
const navigating = shallowRef(false);
const step = shallowRef<"score" | "review">("score");
const submitting = shallowRef(false);
let reviewTrigger: HTMLElement | null = null;
const submissionError = shallowRef<string | null>(null);
const finalized = shallowRef<Record<number, FinalizedEvaluation>>({});
const scoredCount = shallowRef(0);
let initialAutofocusDone = false;
const toast = useToast();
const draft = useJudgingDraft();
const {
    status: draftStatus,
    errorMessage: draftErrorMessage,
    lastSavedAt: draftLastSavedAt,
    loaded: draftLoaded,
} = draft;

const currentSummary = computed(() => summaryFetch.data.value?.current ?? null);
const queue = computed(() => queuePages.value[currentPage.value] ?? []);
const activeItem = computed(() => queue.value[activeIndex.value] ?? null);
const activeTeam = computed(() => activeItem.value?.team ?? null);
const activeTrack = computed(() => {
    const pathway = activeTeam.value?.pathway;
    return pathway
        ? (draft.rubric.value?.tracks[pathway] ?? rubricFetch.data.value?.tracks[pathway] ?? null)
        : null;
});
const activeCommentGuidance = computed(
    () => draft.rubric.value?.commentGuidance ?? rubricFetch.data.value?.commentGuidance,
);
const commentIdentityError = computed(() =>
    commentContainsJudgeIdentity(draft.state.reasoning, user.value?.email, user.value?.name)
        ? JUDGE_COMMENT_IDENTITY_ERROR
        : null,
);
const activeFinalized = computed(() =>
    activeTeam.value
        ? (finalized.value[activeTeam.value.id] ?? activeItem.value?.evaluation ?? null)
        : null,
);
const displayScores = computed(() => activeFinalized.value?.scores ?? draft.state.scores);
const displayReasoning = computed(() => activeFinalized.value?.reasoning ?? draft.state.reasoning);
const submittedCount = computed(() => currentSummary.value?.submitted_count ?? 0);
const summaryFailed = computed(() => !currentSummary.value && Boolean(summaryFetch.error.value));
const queueError = computed(
    () => navigationError.value || queueFetch.error.value || rubricFetch.error.value,
);
const isLoading = computed(
    () =>
        queueFetch.status.value === "idle" ||
        queueFetch.status.value === "pending" ||
        rubricFetch.status.value === "idle" ||
        rubricFetch.status.value === "pending",
);
const activeProjectNumber = computed(
    () => (currentPage.value - 1) * queuePageSize + activeIndex.value + 1,
);
// The progress summary is optional; fall back to the loaded queue so a failed
// summary never hides the Next unscored jump or blocks the workspace.
const hasPendingProjects = computed(() => {
    const current = currentSummary.value;
    if (current)
        return current.submitted_count > 0 && current.scored_count < current.submitted_count;
    const pages = Object.values(queuePages.value);
    if (pages.length >= totalPages.value) {
        return pages.some((page) => page.some((item) => !item.evaluated));
    }
    return totalProjects.value > 0;
});
const navigatorPages = computed(() =>
    Array.from({ length: totalPages.value }, (_, index) => {
        const page = index + 1;
        return { page, items: queuePages.value[page] ?? [] };
    }),
);
const navigatorVisiblePages = computed(() =>
    navigatorPages.value
        .map((group) => ({
            page: group.page,
            items: group.items
                .map((item, index) => ({ item, index }))
                .filter(({ item }) =>
                    navigatorFilter.value === "all"
                        ? true
                        : navigatorFilter.value === "evaluated"
                          ? item.evaluated
                          : !item.evaluated,
                ),
        }))
        .filter((group) => group.items.length > 0),
);

watch(
    () => queueFetch.data.value,
    (response) => {
        if (!response) return;
        queuePages.value = { 1: response.items };
        totalProjects.value = response.total;
        totalPages.value = response.total_pages;
        currentPage.value = 1;
        const firstPending = response.items.findIndex((item) => !item.evaluated);
        activeIndex.value = Math.max(0, firstPending);
        navigationError.value = null;
    },
    { immediate: true },
);
// The queue and the progress summary load independently. Wait for the queue and
// let a failed summary degrade the hints instead of blocking the first project.
watch(
    [() => queueFetch.status.value, () => summaryFetch.status.value],
    ([queueStatus, summaryStatus]) => {
        if (initialAutofocusDone) return;
        if (queueStatus !== "success") return;
        if (summaryStatus !== "success" && summaryStatus !== "error") return;
        if (!queueFetch.data.value) return;
        initialAutofocusDone = true;
        if (activeItem.value?.evaluated && hasPendingProjects.value) {
            void focusNextPending(1, 0);
        }
    },
    { immediate: true },
);
watch(
    () => currentSummary.value?.scored_count,
    (count) => {
        scoredCount.value = count ?? 0;
    },
    { immediate: true },
);
watch(
    () => [activeTeam.value, activeTrack.value] as const,
    async ([team, track]) => {
        step.value = "score";
        if (!team || !team.pathway) {
            draft.resetForCompletedProject();
            return;
        }

        if (!track) return;

        await draft.load(team.id, team.pathway);
    },
    { immediate: true },
);

function updateScore(criterionId: string, value: number) {
    draft.state.scores[criterionId] = value;
    draft.markChanged();
}

function updateReasoning(value: string) {
    draft.state.reasoning = value;
    draft.markChanged();
}

async function retryDraft() {
    try {
        if (draft.dirty.value) await draft.flush();
        else await draft.retryLoad();
    } catch {
        // The draft card exposes the recoverable error and keeps the entered values in memory.
    }
}

async function discardDraft() {
    await draft.forceReload();
}

async function saveCurrentDraftBeforeNavigation() {
    if (!activeFinalized.value) {
        try {
            await draft.flush();
        } catch {
            toast.add({
                color: "error",
                title: "Draft not saved",
                description: "Retry saving your work before changing projects.",
            });
            return false;
        }
    }
    return true;
}

async function getQueuePage(page: number) {
    const cached = queuePages.value[page];
    if (cached) return cached;
    const pending = pageRequests.get(page);
    if (pending) return pending;

    const request = apiFetch<GetJudgingQueueResponse>("/api/teams", {
        query: { judging: true, page, page_size: queuePageSize },
    })
        .then((response) => {
            queuePages.value = { ...queuePages.value, [page]: response.items };
            totalProjects.value = response.total;
            totalPages.value = response.total_pages;
            return response.items;
        })
        .finally(() => {
            pageRequests.delete(page);
        });
    pageRequests.set(page, request);
    return request;
}

async function refreshQueuePage(page: number) {
    const response = await apiFetch<GetJudgingQueueResponse>("/api/teams", {
        query: { judging: true, page, page_size: queuePageSize },
    });
    queuePages.value = { ...queuePages.value, [page]: response.items };
    totalProjects.value = response.total;
    totalPages.value = response.total_pages;
    return response.items;
}

async function openPage(page: number, index: number): Promise<boolean> {
    if (navigating.value || page < 1 || page > totalPages.value) return false;

    navigating.value = true;
    try {
        if (!(await saveCurrentDraftBeforeNavigation())) return false;
        navigationError.value = null;
        const pageItems = await getQueuePage(page);
        const targetIndex = index < 0 ? pageItems.length - 1 : index;
        if (targetIndex < 0 || targetIndex >= pageItems.length) return false;
        currentPage.value = page;
        activeIndex.value = targetIndex;
        return true;
    } catch (error) {
        navigationError.value = error;
        return false;
    } finally {
        navigating.value = false;
    }
}

async function openProject(index: number) {
    if (navigating.value || index < 0 || index >= queue.value.length || index === activeIndex.value)
        return;

    navigating.value = true;
    try {
        if (!(await saveCurrentDraftBeforeNavigation())) return;
        activeIndex.value = index;
    } finally {
        navigating.value = false;
    }
}

async function openNextProject() {
    if (activeIndex.value + 1 < queue.value.length) {
        await openProject(activeIndex.value + 1);
    } else if (currentPage.value < totalPages.value) {
        await openPage(currentPage.value + 1, 0);
    }
}

async function openPreviousProject() {
    if (activeIndex.value > 0) {
        await openProject(activeIndex.value - 1);
    } else if (currentPage.value > 1) {
        await openPage(currentPage.value - 1, -1);
    }
}

async function focusNextPending(startPage: number, startIndex: number) {
    for (const range of getJudgingQueueScanRanges(startPage, startIndex, totalPages.value)) {
        try {
            const pageItems = await getQueuePage(range.page);
            const index = pageItems.findIndex(
                (item, itemIndex) =>
                    !item.evaluated &&
                    itemIndex >= range.fromIndex &&
                    (range.untilIndex === undefined || itemIndex < range.untilIndex),
            );
            if (index >= 0) {
                currentPage.value = range.page;
                activeIndex.value = index;
                navigationError.value = null;
                return true;
            }
        } catch (error) {
            navigationError.value = error;
            return false;
        }
    }
    return false;
}

async function loadAllQueuePages() {
    const missing = navigatorPages.value
        .filter((group) => queuePages.value[group.page] === undefined)
        .map((group) => group.page);
    if (missing.length === 0) {
        navigatorError.value = null;
        return;
    }

    navigatorLoading.value = true;
    navigatorError.value = null;
    try {
        await Promise.all(missing.map((page) => getQueuePage(page)));
    } catch (error) {
        navigatorError.value = error;
    } finally {
        navigatorLoading.value = false;
    }
}

async function openNavigator() {
    navigatorOpen.value = true;
    await loadAllQueuePages();
}

async function jumpToProject(page: number, index: number) {
    if (await openPage(page, index)) navigatorOpen.value = false;
}

async function jumpToNextPending() {
    if (navigating.value) return;
    navigating.value = true;
    try {
        if (!(await saveCurrentDraftBeforeNavigation())) return;
        const found = await focusNextPending(currentPage.value, activeIndex.value + 1);
        // The only remaining project can be the one already open, which the
        // forward scan deliberately skips; fall back to a full scan.
        if (!found && !navigationError.value) await focusNextPending(1, 0);
    } finally {
        navigating.value = false;
    }
}

async function openReview(event: MouseEvent) {
    if (navigating.value || activeFinalized.value) return;

    const team = activeTeam.value;
    const trigger = event.currentTarget as HTMLElement;
    try {
        await draft.flush();
        if (team !== activeTeam.value || navigating.value) return;
        reviewTrigger = trigger;
        submissionError.value = null;
        step.value = "review";
    } catch {
        toast.add({
            color: "error",
            title: "Draft not saved",
            description: "Retry saving your work before reviewing it.",
        });
    }
}

function restoreReviewFocus(event: Event) {
    event.preventDefault();
    if (reviewTrigger?.isConnected && !reviewTrigger.matches(":disabled")) {
        reviewTrigger.focus();
    }
    reviewTrigger = null;
}

function returnToScoring() {
    submissionError.value = null;
    step.value = "score";
}

const reportOpen = ref(false);
const reportKind = ref<"flag" | "recusal">("flag");
const reportReason = ref("");
const reportError = ref<string | null>(null);
const reportBusy = ref(false);
const reportTitle = computed(() =>
    reportKind.value === "flag" ? "Flag for organizer" : "Recuse me",
);

function openReport(kind: "flag" | "recusal") {
    reportKind.value = kind;
    reportReason.value = "";
    reportError.value = null;
    reportOpen.value = true;
}

async function sendFlag(teamID: number, reason: string) {
    try {
        await apiFetch("/api/judging/flag", {
            method: "POST",
            body: { team_id: teamID, reason },
        });
    } catch (e) {
        const status =
            (e as { status?: number } | undefined)?.status ??
            (e as { statusCode?: number } | undefined)?.statusCode;
        if (status !== 404 && status !== 405) throw e;
        await apiFetch("/api/judging/flags", {
            method: "POST",
            body: { team_id: teamID, reason },
        });
    }
}

async function dropRecusedProject(teamID: number) {
    queuePages.value = Object.fromEntries(
        Object.entries(queuePages.value).map(([page, items]) => [
            Number(page),
            items.filter((item) => item.team.id !== teamID),
        ]),
    );
    totalProjects.value = Math.max(0, totalProjects.value - 1);
    if (totalProjects.value === 0) {
        currentPage.value = 1;
        activeIndex.value = 0;
        return;
    }

    try {
        await refreshQueuePage(Math.min(currentPage.value, Math.max(1, totalPages.value)));
        if (queue.value.length === 0 && currentPage.value > 1) {
            await refreshQueuePage(currentPage.value - 1);
            currentPage.value -= 1;
        }
    } catch {
        // The recusal is already recorded; a failed queue refresh can be retried.
    }
    activeIndex.value = Math.min(activeIndex.value, Math.max(0, queue.value.length - 1));
}

async function submitReport() {
    const team = activeTeam.value;
    if (!team || reportBusy.value) return;
    const reason = reportReason.value.trim();
    if (reportKind.value === "flag" && !reason) {
        reportError.value = "Describe what the organizer should review.";
        return;
    }

    const kind = reportKind.value;
    reportBusy.value = true;
    reportError.value = null;
    try {
        if (kind === "flag") {
            await sendFlag(team.id, reason);
            toast.add({
                color: "success",
                title: "Flagged for the organizer",
                description: "The organizers can review this project and your note.",
            });
        } else {
            await apiFetch("/api/judging/recusals", {
                method: "POST",
                body: { team_id: team.id, reason: reason || undefined },
            });
            toast.add({
                color: "success",
                title: "Recusal recorded",
                description: "This project was removed from your judging queue.",
            });
            await dropRecusedProject(team.id);
            void summaryFetch.refresh();
        }
        reportOpen.value = false;
    } catch (e) {
        reportError.value = isEndpointUnavailable(e)
            ? `${reportTitle.value} is not enabled on this deployment.`
            : getErrorMessage(e);
        toast.add({
            color: "error",
            title: kind === "flag" ? "Could not flag the project" : "Could not record the recusal",
            description: reportError.value,
        });
    } finally {
        reportBusy.value = false;
    }
}

async function recordFinalizedEvaluation(team: { id: number }) {
    const scores = { ...draft.state.scores };
    const reasoning = draft.state.reasoning;

    finalized.value = {
        ...finalized.value,
        [team.id]: { scores, reasoning },
    };
    queuePages.value = {
        ...queuePages.value,
        [currentPage.value]: queue.value.map((item, index) =>
            index === activeIndex.value
                ? { ...item, evaluated: true, evaluation: { scores, reasoning } }
                : item,
        ),
    };
    scoredCount.value = Math.min(submittedCount.value, scoredCount.value + 1);

    try {
        await draft.clear(team.id);
    } catch {
        toast.add({
            color: "warning",
            title: "Evaluation submitted",
            description: "Your score is final, but the saved draft could not be cleared.",
        });
    }

    step.value = "score";
    // The committed row is the source of truth for the evaluated flag and the
    // progress counter; re-read both so a stale cached page cannot report a
    // scored project as unscored (or hide the next-unscored jump).
    void summaryFetch.refresh();
    await refreshQueuePage(currentPage.value).catch(() => undefined);
    return focusNextPending(currentPage.value, activeIndex.value + 1);
}

async function finalizeEvaluation() {
    const team = activeTeam.value;
    if (!team || submitting.value || activeFinalized.value) return;

    submitting.value = true;
    try {
        await draft.flush();
        await apiFetch(`/api/teams/${team.id}/scores`, {
            method: "POST",
            body: {
                scores: { ...draft.state.scores },
                reasoning: draft.state.reasoning,
                rubric_version_id: draft.rubricVersionId.value,
            },
        });

        const foundNext = await recordFinalizedEvaluation(team);
        if (!foundNext && !navigationError.value) {
            toast.add({ color: "success", title: "Evaluation submitted" });
        }
    } catch (error) {
        const message = getErrorMessage(error);
        const status =
            (error as { statusCode?: number; status?: number } | null)?.statusCode ??
            (error as { status?: number } | null)?.status;
        // A committed submission whose response was lost returns 409 on retry.
        if (status === 409 || message.includes("already scored")) {
            const foundNext = await recordFinalizedEvaluation(team);
            toast.add({
                color: "success",
                title: "Evaluation already recorded",
                description: "The server had already saved this evaluation.",
            });
            if (foundNext) submissionError.value = null;
            return;
        }
        submissionError.value = message;
        toast.add({
            color: "error",
            title: "Could not submit evaluation",
            description: message,
        });
    } finally {
        submitting.value = false;
    }
}

function retryQueue() {
    navigationError.value = null;
    void Promise.allSettled([queueFetch.refresh(), summaryFetch.refresh(), rubricFetch.refresh()]);
}

const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
    if (!draft.dirty.value && draft.status.value !== "saving") return;
    event.preventDefault();
    event.returnValue = "";
};

onMounted(() => window.addEventListener("beforeunload", warnBeforeLeaving));
onBeforeUnmount(() => window.removeEventListener("beforeunload", warnBeforeLeaving));
onBeforeRouteLeave(async () => {
    if (!draft.dirty.value && draft.status.value !== "saving") return true;
    try {
        await draft.flush();
        return true;
    } catch {
        toast.add({
            color: "error",
            title: "Draft not saved",
            description: "Retry saving your work before leaving this page.",
        });
        return false;
    }
});
</script>

<template>
    <div class="judging-workspace" :aria-busy="navigating || submitting">
        <h1 class="sr-only">Judge projects</h1>

        <UAlert
            v-if="queueError"
            color="error"
            icon="i-lucide-circle-alert"
            title="Could not load the judging queue"
            :description="getErrorMessage(queueError)"
            class="m-4 sm:m-6"
        >
            <template #actions>
                <UButton class="min-h-11" variant="outline" @click="retryQueue">Try again</UButton>
            </template>
        </UAlert>

        <div v-else-if="isLoading" class="p-4 sm:p-6" aria-live="polite">
            <p class="font-semibold">Loading your judging queue…</p>
            <p class="mt-1 text-sm text-muted">
                Your project descriptions and saved draft are on their way.
            </p>
        </div>

        <div v-else-if="totalProjects === 0" class="p-4 sm:p-6">
            <UIcon name="i-lucide-inbox" class="mb-3 size-8 text-primary" aria-hidden="true" />
            <h2 class="text-2xl font-bold">No submitted projects yet</h2>
            <p class="mt-2 max-w-prose text-muted">
                Projects appear here as soon as teams submit them. This page updates when you
                reload.
            </p>
            <UButton to="/judging" class="mt-5 min-h-11">Back to judging overview</UButton>
        </div>

        <template v-else-if="activeTeam">
            <div class="judging-workspace-body">
                <div class="judging-toolbar">
                    <div class="min-w-0">
                        <p class="truncate text-sm text-muted">{{ activeTeam.name }}</p>
                        <p class="font-semibold">
                            Project {{ activeProjectNumber }} of {{ totalProjects }}
                            <span v-if="summaryFailed" class="ml-2 text-sm font-normal text-muted">
                                Progress summary unavailable
                            </span>
                            <span v-else class="ml-2 text-sm font-normal text-muted">
                                {{ scoredCount }} evaluated
                            </span>
                        </p>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <UButton
                            v-if="summaryFailed"
                            variant="ghost"
                            icon="i-lucide-refresh-cw"
                            class="min-h-11"
                            @click="() => summaryFetch.refresh()"
                        >
                            Retry progress
                        </UButton>
                        <UButton
                            v-if="hasPendingProjects"
                            variant="soft"
                            icon="i-lucide-skip-forward"
                            class="min-h-11"
                            :disabled="navigating || submitting"
                            @click="jumpToNextPending"
                        >
                            Next unscored
                        </UButton>
                        <UButton
                            variant="outline"
                            icon="i-lucide-layout-grid"
                            class="min-h-11"
                            @click="openNavigator"
                        >
                            All projects
                        </UButton>
                        <UButton
                            variant="ghost"
                            icon="i-lucide-flag"
                            class="min-h-11"
                            :disabled="navigating || submitting"
                            @click="openReport('flag')"
                        >
                            Flag for organizer
                        </UButton>
                        <UButton
                            v-if="!activeFinalized"
                            variant="ghost"
                            icon="i-lucide-user-x"
                            class="min-h-11"
                            :disabled="navigating || submitting"
                            @click="openReport('recusal')"
                        >
                            Recuse me
                        </UButton>
                        <UButton
                            variant="outline"
                            icon="i-lucide-arrow-left"
                            class="min-h-11"
                            aria-label="Previous project"
                            :disabled="activeProjectNumber <= 1 || submitting || navigating"
                            @click="openPreviousProject"
                        >
                            Previous
                        </UButton>
                        <UButton
                            trailing-icon="i-lucide-arrow-right"
                            class="min-h-11"
                            aria-label="Next project"
                            :disabled="
                                activeProjectNumber >= totalProjects || submitting || navigating
                            "
                            @click="openNextProject"
                        >
                            Next
                        </UButton>
                    </div>
                </div>

                <UAlert
                    v-if="!summaryFailed && !hasPendingProjects"
                    color="success"
                    variant="subtle"
                    icon="i-lucide-circle-check-big"
                    title="Every submitted project has an evaluation"
                    description="You can still open any project to review the scores and feedback you saved."
                    class="mx-4 mt-3 sm:mx-6"
                />

                <div v-if="activeTrack" class="judging-split-host">
                    <JudgingCard
                        :key="`score-${activeTeam.id}`"
                        :team="activeTeam"
                        :track="activeTrack"
                        :comment-guidance="activeCommentGuidance"
                        :comment-identity-error="commentIdentityError"
                        :scores="displayScores"
                        :reasoning="displayReasoning"
                        :draft-status="activeFinalized ? 'saved' : draftStatus"
                        :draft-error="activeFinalized ? null : draftErrorMessage"
                        :draft-ready="Boolean(activeFinalized) || draftLoaded"
                        :draft-saved-at="activeFinalized ? null : draftLastSavedAt"
                        :read-only="Boolean(activeFinalized)"
                        @score="updateScore"
                        @reasoning="updateReasoning"
                        @retry="retryDraft"
                        @discard="discardDraft"
                        @review="openReview"
                    />
                </div>
                <div v-else class="p-4 sm:p-6">
                    <UAlert
                        color="error"
                        icon="i-lucide-triangle-alert"
                        title="This project cannot be scored yet"
                        description="Its judging track is missing from the active rubric. Contact an organizer so your work is not recorded incorrectly."
                    />
                </div>
            </div>

            <JudgingReview
                v-if="activeTrack"
                :open="step === 'review'"
                :team="activeTeam"
                :track="activeTrack"
                :submit-error="submissionError"
                :scores="displayScores"
                :reasoning="displayReasoning"
                :submitting="submitting"
                @close="returnToScoring"
                @close-auto-focus="restoreReviewFocus"
                @finalize="finalizeEvaluation"
            />

            <UModal v-model:open="reportOpen" :title="reportTitle" :dismissible="!reportBusy">
                <template #body>
                    <p class="mb-4 text-sm text-muted">
                        {{
                            reportKind === "flag"
                                ? `Tell the organizers what needs a closer look in ${activeTeam.project.name || activeTeam.name}. Your note is visible only to organizers.`
                                : `Declare a conflict of interest so ${activeTeam.project.name || activeTeam.name} leaves your queue. A reason is optional and visible only to organizers.`
                        }}
                    </p>
                    <UFormField
                        label="Reason"
                        :help="
                            reportKind === 'flag'
                                ? 'Required. Describe the issue the organizers should review.'
                                : 'Optional. Explain the conflict if it is not obvious.'
                        "
                    >
                        <UTextarea
                            v-model="reportReason"
                            :rows="4"
                            maxlength="500"
                            class="w-full"
                            :disabled="reportBusy"
                        />
                    </UFormField>
                    <UAlert
                        v-if="reportError"
                        color="error"
                        variant="subtle"
                        :title="reportError"
                        class="mt-3"
                    />
                </template>
                <template #footer>
                    <UButton
                        class="min-h-11"
                        :color="reportKind === 'flag' ? 'warning' : 'error'"
                        :loading="reportBusy"
                        :disabled="reportBusy"
                        @click="submitReport"
                    >
                        {{ reportKind === "flag" ? "Send flag" : "Record recusal" }}
                    </UButton>
                    <UButton
                        variant="outline"
                        class="min-h-11"
                        :disabled="reportBusy"
                        @click="reportOpen = false"
                    >
                        Cancel
                    </UButton>
                </template>
            </UModal>
        </template>

        <div v-else class="p-4 sm:p-6">
            <p class="text-muted">No project is selected.</p>
            <UButton class="mt-3 min-h-11" @click="openNavigator">Choose a project</UButton>
        </div>

        <USlideover
            v-model:open="navigatorOpen"
            title="All projects"
            description="Jump to any project in this season's judging queue."
            side="right"
            :ui="{ content: 'sm:max-w-md' }"
        >
            <template #body>
                <p v-if="summaryFailed" class="mb-3 text-sm text-muted">
                    Your progress summary could not be loaded. Scored projects are still marked from
                    the queue.
                </p>
                <p v-else class="mb-3 text-sm text-muted">
                    {{ scoredCount }} of {{ submittedCount }} submitted projects evaluated.
                </p>
                <div class="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter projects">
                    <UButton
                        v-for="filter in navigatorFilters"
                        :key="filter.value"
                        size="sm"
                        class="min-h-11"
                        :variant="navigatorFilter === filter.value ? 'solid' : 'outline'"
                        @click="navigatorFilter = filter.value"
                    >
                        {{ filter.label }}
                    </UButton>
                </div>

                <UAlert
                    v-if="navigatorError"
                    color="error"
                    icon="i-lucide-circle-alert"
                    title="Could not load every project"
                    :description="getErrorMessage(navigatorError)"
                >
                    <template #actions>
                        <UButton class="min-h-11" variant="outline" @click="loadAllQueuePages">
                            Try again
                        </UButton>
                    </template>
                </UAlert>

                <p
                    v-else-if="navigatorLoading"
                    class="rounded-lg border border-default p-3 text-sm text-muted"
                    aria-live="polite"
                >
                    Loading every project…
                </p>

                <template v-else>
                    <section v-for="group in navigatorVisiblePages" :key="group.page" class="mb-4">
                        <h3 class="mb-2 text-sm font-semibold text-muted">
                            Page {{ group.page }} of {{ totalPages }}
                        </h3>
                        <ul class="space-y-2">
                            <li v-for="entry in group.items" :key="entry.item.team.id">
                                <button
                                    type="button"
                                    class="flex min-h-11 w-full items-center gap-3 rounded-lg border p-2 text-left transition"
                                    :class="
                                        entry.item.team.id === activeTeam?.id
                                            ? 'border-primary bg-primary/10'
                                            : 'border-default hover:bg-elevated'
                                    "
                                    @click="jumpToProject(group.page, entry.index)"
                                >
                                    <span
                                        class="flex size-8 shrink-0 items-center justify-center rounded-md border border-default text-sm font-semibold tabular-nums"
                                    >
                                        {{ (group.page - 1) * queuePageSize + entry.index + 1 }}
                                    </span>
                                    <span class="min-w-0 flex-1">
                                        <span class="block truncate font-medium">
                                            {{ entry.item.team.project.name }}
                                        </span>
                                        <span class="block truncate text-sm text-muted">
                                            {{ entry.item.team.name }}
                                        </span>
                                    </span>
                                    <UIcon
                                        :name="
                                            entry.item.evaluated
                                                ? 'i-lucide-circle-check'
                                                : 'i-lucide-circle-dashed'
                                        "
                                        class="size-5 shrink-0"
                                        :class="
                                            entry.item.evaluated ? 'text-success' : 'text-muted'
                                        "
                                        aria-hidden="true"
                                    />
                                    <span class="sr-only">
                                        {{ entry.item.evaluated ? "Evaluated" : "Not evaluated" }}
                                    </span>
                                </button>
                            </li>
                        </ul>
                    </section>
                    <p
                        v-if="navigatorVisiblePages.length === 0"
                        class="rounded-lg border border-default p-3 text-sm text-muted"
                    >
                        No projects match this filter.
                    </p>
                </template>
            </template>
        </USlideover>
    </div>
</template>

<style scoped>
.judging-workspace {
    min-width: 0;
}

.judging-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    border-block-end: 1px solid var(--ui-border);
}

@media (min-width: 48rem) {
    .judging-workspace-body {
        display: flex;
        flex-direction: column;
        height: calc(100dvh - var(--ui-header-height));
        min-height: 16rem;
    }

    .judging-split-host {
        flex: 1 1 auto;
        min-height: 0;
    }
}

@media (prefers-reduced-motion: reduce) {
    .judging-workspace :deep(*) {
        scroll-behavior: auto;
    }
}
</style>
