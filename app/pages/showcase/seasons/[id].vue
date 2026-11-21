<script setup lang="ts">
import { parseSeasonId } from "~/utils/season-detail";

definePageMeta({
    layout: "fullwidth-nostick",
});

const route = useRoute();
const seasonId = parseSeasonId(route.params.id);
if (seasonId === null) {
    throw createError({ statusCode: 404, statusMessage: "Season archive not found", fatal: true });
}

const { data: seasons, error } = await useApiFetch<PublicSeason[]>("/api/seasons", {
    $fetch: globalThis.$fetch,
});
if (error.value) throw error.value;

const season = seasons.value?.find((item) => item.id === seasonId) ?? null;
if (!season || season.is_active || season.status === "not_started" || season.status === "paused") {
    throw createError({ statusCode: 404, statusMessage: "Season archive not found", fatal: true });
}

useHead(
    pageSeo({
        title: `${season.name} project archive | ${WEBSITE_NAME}`,
        description: `Project archive for ${season.name} at the BIBS-C Network Hackathon.`,
        path: `/showcase/seasons/${season.id}`,
    }),
);
</script>

<template>
    <div class="min-h-screen bg-default text-default">
        <header class="border-b border-default px-6 py-16 sm:px-10 lg:px-16 lg:py-24">
            <div class="mx-auto max-w-7xl">
                <NuxtLink
                    to="/showcase"
                    class="inline-flex min-h-11 items-center gap-2 font-mono text-sm text-primary hover:text-default"
                >
                    <UIcon name="i-lucide-arrow-left" />
                    All showcases
                </NuxtLink>
                <p class="mt-10 font-mono text-xs tracking-[0.25em] text-primary uppercase">
                    Season archive
                </p>
                <h1 class="mt-3 break-words text-4xl font-black tracking-tight sm:text-6xl">
                    {{ season.name }}
                </h1>
                <p v-if="season.theme_name" class="mt-4 max-w-3xl text-lg text-muted">
                    {{ season.theme_name }}
                </p>
            </div>
        </header>

        <ShowcaseSeasonProjectArchive
            :season-id="season.id"
            :season-name="season.name"
            :results-published="season.results_published === 1"
        />
    </div>
</template>
