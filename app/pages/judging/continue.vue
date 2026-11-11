<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import JudgingCard from "~/components/JudgingCard.vue";
import JudgingReview from "~/components/JudgingReview.vue";
import { useJudgingDraft } from "~/composables/useJudgingDraft";
import type { RubricDefinition } from "~~/shared/rubric";
import { NethackPermissions } from "~~/shared/permissions";

interface JudgingRubric extends RubricDefinition {
    version_id: number;
}

interface FinalizedEvaluation {
    scores: Record<string, number>;
    reasoning: string;
}

definePageMeta({
    middleware: ["auth"],
});

const { data: hackathon } = await useFetch("/api/seasons/active");
if (hackathon.value?.status !== "voting") {
    throw await navigateTo("/");
}

const { error: userError } = await useApiUser();
const { can } = useNethackPermissions();
if (userError.value) throw userError.value;
if (!can(NethackPermissions.Judging.assignmentsRead)) {
    throw await navigateTo("/");
}

const queuePageSize = 20;
const [queueFetch, summaryFetch, rubricFetch] = await Promise.all([
    useFetch<GetJudgingQueueResponse>(`/api/teams?judging=true&page=1&page_size=${queuePageSize}`, {
        server: false,
    }),
    useFetch<GetBallotSummaryResponse>("/api/ballot/summary", { server: false }),
    useFetch<JudgingRubric>("/api/judging/rubric", { server: false }),
]);

const queuePages = shallowRef<Record<number, JudgeQueueItem[]>>({});
const totalProjects = shallowRef(0);
const totalPages = shallowRef(0);
const navigationError = shallowRef<unknown>(null);
const currentPage = shallowRef(1);
const activeIndex = shallowRef(0);
const navigating = shallowRef(false);
const step = shallowRef<"score" | "review">("score");
const submitting = shallowRef(false);
const finalized = shallowRef<Record<number, FinalizedEvaluation>>({});
const scoredCount = shallowRef(0);
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
const activeFinalized = computed(() =>
    activeTeam.value
        ? (finalized.value[activeTeam.value.id] ?? activeItem.value?.evaluation ?? null)
        : null,
);
const displayScores = computed(() => activeFinalized.value?.scores ?? draft.state.scores);
const displayReasoning = computed(() => activeFinalized.value?.reasoning ?? draft.state.reasoning);
const submittedCount = computed(() => currentSummary.value?.submitted_count ?? 0);
const progressValue = computed(() =>
    submittedCount.value > 0
        ? Math.min(100, Math.round((scoredCount.value / submittedCount.value) * 100))
        : 0,
);
const queueError = computed(
    () =>
        navigationError.value ||
        queueFetch.error.value ||
        summaryFetch.error.value ||
        rubricFetch.error.value,
);
const isLoading = computed(
    () =>
        queueFetch.status.value === "idle" ||
        queueFetch.status.value === "pending" ||
        summaryFetch.status.value === "idle" ||
        summaryFetch.status.value === "pending" ||
        rubricFetch.status.value === "idle" ||
        rubricFetch.status.value === "pending",
);
const activeProjectNumber = computed(
    () => (currentPage.value - 1) * queuePageSize + activeIndex.value + 1,
);
const hasPendingProjects = computed(
    () => submittedCount.value > 0 && scoredCount.value < submittedCount.value,
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
        if (firstPending < 0 && hasPendingProjects.value) void focusNextPending(1, 0);
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

    const response = await $fetch<GetJudgingQueueResponse>("/api/teams", {
        query: { judging: true, page, page_size: queuePageSize },
    });
    queuePages.value = { ...queuePages.value, [page]: response.items };
    totalProjects.value = response.total;
    totalPages.value = response.total_pages;
    return response.items;
}

async function openPage(page: number, index: number) {
    if (navigating.value || page < 1 || page > totalPages.value) return;

    navigating.value = true;
    try {
        if (!(await saveCurrentDraftBeforeNavigation())) return;
        navigationError.value = null;
        const pageItems = await getQueuePage(page);
        const targetIndex = index < 0 ? pageItems.length - 1 : index;
        if (targetIndex < 0 || targetIndex >= pageItems.length) return;
        currentPage.value = page;
        activeIndex.value = targetIndex;
    } catch (error) {
        navigationError.value = error;
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
    for (let page = startPage; page <= totalPages.value; page += 1) {
        try {
            const pageItems = await getQueuePage(page);
            const index = pageItems.findIndex(
                (item, itemIndex) =>
                    (page > startPage || itemIndex >= startIndex) && !item.evaluated,
            );
            if (index >= 0) {
                currentPage.value = page;
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

async function openReview() {
    try {
        await draft.flush();
        step.value = "review";
    } catch {
        toast.add({
            color: "error",
            title: "Draft not saved",
            description: "Retry saving your work before reviewing it.",
        });
    }
}

async function finalizeEvaluation() {
    const team = activeTeam.value;
    if (!team || submitting.value || activeFinalized.value) return;

    submitting.value = true;
    try {
        await draft.flush();
        await $fetch(`/api/teams/${team.id}/scores`, {
            method: "POST",
            body: {
                scores: { ...draft.state.scores },
                reasoning: draft.state.reasoning,
                rubric_version_id: draft.rubricVersionId.value,
            },
        });

        finalized.value = {
            ...finalized.value,
            [team.id]: {
                scores: { ...draft.state.scores },
                reasoning: draft.state.reasoning,
            },
        };
        queuePages.value = {
            ...queuePages.value,
            [currentPage.value]: queue.value.map((item, index) =>
                index === activeIndex.value
                    ? {
                          ...item,
                          evaluated: true,
                          evaluation: {
                              scores: { ...draft.state.scores },
                              reasoning: draft.state.reasoning,
                          },
                      }
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
        const foundNext = await focusNextPending(currentPage.value, activeIndex.value + 1);
        if (!foundNext && !navigationError.value) {
            toast.add({ color: "success", title: "Evaluation submitted" });
        }
    } catch (error) {
        toast.add({
            color: "error",
            title: "Could not submit evaluation",
            description: getErrorMessage(error),
        });
    } finally {
        submitting.value = false;
    }
}

function retryQueue() {
    navigationError.value = null;
    void Promise.all([queueFetch.refresh(), summaryFetch.refresh(), rubricFetch.refresh()]);
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
    <main
        class="judging-workspace mx-auto mt-4 w-full max-w-4xl pb-8"
        :aria-busy="navigating || submitting"
    >
        <header class="mb-5">
            <NuxtLink
                to="/judging"
                class="inline-flex min-h-11 items-center gap-2 text-sm text-muted hover:text-primary"
            >
                <UIcon name="i-lucide-arrow-left" aria-hidden="true" />
                Judging overview
            </NuxtLink>
            <h1 class="mt-3 text-3xl font-bold text-primary glow sm:text-4xl">Judge projects</h1>
            <p class="mt-2 max-w-prose text-muted">
                Review one submission at a time. Your draft is saved automatically, and you can move
                between pages without losing your place or your work.
            </p>
        </header>

        <section
            v-if="currentSummary && currentSummary.submitted_count > 0"
            class="mb-5 rounded-xl border border-default bg-elevated p-4"
            aria-label="Your evaluation progress"
        >
            <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p class="font-semibold">Your progress</p>
                <p class="text-sm text-muted">
                    <span class="font-semibold text-primary">{{ scoredCount }}</span>
                    of {{ currentSummary.submitted_count }} projects evaluated
                </p>
            </div>
            <div
                class="mt-3 h-2 overflow-hidden rounded-full bg-muted/20"
                role="progressbar"
                :aria-valuenow="scoredCount"
                :aria-valuemin="0"
                :aria-valuemax="currentSummary.submitted_count"
                :aria-label="`${scoredCount} of ${currentSummary.submitted_count} projects evaluated`"
            >
                <div
                    class="h-full rounded-full bg-primary transition-[width]"
                    :style="{ width: `${progressValue}%` }"
                />
            </div>
        </section>

        <UAlert
            v-if="queueError"
            color="error"
            icon="i-lucide-circle-alert"
            title="Could not load the judging queue"
            :description="getErrorMessage(queueError)"
            class="mb-5"
        >
            <template #actions>
                <UButton class="min-h-11" variant="outline" @click="retryQueue">Try again</UButton>
            </template>
        </UAlert>

        <div v-else-if="isLoading" class="rounded-xl border border-default p-6" aria-live="polite">
            <p class="font-semibold">Loading your judging queue…</p>
            <p class="mt-1 text-sm text-muted">
                Your project descriptions and saved draft are on their way.
            </p>
        </div>

        <div
            v-else-if="!hasPendingProjects || totalProjects === 0"
            class="rounded-2xl border border-default bg-elevated p-6 sm:p-8"
        >
            <UIcon
                name="i-lucide-party-popper"
                class="mb-3 size-8 text-primary"
                aria-hidden="true"
            />
            <h2 class="text-2xl font-bold">You are all caught up</h2>
            <p class="mt-2 max-w-prose text-muted">
                There are no projects waiting for your evaluation. Your progress will update if more
                submissions become available.
            </p>
            <UButton to="/judging" class="mt-5 min-h-11">Back to judging overview</UButton>
        </div>

        <template v-else-if="activeTeam">
            <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
                <p class="font-semibold tabular-nums" aria-live="polite">
                    Project {{ activeProjectNumber }} of {{ totalProjects }}
                    <span class="text-sm font-normal text-muted">
                        · Page {{ currentPage }} of {{ totalPages }}
                    </span>
                </p>
                <div class="flex gap-2">
                    <UButton
                        variant="outline"
                        icon="i-lucide-arrow-left"
                        class="min-h-11"
                        aria-label="Previous project"
                        :disabled="activeProjectNumber <= 1 || submitting || navigating"
                        @click="openPreviousProject"
                    >
                        <span class="hidden sm:inline">Previous</span>
                    </UButton>
                    <UButton
                        variant="outline"
                        trailing-icon="i-lucide-arrow-right"
                        class="min-h-11"
                        aria-label="Next project"
                        :disabled="activeProjectNumber >= totalProjects || submitting || navigating"
                        @click="openNextProject"
                    >
                        <span class="hidden sm:inline">Next</span>
                    </UButton>
                </div>
            </div>

            <UAlert
                v-if="!activeTrack"
                color="error"
                icon="i-lucide-triangle-alert"
                title="This project cannot be scored yet"
                description="Its judging track is missing from the active rubric. Contact an organizer so your work is not recorded incorrectly."
                class="mb-4"
            />

            <JudgingReview
                v-else-if="step === 'review' && !activeFinalized"
                :key="`review-${activeTeam.id}`"
                :team="activeTeam"
                :track="activeTrack"
                :scores="displayScores"
                :reasoning="displayReasoning"
                :submitting="submitting"
                @back="step = 'score'"
                @finalize="finalizeEvaluation"
            />

            <JudgingCard
                v-else-if="activeTrack"
                :key="`score-${activeTeam.id}`"
                :team="activeTeam"
                :track="activeTrack"
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
                @review="openReview"
            />
        </template>
    </main>
</template>

<style scoped>
.judging-workspace {
    min-width: 0;
}

@media (prefers-reduced-motion: reduce) {
    .judging-workspace :deep(*) {
        scroll-behavior: auto;
    }
}
</style>
