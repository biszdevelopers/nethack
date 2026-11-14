<script setup lang="ts">
import { WEBSITE_NAME } from "~/utils/consts";
import type { FormSubmitEvent } from "@nuxt/ui";
import { SubmitVoteRequest, MAX_REASONING_LENGTH } from "~~/shared/schemas";

definePageMeta({
    middleware: ["auth"],
});

const toast = useToast();
useHead({ title: `Peer voting | ${WEBSITE_NAME}` });

const { data, error, refresh } = await useApiFetch<GetBallotResponse>("/api/ballot", {
    server: false,
});

const fetchError = computed(() => (error.value ? getErrorMessage(error.value) : null));

const projects = computed(() => data.value?.projects ?? []);
const submitted = computed(() => data.value?.submitted ?? false);

const state = reactive<SubmitVoteRequest>({
    scores: [],
    reasoning: "",
});

const totalStars = computed(() => state.scores.reduce((a, b) => a + b, 0));

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
    if (
        !confirm("Are you sure you want to submit the vote? You cannot edit them after submission.")
    )
        return;

    try {
        await withLoadingIndicator(async () => {
            const res: any = await $fetch(`/api/ballot`, {
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
    }
}
</script>

<template>
    <div class="mt-4">
        <h1 class="text-4xl text-primary bold glow mb-4">Peer voting</h1>

        <UAlert
            v-if="fetchError"
            color="error"
            variant="subtle"
            icon="i-material-symbols-error-rounded"
            title="Error loading ballot"
            :description="fetchError"
            class="mb-4"
        />

        <p>Look through all the projects below.</p>

        <p>
            You have a total of 10 stars to distribute, with a maximum of 5 stars per project.
            Therefore your stars are RARE so vote wisely!
        </p>

        <p>
            Please make sure to provide reasoning for your votes to show love and support! You do
            not have to provide reasoning for all the projects.
        </p>

        <div class="my-4">
            <template v-for="(team, index) in projects" :key="team.id">
                <VotingProjectCard
                    :team="team"
                    :score="state.scores[index] ?? 0"
                    :can-increment="!submitted && (state.scores[index] ?? 0) < 5 && totalStars < 10"
                    :can-decrement="!submitted && (state.scores[index] ?? 0) > 0"
                    @increment="increment(index)"
                    @decrement="decrement(index)"
                />
            </template>

            <p v-if="projects.length === 0" class="text-muted">No eligible projects to vote on.</p>
        </div>

        <h2 class="text-2xl mb-4 bold">Summary</h2>

        <UForm :state="state" :schema="SubmitVoteRequest" @submit="onSubmit">
            <UCard variant="subtle">
                <p v-if="submitted" class="mb-4 bold">You have voted already. Thank you!</p>

                <p class="flex items-center gap-2 mb-4">
                    Total stars:
                    <UIcon
                        name="i-material-symbols-star-rate"
                        size="1.2em"
                        class="text-yellow-300"
                    />
                    {{ totalStars }} / 10
                </p>

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
                        :disabled="submitted"
                        :maxlength="MAX_REASONING_LENGTH"
                    />
                </UFormField>

                <UFormField v-if="!submitted">
                    <UButton
                        :disabled="totalStars !== 10 || projects.length === 0"
                        class="min-h-11"
                        type="submit"
                    >
                        Submit
                    </UButton>
                </UFormField>
            </UCard>
        </UForm>
    </div>
</template>
