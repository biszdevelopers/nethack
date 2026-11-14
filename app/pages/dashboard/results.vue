<template>
    <h1 class="text-3xl sm:text-4xl bold text-primary glow">Results</h1>

    <USeparator class="my-6" />

    <h2 class="text-2xl bold">Current Results</h2>

    <div v-if="user?.team" class="mt-4">
        <ScoreCard v-if="user?.team" :team="user.team"></ScoreCard>
    </div>
    <p v-else class="text-muted">No scores for this season!</p>

    <USeparator class="my-6" />

    <h2 class="text-2xl bold">Past Seasons</h2>

    <div
        v-if="user?.past_teams?.length && user?.past_teams?.length > 0"
        class="flex flex-col gap-4 mt-4"
    >
        <ScoreCard v-for="team in user.past_teams!" :key="team.id" :team="team"></ScoreCard>
    </div>
    <p v-else class="text-muted">No scores for past seasons!</p>
</template>

<script setup lang="ts">
useHead({ title: `Results | ${WEBSITE_NAME}` });

definePageMeta({
    layout: "dashboard",
    middleware: ["auth"],
});

const { user } = await useApiUser({ lazy: true });
</script>
