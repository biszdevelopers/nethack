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
            <p class="max-w-xl text-sm text-white/60">
                Project names, descriptions, and links are preserved with their original season.
            </p>
        </div>

        <p v-if="error" class="border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">
            Projects are unavailable: {{ getErrorMessage(error) }}
        </p>
        <p
            v-else-if="orderedProjects.length === 0"
            class="border border-white/10 p-6 text-white/60"
        >
            No submitted projects were recorded for this season.
        </p>
        <div v-else class="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <article
                v-for="team in orderedProjects"
                :key="team.id"
                class="flex min-w-0 flex-col border border-white/10 bg-white/[0.03] p-5 sm:p-7"
            >
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0">
                        <p class="font-mono text-xs break-words text-white/60">{{ team.name }}</p>
                        <h3 class="mt-2 break-words text-xl font-semibold">
                            {{ team.project.name || "Untitled project" }}
                        </h3>
                    </div>
                    <span
                        v-if="resultsPublished && team.rank"
                        class="inline-flex items-center rounded-md bg-cyan-300/15 px-2 py-1 text-xs font-medium text-cyan-200 ring ring-white/15 ring-inset"
                    >
                        Rank #{{ team.rank }}
                    </span>
                </div>

                <SafeComark
                    class="mt-4 flex-1 whitespace-pre-wrap break-words text-sm leading-6 text-white/70"
                >
                    {{ team.project.description || "No project description was recorded." }}
                </SafeComark>

                <div class="mt-4 border-t border-white/10 pt-3">
                    <p class="font-mono text-[0.7rem] tracking-[0.18em] text-white/60 uppercase">
                        AI-use disclosure
                    </p>
                    <SafeComark
                        v-if="team.project.sourcing"
                        class="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-white/70"
                    >
                        {{ team.project.sourcing }}
                    </SafeComark>
                    <p v-else class="mt-2 text-sm leading-6 text-white/60">
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
                        class="border-white/20 text-white hover:bg-white/10"
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
                        class="border-white/20 text-white hover:bg-white/10"
                    >
                        Repository
                    </UButton>
                    <span
                        v-for="award in team.awards"
                        :key="award.namespace"
                        class="inline-flex items-center rounded-md bg-white/10 px-2 py-1 text-xs font-medium text-white/80 ring ring-white/15 ring-inset"
                    >
                        {{ award.name }}
                    </span>
                </div>
            </article>
        </div>
    </section>
</template>
