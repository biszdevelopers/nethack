<script setup lang="ts">
import {
    findSeasonById,
    getSeasonSchedule,
    parseSeasonId,
    shouldShowSeasonTheme,
} from "~/utils/season-detail";
import { isScoreCurvePreset, SCORE_CURVE_PRESETS } from "~~/shared/score-curve";
import type { RubricTrack } from "~~/shared/rubric";

type PublicRubricResponse = {
    version_id: number;
    tracks: Record<string, RubricTrack>;
};

type ActiveSeasonDetails = {
    score_curve_preset?: string;
};

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

const { data: rubric, error: rubricError } = await useApiFetch<PublicRubricResponse>(
    "/api/seasons/active/rubric",
    { lazy: true, server: false },
);
const { data: activeDetails } = await useApiFetch<ActiveSeasonDetails>("/api/seasons/active", {
    lazy: true,
    server: false,
});

useHead({ title: `${season.name} | ${WEBSITE_NAME}` });

const schedule = getSeasonSchedule(season);
const themeVisible = shouldShowSeasonTheme(season);
const seasonLabel = season.status.replaceAll("_", " ");
const rubricTracks = computed(() =>
    Object.entries(rubric.value?.tracks ?? {}).map(([id, track]) => ({ id, ...track })),
);
const displayCurve = computed(() => {
    const preset = activeDetails.value?.score_curve_preset;
    return preset && isScoreCurvePreset(preset) ? SCORE_CURVE_PRESETS[preset] : null;
});
</script>

<template>
    <div class="mx-auto mt-4 w-full max-w-4xl pb-8">
        <UButton to="/" variant="ghost" class="mb-5 min-h-11" leading-icon="i-lucide-arrow-left">
            Back to overview
        </UButton>

        <header class="mb-8">
            <div class="flex flex-wrap items-center gap-3">
                <h1 class="min-w-0 break-words text-4xl font-bold text-primary glow">
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
                <template #footer>
                    <a
                        v-if="season.is_active"
                        href="/calendar.ics"
                        download
                        class="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary"
                    >
                        <UIcon name="i-lucide-calendar-plus" aria-hidden="true" />
                        Add the schedule to your calendar (.ics)
                    </a>
                </template>
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

        <UCard v-if="season.is_active" class="mt-5" aria-labelledby="season-rubric-heading">
            <template #header>
                <div class="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 id="season-rubric-heading" class="text-xl font-semibold">Judging rubric</h2>
                    <UBadge v-if="rubric" variant="outline" color="neutral">
                        Version {{ rubric.version_id }}
                    </UBadge>
                </div>
            </template>

            <p v-if="rubricError" class="text-sm text-muted">
                The active season's judging rubric is not published yet or could not be loaded.
            </p>
            <p v-else-if="!rubric" class="text-sm text-muted" aria-live="polite">
                Loading the judging rubric…
            </p>
            <template v-else>
                <p class="mb-4 max-w-prose text-sm text-muted">
                    Projects are scored by judges in the track they entered. Every criterion is
                    scored within its range, and the criterion weights in each track total 100%.
                </p>

                <div v-if="rubricTracks.length" class="space-y-5">
                    <section
                        v-for="track in rubricTracks"
                        :key="track.id"
                        class="rounded-xl border border-default p-4"
                    >
                        <h3 class="text-lg font-semibold">{{ track.name }}</h3>
                        <div class="mt-3 overflow-x-auto">
                            <table class="w-full text-left text-sm">
                                <thead>
                                    <tr class="border-b border-default text-xs text-muted">
                                        <th scope="col" class="py-2 pr-3 font-semibold">
                                            Criterion
                                        </th>
                                        <th scope="col" class="py-2 pr-3 font-semibold">
                                            What judges look for
                                        </th>
                                        <th scope="col" class="py-2 pr-3 font-semibold">Weight</th>
                                        <th scope="col" class="py-2 font-semibold">Score range</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-default">
                                    <tr
                                        v-for="criterion in track.criteria"
                                        :key="criterion.id"
                                        class="align-top"
                                    >
                                        <th scope="row" class="py-3 pr-3 font-medium">
                                            {{ criterion.name }}
                                        </th>
                                        <td class="py-3 pr-3 text-muted">
                                            {{
                                                criterion.description || "No description provided."
                                            }}
                                        </td>
                                        <td class="py-3 pr-3 tabular-nums">
                                            {{ criterion.weight }}%
                                        </td>
                                        <td class="py-3 tabular-nums">
                                            {{ criterion.minScore }}–{{ criterion.maxScore }}
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </section>
                </div>
                <p v-else class="text-sm text-muted">The rubric does not define any tracks yet.</p>

                <section class="mt-6 rounded-xl bg-elevated/40 p-4" aria-labelledby="curve-heading">
                    <h3 id="curve-heading" class="text-sm font-semibold">
                        How scores become results
                    </h3>
                    <p class="mt-2 text-sm text-muted">
                        Each judge's weighted criteria produce a 0–100 score. A project's result is
                        the average of its judges' scores, and the ranking always uses that original
                        average. A published score display may apply an uplift curve for
                        presentation; the judges' original scores remain stored unchanged.
                    </p>
                    <p v-if="displayCurve" class="mt-2 text-sm text-muted">
                        Current display curve: {{ displayCurve.label }}. Rankings are unaffected.
                    </p>
                </section>
            </template>
        </UCard>

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
    </div>
</template>
