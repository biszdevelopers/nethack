<script setup lang="ts">
import JudgeProgressCard from "~/components/JudgeProgressCard.vue";
import { NethackPermissions } from "~~/shared/permissions";

useHead({ title: `Judging | ${WEBSITE_NAME}` });

definePageMeta({
    middleware: ["auth"],
});

const { data: hackathon } = await useApiFetch("/api/seasons/active", { $fetch: globalThis.$fetch });

const { error: userError } = await useApiUser();
const { can } = useNethackPermissions();
if (userError.value) throw userError.value;
if (!can(NethackPermissions.Judging.assignmentsRead)) {
    throw await navigateTo("/");
}

const {
    data: summary,
    error,
    refresh,
    status: summaryStatus,
} = await useApiFetch<GetBallotSummaryResponse>("/api/ballot/summary", {
    server: false,
    // Always re-read progress after a judge returns from the queue.
    getCachedData: () => undefined,
});

const currentSummary = computed(() => summary.value?.current ?? null);
const judgingOpen = computed(
    () => hackathon.value?.status === "voting" && Boolean(hackathon.value.judging_open),
);
const canScore = computed(() => can(NethackPermissions.Judging.scoresWriteAssigned));
const summaryLoading = computed(
    () => summaryStatus.value === "idle" || summaryStatus.value === "pending",
);
const pastEvaluations = computed(
    () => summary.value?.past.filter((season) => season.scored_count > 0) ?? [],
);
const hasRemainingProjects = computed(
    () =>
        currentSummary.value !== null &&
        currentSummary.value.scored_count < currentSummary.value.submitted_count,
);

async function openQueue() {
    await navigateTo("/judging/continue");
}
</script>

<template>
    <main class="mx-auto mt-4 w-full max-w-4xl pb-8">
        <header class="mb-6">
            <h1 class="mt-2 text-4xl font-bold text-primary glow">Judging</h1>
            <p class="mt-3 max-w-prose text-muted">
                Evaluate one project at a time, save your progress as you work, and review every
                score before final submission.
            </p>
        </header>

        <UAlert
            v-if="can(NethackPermissions.all)"
            color="neutral"
            variant="subtle"
            icon="i-lucide-shield-check"
            title="Administrator review"
            description="Open every team's judge feedback, including comments and AI-use disclosures."
            class="mb-6"
        >
            <template #actions>
                <UButton to="/developers/teams" variant="outline" class="min-h-11">
                    Open team review
                </UButton>
            </template>
        </UAlert>

        <UAlert
            v-if="error"
            color="error"
            icon="i-lucide-circle-alert"
            title="Could not load your judging progress"
            :description="getErrorMessage(error)"
            class="mb-6"
        >
            <template #actions>
                <UButton variant="outline" class="min-h-11" @click="() => refresh()">
                    Try again
                </UButton>
            </template>
        </UAlert>

        <section class="mb-8" aria-labelledby="current-evaluations-heading">
            <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 id="current-evaluations-heading" class="text-2xl font-bold">
                        Current evaluations
                    </h2>
                    <p class="mt-1 text-sm text-muted">
                        Your personal progress for the active season.
                    </p>
                </div>
                <UButton
                    v-if="judgingOpen && canScore"
                    class="min-h-11"
                    trailing-icon="i-lucide-arrow-right"
                    :disabled="!currentSummary"
                    @click="openQueue"
                >
                    {{ hasRemainingProjects ? "Continue judging" : "Open judging queue" }}
                </UButton>
                <UButton
                    v-else-if="currentSummary && currentSummary.scored_count > 0"
                    class="min-h-11"
                    variant="outline"
                    trailing-icon="i-lucide-arrow-right"
                    :to="`/judging/history/${currentSummary.season_id}`"
                >
                    Review your evaluations
                </UButton>
            </div>

            <UAlert
                v-if="!judgingOpen && currentSummary"
                color="neutral"
                variant="subtle"
                icon="i-lucide-lock-keyhole"
                title="Judging is closed for the active season"
                description="You can still read every evaluation you completed."
                class="mb-3 max-w-xl"
            />

            <div v-if="currentSummary" class="max-w-xl">
                <JudgeProgressCard :season="currentSummary" />
            </div>
            <div
                v-else-if="summaryLoading"
                class="rounded-xl border border-default p-4 text-sm text-muted"
                aria-live="polite"
            >
                Loading your judging progress…
            </div>
            <div v-else-if="!error" class="rounded-xl border border-default p-4 text-sm text-muted">
                No active season is available for judging right now.
            </div>
        </section>

        <USeparator class="my-6" />

        <section aria-labelledby="past-evaluations-heading">
            <div class="mb-3">
                <h2 id="past-evaluations-heading" class="text-2xl font-bold">Past evaluations</h2>
                <p class="mt-1 text-sm text-muted">
                    Review your completed judging progress from previous seasons.
                </p>
            </div>
            <div v-if="pastEvaluations.length" class="grid gap-3 sm:grid-cols-2">
                <NuxtLink
                    v-for="season in pastEvaluations"
                    :key="season.season_id"
                    :to="`/judging/history/${season.season_id}`"
                    class="group block rounded-xl transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary hover:ring-2 hover:ring-primary"
                >
                    <JudgeProgressCard :season="season" />
                    <span
                        class="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary"
                    >
                        View evaluations
                        <UIcon
                            name="i-lucide-arrow-right"
                            aria-hidden="true"
                            class="transition group-hover:translate-x-0.5"
                        />
                    </span>
                </NuxtLink>
            </div>
            <p v-else class="rounded-xl border border-default p-4 text-sm text-muted">
                Your completed evaluations from previous seasons will appear here.
            </p>
        </section>
    </main>
</template>
