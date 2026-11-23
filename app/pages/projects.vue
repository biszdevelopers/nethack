<script setup lang="ts">
type ActiveSeasonResponse = {
    id?: number;
    name?: string;
    status?: string;
    start_timestamp?: number;
    end_timestamp?: number;
    results_open_timestamp?: number;
    is_gallery_public?: number | boolean | null;
};

const { data: season, error: seasonError } = await useApiFetch<ActiveSeasonResponse>(
    "/api/seasons/active",
    { $fetch: globalThis.$fetch },
);
if (seasonError.value) throw seasonError.value;

const galleryOpen = computed(() => Boolean(season.value?.is_gallery_public));

const {
    data: teams,
    pending,
    error,
    refresh,
} = await useApiFetch<GetTeamResponse[]>("/api/teams", {
    immediate: galleryOpen.value,
});

watch(galleryOpen, (open) => {
    if (open) void refresh();
});

const route = useRoute();
const router = useRouter();
const search = ref("");
const pathway = ref("all");
const trackLabel = useTrackLabel();

const pathwayOptions = computed(() => {
    const values = [...new Set((teams.value ?? []).map((team) => team.pathway).filter(Boolean))];
    return [
        { label: "All pathways", value: "all" },
        ...values.map((value) => ({
            label: trackLabel(value as string),
            value: value as string,
        })),
    ];
});

const filteredTeams = computed(() => {
    const term = search.value.trim().toLocaleLowerCase();
    return [...(teams.value ?? [])]
        .filter((team) => pathway.value === "all" || team.pathway === pathway.value)
        .filter((team) => {
            if (!term) return true;
            return [team.project.name, team.name, team.project.description].some((value) =>
                value?.toLocaleLowerCase().includes(term),
            );
        })
        .sort((a, b) => {
            const rankDifference =
                (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER);
            return rankDifference || a.project.name.localeCompare(b.project.name);
        });
});

const selectedId = computed(() => Number(route.query.project));
const selectedTeam = computed(
    () => (teams.value ?? []).find((team) => team.id === selectedId.value) ?? null,
);

function closeProject() {
    const query = { ...route.query };
    delete query.project;
    void router.push({ query });
}

useHead(
    pageSeo({
        title: `Projects | ${WEBSITE_NAME}`,
        description:
            "Browse the projects submitted to the BIBS-C Network Hackathon. The gallery opens when peer voting begins.",
        path: "/projects",
        robots: galleryOpen.value ? "index, follow" : "noindex, nofollow",
    }),
);
</script>

<template>
    <div class="mt-4">
        <header class="max-w-3xl">
            <p class="font-mono text-xs tracking-wide text-primary">Public gallery</p>
            <h1 class="mt-3 text-4xl font-black tracking-tight sm:text-6xl">Projects</h1>
            <p class="mt-4 text-base leading-7 text-muted">
                Every team that submitted a project for the active season. Ranks and awards appear
                only after organizers publish results.
            </p>
        </header>

        <section
            v-if="!galleryOpen"
            class="mt-10 border border-default bg-elevated/40 p-6 sm:p-8"
            aria-labelledby="gallery-locked-heading"
        >
            <h2 id="gallery-locked-heading" class="text-2xl font-bold">
                Projects are hidden until peer voting opens
            </h2>
            <p class="mt-3 max-w-2xl text-sm leading-6 text-muted">
                This protects unfinished work while teams are still building. The gallery opens
                automatically when the event enters the peer-voting stage.
            </p>
            <div class="mt-6 flex flex-wrap gap-3">
                <UButton to="/rules" variant="subtle" class="min-h-11">Read the rules</UButton>
                <UButton to="/showcase" variant="subtle" class="min-h-11">
                    Browse past seasons
                </UButton>
            </div>
        </section>

        <template v-else>
            <UAlert
                v-if="error"
                class="mt-8"
                color="error"
                title="Projects could not be loaded"
                :description="getErrorMessage(error)"
            />
            <UButton v-if="error" class="mt-4 min-h-11" variant="subtle" @click="refresh()">
                Try again
            </UButton>

            <div class="mt-8 flex flex-col gap-3 sm:flex-row sm:items-end">
                <UFormField label="Search" class="w-full sm:max-w-md">
                    <UInput
                        v-model="search"
                        icon="i-lucide-search"
                        placeholder="Project, team, or description"
                        class="w-full"
                        :ui="{ base: 'min-h-11' }"
                    />
                </UFormField>
                <UFormField label="Pathway" class="w-full sm:max-w-56">
                    <USelect
                        v-model="pathway"
                        :items="pathwayOptions"
                        class="w-full"
                        :ui="{ base: 'min-h-11' }"
                    />
                </UFormField>
                <p class="pb-3 text-sm text-muted" role="status">
                    {{ filteredTeams.length }} project{{ filteredTeams.length === 1 ? "" : "s" }}
                </p>
            </div>

            <p v-if="pending" class="mt-8 text-sm text-muted" role="status">Loading projects…</p>

            <div
                v-else-if="filteredTeams.length"
                class="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2"
            >
                <UCard v-for="team in filteredTeams" :key="team.id" class="min-w-0">
                    <template #header>
                        <div class="flex flex-wrap items-start justify-between gap-3">
                            <div class="min-w-0">
                                <h2 class="break-words text-xl font-bold">
                                    {{ team.project.name || "Untitled project" }}
                                </h2>
                                <p class="mt-1 break-words text-sm text-muted">{{ team.name }}</p>
                            </div>
                            <div class="flex flex-wrap items-center gap-2">
                                <UBadge v-if="team.pathway" variant="subtle" color="primary">
                                    {{ trackLabel(team.pathway) }}
                                </UBadge>
                                <UBadge v-if="team.rank" variant="subtle" color="warning">
                                    Rank #{{ team.rank }}
                                </UBadge>
                            </div>
                        </div>
                    </template>

                    <div
                        v-if="team.project.description"
                        class="line-clamp-5 whitespace-pre-wrap break-words text-sm leading-6"
                    >
                        <SafeComark>{{ team.project.description }}</SafeComark>
                    </div>
                    <p v-else class="text-sm text-muted">No project description was recorded.</p>

                    <div v-if="team.awards.length" class="mt-4 flex flex-wrap gap-2">
                        <AwardButton
                            v-for="award in team.awards"
                            :key="award.namespace"
                            :award="award"
                            size="sm"
                        />
                    </div>

                    <template #footer>
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <ULink
                                :to="{ path: '/projects', query: { project: team.id } }"
                                class="inline-flex min-h-11 items-center gap-1 text-sm"
                            >
                                View project
                                <UIcon name="i-lucide-arrow-right" />
                            </ULink>
                            <span class="text-xs text-muted">Submitted project</span>
                        </div>
                    </template>
                </UCard>
            </div>

            <div v-else class="mt-8 border border-default bg-elevated/40 p-6">
                <p class="text-sm text-muted">
                    {{
                        (teams?.length ?? 0) === 0
                            ? "No submitted projects are available yet."
                            : "No projects match this search. Try another pathway or clear the filters."
                    }}
                </p>
                <UButton
                    v-if="(teams?.length ?? 0) > 0"
                    class="mt-4 min-h-11"
                    variant="subtle"
                    @click="
                        search = '';
                        pathway = 'all';
                    "
                >
                    Clear filters
                </UButton>
            </div>
        </template>

        <div class="mt-12 border-t border-default pt-6">
            <ULink to="/showcase" class="inline-flex min-h-11 items-center gap-1 text-sm">
                Browse the past-season archive
                <UIcon name="i-lucide-arrow-up-right" />
            </ULink>
        </div>

        <UModal
            :open="Boolean(selectedTeam)"
            :title="selectedTeam?.project.name || selectedTeam?.name || 'Project'"
            @update:open="(open) => !open && closeProject()"
        >
            <template #body>
                <ProjectCard v-if="selectedTeam" :id="selectedTeam.id" :team="selectedTeam" />
            </template>
        </UModal>
    </div>
</template>
