<script setup lang="ts">
import { computed } from "vue";

const { data: seasons, error } = await useApiFetch<PublicSeason[]>("/api/seasons", {
    $fetch: globalThis.$fetch,
});

const archivedSeasons = computed(() =>
    (seasons.value ?? [])
        .filter(
            (season) =>
                !season.is_active && season.status !== "not_started" && season.status !== "paused",
        )
        .sort((a, b) => b.end_timestamp - a.end_timestamp || b.id - a.id),
);
</script>

<template>
    <section
        class="border-t border-default bg-default px-6 py-20 text-default sm:px-10 lg:px-16 lg:py-28"
    >
        <div class="mx-auto max-w-7xl">
            <div class="mb-10 max-w-2xl">
                <p class="font-mono text-xs tracking-wide text-primary">Project archive</p>
                <h2 class="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">
                    Every past round, in one place
                </h2>
                <p class="mt-4 text-sm leading-6 text-muted sm:text-base">
                    Browse submitted projects and descriptions from previous seasons.
                </p>
            </div>

            <UAlert
                v-if="error"
                color="error"
                title="Season archives are unavailable"
                :description="getErrorMessage(error)"
            />
            <p v-else-if="archivedSeasons.length === 0" class="text-muted">
                Past season archives will appear here when they are available.
            </p>
            <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                <NuxtLink
                    v-for="season in archivedSeasons"
                    :key="season.id"
                    :to="`/showcase/seasons/${season.id}`"
                    class="group flex min-h-52 min-w-0 flex-col justify-between border border-default bg-elevated/40 p-6 transition hover:border-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
                >
                    <div class="min-w-0">
                        <p class="font-mono text-xs tracking-wide text-primary">
                            {{ season.status.replaceAll("_", " ") }}
                        </p>
                        <h3 class="mt-3 break-words text-2xl font-semibold tracking-tight">
                            {{ season.name }}
                        </h3>
                        <p v-if="season.theme_name" class="mt-2 break-words text-sm text-muted">
                            {{ season.theme_name }}
                        </p>
                    </div>
                    <span
                        class="mt-8 inline-flex items-center gap-2 font-mono text-sm text-primary"
                    >
                        Open project archive
                        <UIcon
                            name="i-lucide-arrow-up-right"
                            class="transition-transform group-hover:translate-x-1 group-hover:-translate-y-1"
                        />
                    </span>
                </NuxtLink>
            </div>
        </div>
    </section>
</template>
