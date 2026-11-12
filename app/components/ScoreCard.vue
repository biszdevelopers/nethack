<template>
    <UCard class="w-full min-w-0">
        <template #default>
            <div class="flex flex-col gap-4">
                <div class="flex flex-col">
                    <span class="text-sm font-bold text-muted">{{ seasonDate }}</span>
                    <div class="flex flex-row gap-2">
                        <span class="">{{ seasonName }}</span>
                        <UBadge v-if="team.pathway" variant="outline" color="primary">
                            {{ pathwayLabel }}
                        </UBadge>
                    </div>
                </div>
                <div
                    v-if="(team.score !== null && team.score !== undefined) || team.rank"
                    class="w-full flex flex-row justify-between items-center"
                >
                    <div v-if="team.score !== null && team.score !== undefined" class="w-1/2">
                        <span class="uppercase text-sm text-muted">original score</span>
                        <div class="w-1/2 flex items-baseline-last gap-1">
                            <span
                                class="text-5xl font-bold"
                                :class="{ 'rainbow-once': loaded && team.score == 100 }"
                            >
                                {{ team.score }}
                            </span>
                            <span class="text-muted">/100</span>
                        </div>
                    </div>
                    <div v-if="team.rank" class="w-1/2">
                        <span class="uppercase text-sm text-muted">ranking</span>
                        <div class="flex items-baseline-last gap-1">
                            <span
                                class="text-5xl font-bold"
                                :class="{
                                    'metallic-gold': team.rank == 1,
                                    'metallic-silver': team.rank == 2,
                                    'metallic-bronze': team.rank == 3,
                                }"
                            >
                                #{{ team.rank }}
                            </span>
                        </div>
                    </div>
                </div>
                <div v-else class="relative w-full flex flex-row justify-between items-center">
                    <div class="absolute inset-0 z-10 flex flex-row items-center justify-center">
                        <div
                            class="flex flex-row items-center gap-2 rounded-lg bg-background/80 px-4 py-2 shadow-sm backdrop-blur-sm text-muted"
                        >
                            <UIcon name="i-lucide-x"></UIcon>
                            <span>Not available</span>
                        </div>
                    </div>
                    <div class="w-1/2 blur-md select-none">
                        <span class="uppercase text-sm text-muted">score</span>
                        <div class="w-1/2 flex items-baseline-last gap-1">
                            <span class="text-5xl font-bold">---</span>
                            <span class="text-muted">/100</span>
                        </div>
                    </div>
                    <div class="w-1/2 blur-md select-none">
                        <span class="uppercase text-sm text-muted">ranking</span>
                        <div class="flex items-baseline-last gap-1">
                            <span class="text-5xl font-bold">#--</span>
                        </div>
                    </div>
                </div>
                <div class="flex flex-col">
                    <div class="flex flex-row gap-2">
                        <span class="text-sm text-muted">Team</span>
                        <span class="text-sm">{{ team.name }}</span>
                    </div>
                    <p class="mt-1 text-xs text-muted">Member details are private to the team.</p>
                </div>
                <ScoreFeedbackPanel
                    v-if="seasonMeta.resultsPublished"
                    :team-id="team.id"
                    :show-original-score="false"
                    :show-rank="false"
                />
                <div class="flex flex-row gap-2">
                    <div v-for="award in team.awards">
                        <AwardButton :award="award" size="md"></AwardButton>
                    </div>
                </div>
            </div>
        </template>
        <template #footer>
            <div class="flex flex-col gap-2">
                <UModal :title="team.name">
                    <UButton variant="link" class="p-0 h-auto text-xs">
                        <UIcon name="i-lucide-file" class="text-xs"></UIcon>
                        See Project Details
                    </UButton>
                    <template #body>
                        <ProjectCard :id="team.id" />
                    </template>
                </UModal>
                <ULink class="text-xs" href="#" target="_blank" external>
                    <UIcon name="i-lucide-calendar" class="text-xs"></UIcon>
                    See Season Details
                    <UIcon name="i-lucide-arrow-right" class="text-xs"></UIcon>
                </ULink>
            </div>
        </template>
    </UCard>
</template>

<script setup lang="ts">
const props = defineProps<{
    team: GetTeamResponse;
}>();

const { data: seasons } = await useFetch<Season[]>("/api/seasons", { lazy: true });

const seasonMeta = computed(() => {
    if (!props.team.season_id) return { name: "Unknown", date: null, resultsPublished: false };
    const s = seasons.value?.find((s: any) => s.id === props.team.season_id);
    return {
        name: s?.name ?? `Season ${props.team.season_id}`,
        date: null,
        resultsPublished: s?.results_published === 1 || s?.results_published === true,
    };
});

const seasonDate = computed(() => seasonMeta.value.date);
const seasonName = computed(() => seasonMeta.value.name);
const pathwayLabel = computed(() =>
    (props.team.pathway ?? "")
        .split(/[-_]/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
        .join(" "),
);

const loaded = ref(false);
onMounted(() => {
    setTimeout(() => {
        loaded.value = true;
    }, 500);
});
</script>

<style scoped>
.metallic-gold {
    background: linear-gradient(
        135deg,
        #ffd700 0%,
        #ffa500 25%,
        #ffd700 50%,
        #ffa500 75%,
        #ffd700 100%
    );
    background-size: 200% 200%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    text-shadow: none;
    animation: shimmer 3s ease-in-out infinite;
}

.metallic-silver {
    background: linear-gradient(
        135deg,
        #e8e8e8 0%,
        #c0c0c0 25%,
        #e8e8e8 50%,
        #c0c0c0 75%,
        #e8e8e8 100%
    );
    background-size: 200% 200%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    text-shadow: none;
    animation: shimmer 3s ease-in-out infinite;
}

.metallic-bronze {
    background: linear-gradient(
        135deg,
        #cd7f32 0%,
        #b87333 25%,
        #df9953 50%,
        #b87333 75%,
        #cd7f32 100%
    );
    background-size: 200% 200%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    text-shadow: none;
    animation: shimmer 3s ease-in-out infinite;
}

@keyframes shimmer {
    0% {
        background-position: 0% 50%;
    }
    50% {
        background-position: 50% 100%;
    }
    100% {
        background-position: 0% 50%;
    }
}

.rainbow-once {
    background: linear-gradient(
        to right,
        var(--ui-text) 0%,
        var(--ui-text) 25%,
        #ff2a2a 30%,
        #ff7a00 35%,
        #ffea00 40%,
        #05c443 45%,
        #00bfff 50%,
        #8a2be2 60%,
        var(--ui-text) 70%,
        var(--ui-text) 100%
    );

    background-size: 400% auto;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;

    animation: rainbow-sweep 2s ease-in-out 1 forwards;
}

@keyframes rainbow-sweep {
    0% {
        background-position: 0% center;
    }
    100% {
        background-position: 100% center;
    }
}

@media (prefers-reduced-motion: reduce) {
    .metallic-gold,
    .metallic-silver,
    .metallic-bronze,
    .rainbow-once {
        animation: none;
    }

    .rainbow-once {
        background-position: 100% center;
    }
}
</style>
