<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
    seasonId: number;
    seasonName: string;
    resultsPublished: boolean;
}>();

const { data: projects, error } = await useApiFetch<GetTeamResponse[]>(
    `/api/teams?season_id=${props.seasonId}`,
    { $fetch: globalThis.$fetch },
);

const orderedProjects = computed(() =>
    [...(projects.value ?? [])].sort((a, b) => {
        const rankDifference =
            (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER);
        return rankDifference || a.project.name.localeCompare(b.project.name);
    }),
);
</script>

<template>
    <section class="mx-auto w-full max-w-7xl px-6 pb-20 sm:px-10 lg:px-16">
        <div class="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
                <p class="font-mono text-xs tracking-[0.24em] text-cyan-300 uppercase">
                    {{ seasonName }}
                </p>
                <h2 class="mt-2 text-2xl font-bold sm:text-3xl">Submitted projects</h2>
            </div>
            <p class="max-w-xl text-sm text-muted">
                Project names, descriptions, and links are preserved with their original season.
            </p>
        </div>

        <UAlert
            v-if="error"
            color="error"
            title="Projects are unavailable"
            :description="getErrorMessage(error)"
        />
        <p v-else-if="orderedProjects.length === 0" class="border border-default p-6 text-muted">
            No submitted projects were recorded for this season.
        </p>
        <div v-else class="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <article
                v-for="team in orderedProjects"
                :key="team.id"
                class="flex min-w-0 flex-col border border-default bg-elevated/40 p-5 sm:p-7"
            >
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0">
                        <p class="font-mono text-xs break-words text-muted">{{ team.name }}</p>
                        <h3 class="mt-2 break-words text-xl font-semibold">
                            {{ team.project.name || "Untitled project" }}
                        </h3>
                    </div>
                    <UBadge v-if="resultsPublished && team.rank" color="primary" variant="subtle">
                        Rank #{{ team.rank }}
                    </UBadge>
                </div>

                <SafeComark
                    class="mt-4 flex-1 whitespace-pre-wrap break-words text-sm leading-6 text-muted"
                >
                    {{ team.project.description || "No project description was recorded." }}
                </SafeComark>

                <div class="mt-4 border-t border-default pt-3">
                    <p class="font-mono text-[0.7rem] tracking-[0.18em] text-muted uppercase">
                        AI-use disclosure
                    </p>
                    <SafeComark
                        v-if="team.project.sourcing"
                        class="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted"
                    >
                        {{ team.project.sourcing }}
                    </SafeComark>
                    <p v-else class="mt-2 text-sm leading-6 text-muted">
                        No AI-use disclosure was recorded.
                    </p>
                </div>

                <div class="mt-6 flex flex-wrap gap-3">
                    <UButton
                        v-if="safeUrl(team.project.demo_url)"
                        :href="safeUrl(team.project.demo_url)"
                        external
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="outline"
                        size="sm"
                    >
                        Demo
                    </UButton>
                    <UButton
                        v-if="safeUrl(team.project.repo_url)"
                        :href="safeUrl(team.project.repo_url)"
                        external
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="outline"
                        size="sm"
                    >
                        Repository
                    </UButton>
                    <UBadge
                        v-for="award in team.awards"
                        :key="award.namespace"
                        color="neutral"
                        variant="subtle"
                    >
                        {{ award.name }}
                    </UBadge>
                </div>
            </article>
        </div>
    </section>
</template>
