<script setup lang="ts">
type ProjectWithVideo = APITeam["project"] & { video_url?: string | null };

const props = defineProps<{
    id: number;
    team?: GetTeamResponse;
}>();

const {
    data: fetchedTeam,
    pending,
    error,
    refresh,
} = await useApiFetch<GetTeamResponse>(() => "/api/teams/" + props.id, {
    immediate: !props.team,
});
const team = computed(() => props.team ?? fetchedTeam.value);

const { data: seasons } = await useApiFetch<PublicSeason[]>("/api/seasons", {
    lazy: true,
    server: false,
    key: "public-seasons",
});

const project = computed(() => team.value?.project as ProjectWithVideo | undefined);
const safeRepoUrl = computed(() => safeUrl(project.value?.repo_url));
const safeDemoUrl = computed(() => safeUrl(project.value?.demo_url));
const safeVideoUrl = computed(() => safeUrl(project.value?.video_url));
const resultsPublished = computed(() => {
    const seasonID = team.value?.season_id;
    if (!seasonID) return false;
    return Boolean(seasons.value?.find((season) => season.id === seasonID)?.results_published);
});
const certificateHref = computed(() => {
    const current = team.value;
    if (!current || !resultsPublished.value) return null;
    return current.rank || current.awards.length > 0 ? `/certificate/${current.id}` : null;
});
const statusLabel = computed(() => {
    const status = team.value?.status;
    return status && status !== "active" ? status.replaceAll("_", " ") : null;
});
</script>

<template>
    <UCard v-if="team" :description="team.name">
        <template #header>
            <div class="flex flex-wrap items-start justify-between gap-2">
                <div class="min-w-0">
                    <h3 v-if="team.project.name" class="text-xl bold">
                        {{ team.project.name }}
                    </h3>
                    <h3 v-else class="text-default">(No Project Name)</h3>
                    <span class="text-sm">Team:</span>
                    <span v-if="team && team.name" class="text-default text-sm">
                        {{ team.name }}
                    </span>
                    <span v-else class="text-default text-sm">(No Team Name)</span>
                </div>
                <UBadge v-if="statusLabel" color="error" variant="subtle" class="capitalize">
                    {{ statusLabel }}
                </UBadge>
            </div>
            <div class="flex flex-row gap-2 mt-2">
                <div v-for="award in team.awards" :key="award.namespace">
                    <AwardButton :award="award" size="md" />
                </div>
            </div>
        </template>

        <template #default>
            <SafeComark v-if="team.project.description" class="whitespace-pre-wrap break-words">
                {{ team.project.description }}
            </SafeComark>
            <p v-else class="text-default">(No Project Description)</p>

            <div class="mt-4 border-t border-default pt-3">
                <p class="text-sm font-semibold text-muted">AI-use disclosure</p>
                <SafeComark
                    v-if="team.project.sourcing"
                    class="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed"
                >
                    {{ team.project.sourcing }}
                </SafeComark>
                <p v-else class="mt-1 text-sm text-muted">
                    This team did not provide an AI-use disclosure.
                </p>
            </div>
        </template>

        <template #footer>
            <div class="flex flex-wrap items-center gap-2">
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
                <UButton
                    v-if="safeVideoUrl"
                    variant="subtle"
                    icon="i-lucide-video"
                    :href="safeVideoUrl"
                    external
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Demonstration video
                </UButton>
                <UButton
                    v-if="certificateHref"
                    variant="link"
                    icon="i-lucide-award"
                    :to="certificateHref"
                >
                    Certificate
                </UButton>
            </div>
        </template>
    </UCard>
    <UCard v-else-if="pending">
        <p class="text-sm text-default" role="status">Loading project details…</p>
        <USkeleton class="mt-4 h-24 w-full" />
    </UCard>
    <UCard v-else-if="error">
        <UAlert
            color="error"
            variant="subtle"
            title="Project details could not be loaded"
            :description="getErrorMessage(error)"
        />
        <UButton class="mt-4 min-h-11" variant="subtle" @click="refresh()">Try again</UButton>
    </UCard>
    <UCard v-else>
        <p class="text-sm text-default">This project is not available.</p>
    </UCard>
</template>
