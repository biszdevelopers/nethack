<script setup lang="ts">
useHead({ title: `Results | ${WEBSITE_NAME}` });

definePageMeta({
    layout: "dashboard",
    middleware: ["auth"],
});

const { user, error, status, refresh } = await useApiUser({ lazy: true });

const loading = computed(() => status.value === "idle" || status.value === "pending");
const currentTeam = computed(() => user.value?.team ?? null);
const pastTeams = computed(() => user.value?.past_teams ?? []);
const hasCertificate = (team: { rank?: number | null; awards: unknown[] }) =>
    (team.rank !== null && team.rank !== undefined) || team.awards.length > 0;
</script>

<template>
    <div>
        <h1 class="text-3xl sm:text-4xl bold text-primary glow">Results</h1>

        <USeparator class="my-6" />

        <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="Results could not be loaded"
            :description="getErrorMessage(error)"
            class="mb-4"
        >
            <template #actions>
                <UButton
                    variant="outline"
                    class="min-h-11"
                    :loading="loading"
                    @click="() => refresh()"
                >
                    Try again
                </UButton>
            </template>
        </UAlert>

        <div
            v-else-if="loading"
            class="rounded-xl border border-default p-4 text-sm text-muted"
            aria-live="polite"
        >
            Loading your results…
        </div>

        <template v-else>
            <h2 class="text-2xl bold">Current Results</h2>

            <div v-if="currentTeam" class="mt-4">
                <ScoreCard :team="currentTeam" />
                <ULink
                    v-if="hasCertificate(currentTeam)"
                    :to="`/certificate/${currentTeam.id}`"
                    class="mt-2 inline-flex min-h-11 items-center gap-1 text-sm"
                >
                    <UIcon name="i-lucide-award" />
                    View certificate
                </ULink>
            </div>
            <p v-else class="text-muted">
                You do not have a current-season team, so there are no scores to show.
            </p>

            <USeparator class="my-6" />

            <h2 class="text-2xl bold">Past Seasons</h2>

            <div v-if="pastTeams.length > 0" class="mt-4 flex flex-col gap-4">
                <div v-for="team in pastTeams" :key="team.id">
                    <ScoreCard :team="team" />
                    <ULink
                        v-if="hasCertificate(team)"
                        :to="`/certificate/${team.id}`"
                        class="mt-2 inline-flex min-h-11 items-center gap-1 text-sm"
                    >
                        <UIcon name="i-lucide-award" />
                        View certificate
                    </ULink>
                </div>
            </div>
            <p v-else class="text-muted">No past-season results on this account yet.</p>
        </template>
    </div>
</template>
