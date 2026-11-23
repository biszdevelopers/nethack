<script setup lang="ts">
import { apiFetch } from "~~/app/composables/useApiFetch";
import { WEBSITE_NAME } from "~/utils/consts";
import { formatDateTime } from "~/utils/datetime";
import { NethackPermissions } from "~~/shared/permissions";
import type { FormSubmitEvent } from "@nuxt/ui";
import { SubmitVoteRequest, MAX_REASONING_LENGTH } from "~~/shared/schemas";

type VotingSeason = {
    status?: string;
    is_voting_open?: boolean;
    voting_start_timestamp?: number;
    voting_end_timestamp?: number;
    results_published?: number | boolean | null;
};

definePageMeta({
    middleware: ["auth"],
});

const toast = useToast();
const { can } = useNethackPermissions();
useHead({ title: `Peer voting | ${WEBSITE_NAME}` });

const { data: season } = await useApiFetch<VotingSeason>("/api/seasons/active");
const votingAvailable = computed(() => Boolean(season.value?.is_voting_open));

const { data, error, status, refresh } = await useApiFetch<GetBallotResponse>("/api/ballot", {
    immediate: votingAvailable.value,
});

const loading = computed(
    () => votingAvailable.value && (status.value === "pending" || status.value === "idle"),
);
const canSubmitVotes = computed(() => can(NethackPermissions.Voting.submitOwn));

const fetchError = computed(() => (error.value ? getErrorMessage(error.value) : null));

const closedMessage = computed(() => {
    const current = season.value?.status;
    const start = Number(season.value?.voting_start_timestamp ?? 0);
    if (current === "finished") return "The hackathon has ended. Peer voting is closed.";
    if (current === "voting") {
        if (start > 0 && start > Date.now()) {
            return `Peer voting has not opened yet. It starts ${formatDateTime(start)}.`;
        }
        return "Peer voting for this season has closed.";
    }
    if (current === "paused")
        return "The event is paused. Peer voting will return with the schedule.";
    return "Peer voting has not opened yet. Check the schedule for the start time.";
});

const projects = computed(() => data.value?.projects ?? []);
const submitted = computed(() => data.value?.submitted ?? false);
const submitting = ref(false);
const maxScoredProjects = computed(() => data.value?.max_votes_per_user ?? 0);

const state = reactive<SubmitVoteRequest>({
    scores: [],
    reasoning: "",
});

const totalStars = computed(() => state.scores.reduce((a, b) => a + b, 0));
const scoredProjectCount = computed(() => state.scores.filter((score) => score > 0).length);
const atScoredProjectLimit = computed(
    () => maxScoredProjects.value > 0 && scoredProjectCount.value >= maxScoredProjects.value,
);
const overScoredProjectLimit = computed(
    () => maxScoredProjects.value > 0 && scoredProjectCount.value > maxScoredProjects.value,
);
const capBlocksFullBallot = computed(
    () => maxScoredProjects.value > 0 && maxScoredProjects.value * 5 < 10,
);

watch(
    data,
    (ballot) => {
        if (!ballot) return;
        state.scores = [...ballot.scores];
        state.reasoning = ballot.reasoning ?? "";
    },
    { immediate: true, flush: "sync" },
);

function decrement(index: number) {
    state.scores[index] = Math.max(0, (state.scores[index] ?? 0) - 1);
}

function increment(index: number) {
    state.scores[index] = Math.min(5, (state.scores[index] ?? 0) + 1);
}

async function onSubmit(event: FormSubmitEvent<SubmitVoteRequest>) {
    if (submitting.value || !canSubmitVotes.value) return;
    const prompt = submitted.value
        ? "Replace your previous ballot with these scores?"
        : "Submit this ballot? You can update it until voting closes.";
    if (!confirm(prompt)) return;

    submitting.value = true;
    try {
        await withLoadingIndicator(async () => {
            const res: any = await apiFetch(`/api/ballot`, {
                method: "POST",
                body: event.data,
            });
            await refresh();
            toast.add({
                color: "success",
                title: res.message,
            });
        });
    } catch (e) {
        toast.add({
            color: "error",
            title: "Failed to submit vote",
            description: getErrorMessage(e),
        });
    } finally {
        submitting.value = false;
    }
}
</script>

<template>
    <div class="mt-4">
        <h1 class="text-4xl text-primary bold glow mb-4">Peer voting</h1>

        <UAlert
            v-if="!votingAvailable"
            color="neutral"
            variant="subtle"
            icon="i-lucide-info"
            title="Peer voting is closed"
            :description="closedMessage"
            class="mb-4"
        >
            <template #actions>
                <UButton
                    v-if="season?.results_published"
                    to="/results"
                    variant="outline"
                    class="min-h-11"
                >
                    View results
                </UButton>
                <UButton to="/" variant="ghost" class="min-h-11">Back to home</UButton>
            </template>
        </UAlert>

        <UAlert
            v-else-if="fetchError"
            color="error"
            variant="subtle"
            icon="i-material-symbols-error-rounded"
            title="Voting is not available"
            :description="fetchError"
            class="mb-4"
        >
            <template #actions>
                <UButton variant="outline" class="min-h-11" @click="() => refresh()">
                    Try again
                </UButton>
                <UButton to="/" variant="ghost" class="min-h-11">Back to home</UButton>
            </template>
        </UAlert>

        <div
            v-else-if="loading"
            class="rounded-xl border border-default p-4 text-sm text-muted"
            aria-live="polite"
        >
            Loading your ballot…
        </div>

        <template v-else>
            <p>Look through all the projects below.</p>

            <p>
                Your ballot lists submitted projects from your own pathway, excluding your own team.
                You have a total of 10 stars to distribute, with a maximum of 5 stars per project.
                Therefore your stars are RARE so vote wisely!
            </p>

            <p>
                Please make sure to provide reasoning for your votes to show love and support! You
                do not have to provide reasoning for all the projects.
            </p>

            <div class="my-4">
                <template v-for="(team, index) in projects" :key="team.id">
                    <VotingProjectCard
                        :team="team"
                        :score="state.scores[index] ?? 0"
                        :can-increment="
                            !submitting &&
                            (state.scores[index] ?? 0) < 5 &&
                            totalStars < 10 &&
                            ((state.scores[index] ?? 0) > 0 || !atScoredProjectLimit)
                        "
                        :can-decrement="!submitting && (state.scores[index] ?? 0) > 0"
                        @increment="increment(index)"
                        @decrement="decrement(index)"
                    />
                </template>

                <p v-if="projects.length === 0" class="text-muted">
                    No eligible projects to vote on.
                </p>
            </div>

            <UAlert
                v-if="projects.length === 1"
                color="neutral"
                variant="subtle"
                title="Not enough projects to vote on"
                description="Peer voting needs at least two eligible projects so 10 stars can be distributed."
                class="my-4"
            />

            <UAlert
                v-if="!canSubmitVotes"
                color="neutral"
                variant="subtle"
                icon="i-lucide-lock"
                title="Your ballot is read-only"
                description="Your account does not have the Voting.submitOwn permission, so you can review the projects but cannot submit a ballot."
                class="my-4"
            />

            <h2 class="text-2xl mb-4 bold">Summary</h2>

            <UForm
                v-if="projects.length >= 2"
                :state="state"
                :schema="SubmitVoteRequest"
                :disabled="submitting"
                @submit="onSubmit"
            >
                <UCard variant="subtle">
                    <p v-if="submitted" class="mb-4 bold">
                        You have voted. You can update your ballot until voting closes.
                    </p>

                    <p class="flex items-center gap-2 mb-4">
                        Total stars:
                        <UIcon
                            name="i-material-symbols-star-rate"
                            size="1.2em"
                            class="text-yellow-300"
                        />
                        {{ totalStars }} / 10
                    </p>

                    <p v-if="maxScoredProjects > 0" class="mb-4 text-sm text-muted">
                        Max projects you can score: {{ maxScoredProjects }} ({{
                            scoredProjectCount
                        }}
                        scored so far). Your cap does not change the total-10-star rule.
                    </p>
                    <UAlert
                        v-if="capBlocksFullBallot"
                        color="error"
                        variant="subtle"
                        class="mb-4"
                        title="Voting cannot be completed"
                        description="The organizer's cap blocks a full ballot: with this many projects you cannot distribute all 10 stars. Ask an organizer to raise the cap."
                    />
                    <UAlert
                        v-if="overScoredProjectLimit"
                        color="warning"
                        variant="subtle"
                        class="mb-4"
                        title="Too many projects have stars"
                        description="Remove stars from the extra projects before submitting."
                    />

                    <div class="mb-4">
                        <p class="text-sm text-muted mb-2">Your distribution:</p>
                        <div class="grid grid-cols-[1fr_max-content] gap-x-4 gap-y-1 items-center">
                            <template v-for="(team, index) in projects" :key="team.id">
                                <span class="text-sm">{{ team.project.name }}</span>
                                <span class="text-sm flex items-center gap-1 justify-end">
                                    <UIcon
                                        name="i-material-symbols-star-rate"
                                        size="1em"
                                        class="text-yellow-300"
                                    />
                                    {{ state.scores[index] ?? 0 }}
                                </span>
                            </template>
                        </div>
                    </div>

                    <UFormField name="reasoning" label="Your reasoning" class="mb-4">
                        <UTextarea
                            v-model="state.reasoning"
                            placeholder="Please explain your reasoning, making sure to include details about every project!"
                            class="w-full"
                            :rows="5"
                            :maxlength="MAX_REASONING_LENGTH"
                        />
                    </UFormField>

                    <UFormField>
                        <UButton
                            :disabled="
                                !canSubmitVotes ||
                                totalStars !== 10 ||
                                projects.length === 0 ||
                                submitting ||
                                capBlocksFullBallot ||
                                overScoredProjectLimit
                            "
                            :loading="submitting"
                            class="min-h-11"
                            type="submit"
                        >
                            {{ submitted ? "Update vote" : "Submit" }}
                        </UButton>
                    </UFormField>
                </UCard>
            </UForm>
        </template>
    </div>
</template>
