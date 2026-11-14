<script setup lang="ts">
import {
    findSeasonById,
    getSeasonSchedule,
    parseSeasonId,
    shouldShowSeasonTheme,
} from "~/utils/season-detail";

definePageMeta({
    layout: "default",
    key: (route) => route.path,
});

const route = useRoute();
const seasonId = parseSeasonId(route.params.id);
if (seasonId === null) {
    throw createError({ statusCode: 404, statusMessage: "Season not found", fatal: true });
}

const { data: seasons, error } = await useApiFetch<PublicSeason[]>("/api/seasons", {
    $fetch: globalThis.$fetch,
});
if (error.value) throw error.value;

const season = findSeasonById(seasons.value, seasonId);
if (!season) {
    throw createError({ statusCode: 404, statusMessage: "Season not found", fatal: true });
}

useHead({ title: `${season.name} | ${WEBSITE_NAME}` });

const schedule = getSeasonSchedule(season);
const themeVisible = shouldShowSeasonTheme(season);
const seasonLabel = season.status.replaceAll("_", " ");
</script>

<template>
    <main class="mx-auto mt-4 w-full max-w-4xl pb-8">
        <UButton to="/" variant="ghost" class="mb-5 min-h-11" leading-icon="i-lucide-arrow-left">
            Back to overview
        </UButton>

        <header class="mb-8">
            <div class="flex flex-wrap items-center gap-3">
                <h1 class="break-words text-4xl font-bold text-primary glow">
                    {{ season.name }}
                </h1>
                <UBadge v-if="season.is_active" color="primary" variant="subtle">
                    Current season
                </UBadge>
                <UBadge class="capitalize" variant="outline">{{ seasonLabel }}</UBadge>
            </div>
            <p class="mt-3 max-w-prose text-muted">
                Season schedule, event theme, and important dates.
            </p>
        </header>

        <div class="grid gap-5 md:grid-cols-2">
            <UCard aria-labelledby="season-schedule-heading">
                <template #header>
                    <h2 id="season-schedule-heading" class="text-xl font-semibold">Schedule</h2>
                </template>
                <dl v-if="schedule.length" class="grid gap-4 sm:grid-cols-2">
                    <div v-for="item in schedule" :key="item.label" class="min-w-0">
                        <dt class="text-sm text-muted">{{ item.label }}</dt>
                        <dd class="mt-1 break-words font-medium">
                            <DateTime :date="new Date(item.value)" />
                        </dd>
                    </div>
                </dl>
                <p v-else class="text-sm text-muted">Schedule dates have not been set yet.</p>
            </UCard>

            <UCard aria-labelledby="season-theme-heading">
                <template #header>
                    <h2 id="season-theme-heading" class="text-xl font-semibold">Theme</h2>
                </template>
                <template v-if="themeVisible && season.theme_name">
                    <p class="font-semibold text-primary">{{ season.theme_name }}</p>
                    <p
                        v-if="season.theme_description"
                        class="mt-3 break-words whitespace-pre-wrap text-muted"
                    >
                        {{ season.theme_description }}
                    </p>
                    <p v-else class="mt-3 text-sm text-muted">No theme description was provided.</p>
                </template>
                <p v-else class="text-sm text-muted">
                    The theme will be announced when the season begins.
                </p>
            </UCard>
        </div>

        <nav v-if="seasons && seasons.length > 1" class="mt-8" aria-label="Other seasons">
            <h2 class="mb-3 text-lg font-semibold">Explore another season</h2>
            <ul class="flex flex-wrap gap-2">
                <li v-for="item in seasons" :key="item.id">
                    <UButton
                        :to="`/seasons/${item.id}`"
                        :variant="item.id === season.id ? 'solid' : 'outline'"
                        class="min-h-11 whitespace-normal text-left"
                        :aria-current="item.id === season.id ? 'page' : undefined"
                    >
                        {{ item.name }}
                    </UButton>
                </li>
            </ul>
        </nav>
    </main>
</template>
