<script setup lang="ts">
const props = defineProps<{
    id: number;
    team?: GetTeamResponse;
}>();

const { data: fetchedTeam } = await useApiFetch<GetTeamResponse>(() => "/api/teams/" + props.id, {
    immediate: !props.team,
});
const team = computed(() => props.team ?? fetchedTeam.value);

const safeRepoUrl = computed(() => safeUrl(team.value?.project.repo_url));
const safeDemoUrl = computed(() => safeUrl(team.value?.project.demo_url));
</script>

<template>
    <UCard v-if="team" :description="team.name">
        <template #header>
            <h3 v-if="team.project.name" class="text-xl bold">{{ team.project.name }}</h3>
            <h3 v-else class="text-muted">(No Project Name)</h3>
            <span class="text-sm">Team:</span>
            <span v-if="team && team.name" class="text-muted text-sm">{{ team.name }}</span>
            <span v-else class="text-muted text-sm">(No Team Name)</span>
            <div class="flex flex-row gap-2 mt-2">
                <div v-for="award in team.awards">
                    <AwardButton :award="award" size="md"></AwardButton>
                </div>
            </div>
        </template>

        <template #default>
            <SafeComark v-if="team.project.description" class="whitespace-pre-wrap">
                {{ team.project.description }}
            </SafeComark>
            <p v-else class="text-muted">(No Project Description)</p>
        </template>

        <template #footer>
            <div class="flex flex-row gap-2">
                <UTooltip :text="safeRepoUrl ?? 'Repo link not available'">
                    <UButton
                        variant="subtle"
                        icon="i-material-symbols-merge"
                        :href="safeRepoUrl"
                        external
                        target="_blank"
                        rel="noopener noreferrer"
                        :disabled="!safeRepoUrl"
                    >
                        Repo
                    </UButton>
                </UTooltip>
                <UTooltip :text="safeDemoUrl ?? 'Demo link not available'">
                    <UButton
                        variant="subtle"
                        icon="i-material-symbols-play-arrow"
                        :href="safeDemoUrl"
                        external
                        target="_blank"
                        rel="noopener noreferrer"
                        :disabled="!safeDemoUrl"
                    >
                        Demo
                    </UButton>
                </UTooltip>
            </div>
        </template>
    </UCard>
</template>
