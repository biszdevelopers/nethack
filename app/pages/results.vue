<script setup lang="ts">
type ActiveSeasonResponse = {
    id?: number;
    name?: string;
    status?: string;
    results_open_timestamp?: number;
    results_published?: number | boolean | null;
};

type BallotStanding = { team_id: number; stars: number };

const { data: season, error: seasonError } = await useApiFetch<ActiveSeasonResponse>(
    "/api/seasons/active",
    { $fetch: globalThis.$fetch },
);
if (seasonError.value) throw seasonError.value;

const published = computed(() => Boolean(season.value?.results_published));
const resultsOpenAt = computed(() => season.value?.results_open_timestamp ?? 0);

const {
    data: teams,
    pending,
    error,
    refresh,
} = await useApiFetch<GetTeamResponse[]>("/api/teams", { immediate: published.value });

watch(published, (open) => {
    if (open) void refresh();
});

const { data: ballotResults } = await useApiFetch<unknown>("/api/ballot/results", {
    immediate: published.value && import.meta.client,
    server: false,
});

function normalizeBallotResults(payload: unknown): BallotStanding[] {
    if (!payload || typeof payload !== "object") return [];

    const record = payload as Record<string, unknown>;
    const rows = Array.isArray(payload)
        ? payload
        : ([
              "results",
              "standings",
              "items",
              "teams",
              "projects",
              "data",
              "ranking",
              "leaderboard",
              "top",
          ]
              .map((key) => record[key])
              .find(Array.isArray) ?? (record.winner ? [record.winner] : []));

    return (rows as unknown[])
        .flatMap((row) => {
            if (!row || typeof row !== "object") return [];
            const item = row as Record<string, unknown>;
            const team = item.team as { id?: unknown } | undefined;
            const teamId = Number(item.team_id ?? team?.id ?? item.id);
            const stars = Number(
                item.stars ?? item.average_stars ?? item.votes ?? item.score ?? item.count ?? 0,
            );
            return Number.isInteger(teamId) && teamId > 0 ? [{ team_id: teamId, stars }] : [];
        })
        .sort((a, b) => b.stars - a.stars);
}

const peopleChoice = computed(() => {
    const [top] = normalizeBallotResults(ballotResults.value);
    if (!top || top.stars <= 0) return null;
    const team = (teams.value ?? []).find((item) => item.id === top.team_id);
    return team ? { team, stars: top.stars } : null;
});

const pathwayLabel = (value: string) =>
    value
        .split(/[-_]/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
        .join(" ");

const rankedTeams = computed(() =>
    [...(teams.value ?? [])].sort((a, b) => {
        const rankDifference =
            (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER);
        return rankDifference || a.project.name.localeCompare(b.project.name);
    }),
);

const hasRanks = computed(() => (teams.value ?? []).some((team) => team.rank));

const tracks = computed(() => {
    const groups = new Map<string, GetTeamResponse[]>();
    for (const team of rankedTeams.value) {
        const key = team.pathway ?? "overall";
        groups.set(key, [...(groups.get(key) ?? []), team]);
    }

    return [...groups.entries()]
        .map(([key, list]) => ({
            key,
            label: key === "overall" ? "Overall" : pathwayLabel(key),
            podium: list.filter((team) => team.rank).slice(0, 3),
            rest: list.filter((team) => !team.rank || Number(team.rank) > 3),
        }))
        .sort((a, b) => a.key.localeCompare(b.key));
});

const awardTeams = computed(() => (teams.value ?? []).filter((team) => team.awards.length > 0));

useHead(
    pageSeo({
        title: `Results | ${WEBSITE_NAME}`,
        description:
            "Published rankings, awards, and People's Choice results for the BIBS-C Network Hackathon.",
        path: "/results",
        robots: published.value ? "index, follow" : "noindex, nofollow",
    }),
);
</script>

<template>
    <div class="mt-4">
        <header class="max-w-3xl">
            <p class="font-mono text-xs tracking-[0.28em] text-primary uppercase">
                Final standings
            </p>
            <h1 class="mt-3 text-4xl font-black tracking-tight sm:text-6xl">Results</h1>
            <p class="mt-4 text-base leading-7 text-muted">
                <template v-if="season?.name">{{ season.name }} standings.</template>
                Rankings, awards, and peer recognition from the active season.
            </p>
        </header>

        <section
            v-if="!published"
            class="mt-10 border border-default bg-elevated/40 p-6 sm:p-8"
            aria-labelledby="results-locked-heading"
        >
            <h2 id="results-locked-heading" class="text-2xl font-bold">
                Results not published yet
            </h2>
            <p class="mt-3 max-w-2xl text-sm leading-6 text-muted">
                Judges are still reviewing projects. Results appear here only after organizers
                publish them.
            </p>
            <p v-if="resultsOpenAt > 0" class="mt-3 text-sm text-muted">
                Scheduled release:
                <DateTime :date="resultsOpenAt" />
            </p>
            <div class="mt-6 flex flex-wrap gap-3">
                <UButton to="/" variant="subtle" class="min-h-11">Back to the event</UButton>
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
                title="Results could not be loaded"
                :description="getErrorMessage(error)"
            />
            <UButton v-if="error" class="mt-4 min-h-11" variant="subtle" @click="refresh()">
                Try again
            </UButton>

            <p v-if="pending" class="mt-8 text-sm text-muted" role="status">Loading results…</p>

            <template v-else>
                <section v-if="peopleChoice" class="mt-10 border border-default bg-elevated/40 p-6">
                    <p class="font-mono text-xs tracking-[0.24em] text-primary uppercase">
                        People's Choice
                    </p>
                    <h2 class="mt-2 text-3xl font-bold">{{ peopleChoice.team.project.name }}</h2>
                    <p class="mt-1 text-sm text-muted">
                        {{ peopleChoice.team.name }} · {{ peopleChoice.stars }} average stars from
                        peer voters
                    </p>
                    <div class="mt-4">
                        <ProjectCard :id="peopleChoice.team.id" :team="peopleChoice.team" />
                    </div>
                </section>

                <section v-if="awardTeams.length" class="mt-12">
                    <h2 class="text-3xl font-bold">Awards</h2>
                    <div class="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div
                            v-for="team in awardTeams"
                            :key="team.id"
                            class="flex flex-wrap items-center justify-between gap-3 border border-default p-4"
                        >
                            <div class="min-w-0">
                                <p class="break-words font-semibold">{{ team.project.name }}</p>
                                <p class="break-words text-sm text-muted">{{ team.name }}</p>
                            </div>
                            <div class="flex flex-wrap gap-2">
                                <AwardButton
                                    v-for="award in team.awards"
                                    :key="award.namespace"
                                    :award="award"
                                    size="sm"
                                />
                            </div>
                        </div>
                    </div>
                </section>

                <template v-if="hasRanks">
                    <section
                        v-for="track in tracks"
                        :key="track.key"
                        class="mt-12"
                        :aria-labelledby="`track-${track.key}`"
                    >
                        <h2 :id="`track-${track.key}`" class="text-3xl font-bold">
                            {{ track.label }}
                        </h2>

                        <div
                            v-if="track.podium.length"
                            class="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3"
                        >
                            <article
                                v-for="team in track.podium"
                                :key="team.id"
                                class="border border-default p-5"
                                :class="team.rank === 1 ? 'md:order-first' : ''"
                            >
                                <p class="font-mono text-xs text-muted uppercase">
                                    Rank #{{ team.rank }}
                                </p>
                                <h3 class="mt-2 break-words text-xl font-bold">
                                    {{ team.project.name || "Untitled project" }}
                                </h3>
                                <p class="mt-1 break-words text-sm text-muted">{{ team.name }}</p>
                                <div v-if="team.awards.length" class="mt-3 flex flex-wrap gap-2">
                                    <AwardButton
                                        v-for="award in team.awards"
                                        :key="award.namespace"
                                        :award="award"
                                        size="sm"
                                    />
                                </div>
                                <UModal :title="team.project.name || team.name">
                                    <UButton class="mt-4 min-h-11" variant="subtle">
                                        View project
                                    </UButton>
                                    <template #body>
                                        <ProjectCard :id="team.id" :team="team" />
                                    </template>
                                </UModal>
                            </article>
                        </div>

                        <div
                            v-if="track.rest.length"
                            class="mt-4 divide-y divide-default border-y border-default"
                        >
                            <div
                                v-for="team in track.rest"
                                :key="team.id"
                                class="flex flex-wrap items-center justify-between gap-2 py-3"
                            >
                                <span class="min-w-0 break-words">
                                    <span class="text-sm text-muted">
                                        {{ team.rank ? `#${team.rank}` : "Unranked" }}
                                    </span>
                                    <span class="ml-3 font-medium">{{ team.project.name }}</span>
                                    <span class="ml-2 text-sm text-muted">{{ team.name }}</span>
                                </span>
                                <UModal :title="team.project.name || team.name">
                                    <UButton variant="link" class="min-h-11">Details</UButton>
                                    <template #body>
                                        <ProjectCard :id="team.id" :team="team" />
                                    </template>
                                </UModal>
                            </div>
                        </div>
                    </section>
                </template>

                <UAlert
                    v-else
                    class="mt-10"
                    color="neutral"
                    variant="subtle"
                    title="Rankings are not public for this season"
                    description="Projects and awards are published, but organizers have kept detailed rankings hidden."
                />

                <section class="mt-14">
                    <h2 class="text-3xl font-bold">All submitted projects</h2>
                    <div class="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
                        <ProjectCard
                            v-for="team in rankedTeams"
                            :id="team.id"
                            :key="team.id"
                            :team="team"
                        />
                    </div>
                </section>
            </template>
        </template>
    </div>
</template>
