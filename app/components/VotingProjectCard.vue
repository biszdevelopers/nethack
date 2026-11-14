<script setup lang="ts">
const { team, score, canIncrement, canDecrement } = defineProps<{
    team: APITeam;
    score: number;
    canIncrement: boolean;
    canDecrement: boolean;
}>();

const emit = defineEmits<{
    increment: [];
    decrement: [];
}>();

const safeRepoUrl = computed(() => safeUrl(team.project.repo_url));
const safeDemoUrl = computed(() => safeUrl(team.project.demo_url));
</script>

<template>
    <UCard variant="subtle" class="mb-4">
        <h2 class="bold text-2xl mb-2 text-wrap">{{ team.project.name }}</h2>
        <div class="flex flex-row items-baseline gap-4">
            <p class="mb-2">Team: {{ team.name }}</p>
            <UBadge
                v-if="team.pathway"
                variant="outline"
                :color="team.pathway == 'junior' ? 'primary' : 'warning'"
            >
                {{ team.pathway == "junior" ? "Junior" : "Senior" }}
            </UBadge>
        </div>
        <SafeComark class="my-4 mx-[2ch] text-wrap">{{ team.project.description }}</SafeComark>
        <div class="flex flex-wrap gap-2">
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

        <hr class="text-neutral-500 my-4" />

        <div class="flex items-center gap-4">
            <UButton
                icon="i-material-symbols-stat-minus-1"
                :aria-label="`Remove a star from ${team.project.name}`"
                class="min-h-11 min-w-11"
                :disabled="!canDecrement"
                @click="emit('decrement')"
            />
            <UIcon name="i-material-symbols-star-rate" size="1.2em" class="text-yellow-300" />
            <span
                aria-live="polite"
                :aria-label="`${score} of 5 stars assigned to ${team.project.name}`"
            >
                {{ score }} / 5
            </span>
            <UButton
                icon="i-material-symbols-stat-1"
                :aria-label="`Add a star to ${team.project.name}`"
                class="min-h-11 min-w-11"
                :disabled="!canIncrement"
                @click="emit('increment')"
            />
        </div>
    </UCard>
</template>
