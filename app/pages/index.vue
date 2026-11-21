<script setup lang="ts">
import { MAX_TEAM_MEMBERS } from "~~/shared/schemas";

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
    is_submission_closed?: number | boolean | null;
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

const { loggedIn } = useBasisAuthSession();

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
const galleryPublic = computed(() =>
    Boolean(hackathon.value.is_gallery_public || hackathon.value.is_submission_closed),
);

const resultsPublished = computed(() => Boolean(hackathon.value.results_published));

const statusLabel = computed(
    () =>
        ({
            not_started: "Submissions open",
            in_progress: "Building in progress",
            voting: "Peer voting open",
            finished: "Event finished",
            paused: "Maintenance",
        })[status.value] ?? status.value,
);

type Cta = { to: string; label: string };

const primaryCta = computed<Cta | null>(() => {
    if (status.value === "paused") return null;

    if (status.value === "not_started" || status.value === "in_progress") {
        return loggedIn.value
            ? { to: "/dashboard", label: "Go to dashboard" }
            : { to: "/api/login?redirect=/dashboard", label: "Sign in to join" };
    }

    if (status.value === "voting") {
        return loggedIn.value
            ? { to: "/voting", label: "Vote for your favorites" }
            : { to: "/api/login?redirect=/dashboard", label: "Sign in to vote" };
    }

    if (status.value === "finished") {
        return resultsPublished.value
            ? { to: "/results", label: "See results" }
            : { to: "/dashboard", label: "Go to dashboard" };
    }

    return null;
});

const secondaryCta = computed<Cta>(() =>
    resultsPublished.value && primaryCta.value?.to !== "/results"
        ? { to: "/results", label: "See results" }
        : { to: "/rules", label: "Read the rules" },
);

const dateRange = computed(() => {
    if (!hasStart.value && !hasEnd.value) return "To be announced";
    if (hasStart.value && hasEnd.value) {
        return `${formatDateTime(startDate.value)} to ${formatDateTime(endDate.value)}`;
    }
    return formatDateTime(hasStart.value ? startDate.value : endDate.value);
});

const facts = computed(() => [
    { label: "Event", value: "BIBS-C Network Hackathon" },
    { label: "Platform", value: WEBSITE_NAME },
    { label: "Dates", value: dateRange.value },
    { label: "Eligibility", value: "BIBS-C Network students with a basis-auth account" },
    { label: "Team size", value: `1 to ${MAX_TEAM_MEMBERS} members` },
    {
        label: "Commitment",
        value: "Plan for the full event window, plus a 2–3 minute silent demonstration video.",
    },
    {
        label: "Prizes",
        value: "First, Second, and Third Prize, plus Honorable Mentions. Amounts are confirmed by organizers.",
    },
]);

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
    <div class="mt-4">
        <section class="border-b border-default pb-10">
            <div class="flex flex-wrap items-center gap-3">
                <span
                    class="border border-primary px-3 py-1 font-mono text-xs tracking-[0.2em] text-primary uppercase"
                >
                    {{ statusLabel }}
                </span>
                <span class="text-xs text-muted">All deadlines use Asia/Shanghai (UTC+8)</span>
            </div>

            <h1
                class="mt-6 text-[clamp(2.75rem,9vw,7rem)] leading-[0.88] font-black tracking-[-0.04em]"
            >
                BIBS-C Network
                <span class="block text-primary">Hackathon</span>
            </h1>

            <p class="mt-6 max-w-3xl text-lg leading-8 text-muted">
                The official event platform is
                <span class="font-semibold text-default">{{ WEBSITE_NAME }}</span>
                . Teams use it to register, submit projects, vote for their favorites, and publish
                results. Build something real, document it clearly, and show how you used AI.
            </p>

            <div class="mt-7 flex flex-wrap gap-3">
                <UButton v-if="primaryCta" :to="primaryCta.to" size="xl" class="min-h-11">
                    {{ primaryCta.label }}
                </UButton>
                <UButton v-else size="xl" class="min-h-11" disabled>
                    Maintenance in progress
                </UButton>
                <UButton :to="secondaryCta.to" size="xl" variant="subtle" class="min-h-11">
                    {{ secondaryCta.label }}
                </UButton>
            </div>

            <p v-if="status === 'paused'" class="mt-4 text-sm text-muted" role="status">
                The website is under maintenance. Please check back later.
            </p>

            <dl
                class="mt-10 grid grid-cols-1 border-l border-t border-default sm:grid-cols-2 lg:grid-cols-3"
            >
                <div
                    v-for="fact in facts"
                    :key="fact.label"
                    class="border-r border-b border-default p-4"
                >
                    <dt class="font-mono text-xs tracking-[0.18em] text-muted uppercase">
                        {{ fact.label }}
                    </dt>
                    <dd class="mt-2 text-sm leading-6">{{ fact.value }}</dd>
                </div>
            </dl>

            <p
                v-if="announcement"
                class="mt-6 border-l-2 border-primary pl-4 whitespace-pre-wrap text-muted"
            >
                {{ announcement }}
            </p>
        </section>

        <section v-if="status !== 'finished'" class="mt-10">
            <div class="flex flex-wrap items-end justify-between gap-3">
                <h2 class="text-3xl font-bold">Schedule</h2>
                <p class="text-sm text-muted">Times shown in Asia/Shanghai (UTC+8)</p>
            </div>

            <ul v-if="status !== 'paused'" class="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
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

        <section class="mt-12">
            <h2 class="text-3xl font-bold">How it works</h2>
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

        <section class="mt-12">
            <h2 class="text-3xl font-bold">Theme</h2>
            <p v-if="!hackathon.theme_name" class="mt-3 text-muted">
                The theme will be revealed
                <template v-if="hasStart">
                    on
                    <DateTime class="font-semibold text-default" :date="startDate" />
                </template>
                <template v-else>soon</template>
                .
            </p>
            <template v-else>
                <p class="mt-3 text-lg">
                    The theme is
                    <span class="font-bold text-primary">{{ hackathon.theme_name }}</span>
                    .
                </p>
                <p v-if="themeDescription" class="mt-3 max-w-3xl whitespace-pre-wrap text-muted">
                    {{ themeDescription }}
                </p>
            </template>
        </section>

        <section class="mt-12 grid grid-cols-1 gap-5 lg:grid-cols-2">
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

        <section class="mt-12">
            <div class="flex flex-wrap items-end justify-between gap-3">
                <h2 class="text-3xl font-bold">FAQ</h2>
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

        <section v-if="galleryPublic || resultsPublished" class="mt-12 flex flex-wrap gap-3">
            <UButton v-if="galleryPublic" to="/projects" variant="subtle" class="min-h-11">
                Browse this season's projects
            </UButton>
            <UButton v-if="resultsPublished" to="/results" variant="subtle" class="min-h-11">
                See published results
            </UButton>
        </section>
    </div>
</template>
