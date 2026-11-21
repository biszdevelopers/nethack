<script setup lang="ts">
type ActiveSeasonResponse = {
    id?: number;
    name?: string;
    status: string;
    start_timestamp: number;
    end_timestamp: number;
    voting_start_timestamp: number;
    voting_end_timestamp: number;
    results_open_timestamp: number;
    theme_name?: string | null;
    theme_description?: string | null;
    announcement?: string | null;
    is_gallery_public?: number | boolean | null;
    results_published?: number | boolean | null;
};

const { data, error } = await useApiFetch<ActiveSeasonResponse>("/api/seasons/active", {
    $fetch: globalThis.$fetch,
});
if (error.value) throw error.value;

const hackathon = computed(() => {
    if (!data.value) {
        throw createError({
            statusCode: 502,
            statusMessage: "The active season could not be loaded.",
        });
    }
    return data.value;
});

const status = computed(() => hackathon.value.status);
const startDate = computed(() => new Date(hackathon.value.start_timestamp));
const endDate = computed(() => new Date(hackathon.value.end_timestamp));
const votingStartDate = computed(() => new Date(hackathon.value.voting_start_timestamp));
const votingEndDate = computed(() => new Date(hackathon.value.voting_end_timestamp));
const resultsOpenDate = computed(() => new Date(hackathon.value.results_open_timestamp));

const themeDescription = computed(() => hackathon.value.theme_description || "");
const announcement = computed(() => hackathon.value.announcement?.trim() || "");
const hasStart = computed(() => hackathon.value.start_timestamp > 0);
const hasEnd = computed(() => hackathon.value.end_timestamp > 0);
const hasVotingStart = computed(() => hackathon.value.voting_start_timestamp > 0);
const hasVotingEnd = computed(() => hackathon.value.voting_end_timestamp > 0);
const hasResultsOpen = computed(() => hackathon.value.results_open_timestamp > 0);
const galleryPublic = computed(() => Boolean(hackathon.value.is_gallery_public));
const resultsPublished = computed(() => Boolean(hackathon.value.results_published));

const steps = [
    {
        title: "Sign in and form a team",
        body: "Sign in with basis-auth, create a team, and invite up to five classmates.",
    },
    {
        title: "Build against the theme",
        body: "Develop a working project that makes a meaningful connection to the season theme.",
    },
    {
        title: "Submit the project",
        body: "Provide a public repository, a complete README, a demo URL, and a 2–3 minute silent video.",
    },
    {
        title: "Disclose AI use",
        body: "Name the tools and the specific parts they assisted. The disclosure is mandatory.",
    },
    {
        title: "Peer voting and judging",
        body: "Participants distribute 10 stars within their pathway; judges score against the season rubric.",
    },
    {
        title: "Results and showcase",
        body: "Published results list rankings, awards, and peer recognition in the public gallery.",
    },
];

const faqTeaser = [
    {
        question: "Who can participate?",
        answer: "BIBS-C Network students who sign in with a basis-auth account can create or join a team.",
    },
    {
        question: "What has to be submitted?",
        answer: "A public repository, a complete README, a demo URL, a 2–3 minute silent video, and a complete AI-use disclosure.",
    },
    {
        question: "Which repository platforms are accepted?",
        answer: "GitHub is preferred. GitLab, Codeberg, and Gitee are also accepted when the repository is public.",
    },
    {
        question: "How much time should we plan for?",
        answer: "Plan for the full event window and leave time to record and test the demonstration video.",
    },
];

useHead(
    pageSeo({
        title: `${WEBSITE_NAME} | BIBS-C Network Hackathon`,
        description:
            "The official platform for the BIBS-C Network Hackathon: team registration, project submission, peer voting, judging, and public results.",
        path: "/",
    }),
);
</script>

<template>
    <div class="space-y-12">
        <section v-if="status !== 'finished'" aria-labelledby="schedule-heading">
            <div class="flex flex-wrap items-end justify-between gap-3">
                <h2 id="schedule-heading" class="text-3xl font-bold">Schedule</h2>
                <p class="text-sm text-muted">Times shown in Asia/Shanghai (UTC+8)</p>
            </div>

            <p v-if="status === 'paused'" class="mt-5 text-muted">
                The website is currently under maintenance. Please check back later.
            </p>
            <ul v-else class="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <li v-if="status === 'not_started' && hasStart">
                    <LargeCountdown :date="startDate" label="Hackathon starts" />
                </li>
                <li v-if="(status === 'not_started' || status === 'in_progress') && hasEnd">
                    <LargeCountdown :date="endDate" label="Hackathon ends" />
                </li>
                <li v-if="status === 'in_progress' && hasVotingStart">
                    <LargeCountdown :date="votingStartDate" label="Voting starts" />
                </li>
                <li v-if="status === 'voting' && hasVotingEnd">
                    <LargeCountdown :date="votingEndDate" label="Voting ends" />
                </li>
                <li v-if="status === 'voting' && hasResultsOpen">
                    <LargeCountdown :date="resultsOpenDate" label="Results released" />
                </li>
            </ul>

            <p
                v-if="announcement"
                class="mt-6 border-l-2 border-primary pl-4 whitespace-pre-wrap text-muted"
            >
                {{ announcement }}
            </p>

            <UCollapsible class="mt-6">
                <template #default="{ open }">
                    <button
                        type="button"
                        class="inline-flex min-h-11 items-center gap-2 text-left text-sm font-semibold"
                        :aria-expanded="open"
                    >
                        <UIcon :name="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" />
                        Detailed schedule
                    </button>
                </template>

                <template #content>
                    <ul class="mt-3 space-y-2 text-sm">
                        <li>
                            Hackathon starts:
                            <DateTime v-if="hasStart" :date="startDate" />
                            <span v-else>To be announced</span>
                        </li>
                        <li>
                            Hackathon ends:
                            <DateTime v-if="hasEnd" :date="endDate" />
                            <span v-else>To be announced</span>
                        </li>
                        <li>
                            Voting starts:
                            <DateTime v-if="hasVotingStart" :date="votingStartDate" />
                            <span v-else>To be announced</span>
                        </li>
                        <li>
                            Voting ends:
                            <DateTime v-if="hasVotingEnd" :date="votingEndDate" />
                            <span v-else>To be announced</span>
                        </li>
                        <li>
                            Results released:
                            <DateTime v-if="hasResultsOpen" :date="resultsOpenDate" />
                            <span v-else>To be announced</span>
                        </li>
                    </ul>
                </template>
            </UCollapsible>
        </section>

        <section aria-labelledby="theme-heading">
            <h2 id="theme-heading" class="text-3xl font-bold">Theme</h2>
            <p v-if="!hackathon.theme_name" class="mt-5 text-muted">
                The theme will be revealed
                <template v-if="hasStart">
                    on
                    <DateTime class="font-semibold text-default" :date="startDate" />
                </template>
                <template v-else>soon</template>
                .
            </p>
            <template v-else>
                <p class="mt-5 text-lg">
                    The theme is
                    <span class="font-bold text-primary">{{ hackathon.theme_name }}</span>
                    .
                </p>
                <p v-if="themeDescription" class="mt-3 max-w-3xl whitespace-pre-wrap text-muted">
                    {{ themeDescription }}
                </p>
            </template>
        </section>

        <section aria-labelledby="how-it-works-heading">
            <h2 id="how-it-works-heading" class="text-3xl font-bold">How it works</h2>
            <ol
                class="mt-5 grid grid-cols-1 gap-px border border-default bg-default sm:grid-cols-2 lg:grid-cols-3"
            >
                <li v-for="(step, index) in steps" :key="step.title" class="bg-default p-5">
                    <span class="font-mono text-xs text-primary">
                        {{ String(index + 1).padStart(2, "0") }}
                    </span>
                    <h3 class="mt-2 text-lg font-semibold">{{ step.title }}</h3>
                    <p class="mt-2 text-sm leading-6 text-muted">{{ step.body }}</p>
                </li>
            </ol>
        </section>

        <section aria-labelledby="faq-heading">
            <div class="flex flex-wrap items-end justify-between gap-3">
                <h2 id="faq-heading" class="text-3xl font-bold">FAQ</h2>
                <ULink to="/faq" class="inline-flex min-h-11 items-center gap-1 text-sm">
                    All questions
                    <UIcon name="i-lucide-arrow-right" />
                </ULink>
            </div>
            <div class="mt-5 divide-y divide-default border-y border-default">
                <details v-for="item in faqTeaser" :key="item.question" class="group py-4">
                    <summary
                        class="flex min-h-11 cursor-pointer items-center justify-between gap-3 font-semibold"
                    >
                        {{ item.question }}
                        <UIcon
                            name="i-lucide-chevron-down"
                            class="shrink-0 transition group-open:rotate-180"
                        />
                    </summary>
                    <p class="mt-2 max-w-3xl text-sm leading-6 text-muted">{{ item.answer }}</p>
                </details>
            </div>
        </section>

        <section aria-label="Support and archives" class="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div class="border border-default p-6">
                <h2 class="text-2xl font-bold">Questions before you start?</h2>
                <p class="mt-3 text-sm leading-6 text-muted">
                    Read the short answers on the FAQ page, or open the full rules for the binding
                    requirements, video length, repository rules, and AI-use disclosure.
                </p>
                <div class="mt-5 flex flex-wrap gap-3">
                    <UButton to="/faq" variant="subtle" class="min-h-11">Read the FAQ</UButton>
                    <UButton to="/rules" variant="subtle" class="min-h-11">Full rules</UButton>
                </div>
            </div>

            <div class="border border-default p-6">
                <h2 class="text-2xl font-bold">Need help?</h2>
                <p class="mt-3 text-sm leading-6 text-muted">
                    Contact the organizers by email or Microsoft Teams. Include your team name and
                    the page you are working on so we can answer quickly.
                </p>
                <div class="mt-5 flex flex-wrap gap-3">
                    <UButton to="/contact" variant="subtle" class="min-h-11">
                        Contact support
                    </UButton>
                    <UButton to="/showcase" variant="subtle" class="min-h-11">
                        Past projects
                    </UButton>
                </div>
            </div>
        </section>

        <section
            v-if="galleryPublic || resultsPublished"
            aria-label="Season archives"
            class="flex flex-wrap gap-3"
        >
            <UButton v-if="galleryPublic" to="/projects" variant="subtle" class="min-h-11">
                Browse this season's projects
            </UButton>
            <UButton v-if="resultsPublished" to="/results" variant="subtle" class="min-h-11">
                See published results
            </UButton>
        </section>
    </div>
</template>
