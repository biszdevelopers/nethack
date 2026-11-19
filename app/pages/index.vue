<script setup lang="ts">
useHead({
    title: `${WEBSITE_NAME}`,
});

const { data, error } = await useApiFetch("/api/seasons/active", { $fetch: globalThis.$fetch });
if (error.value) {
    throw error.value;
}
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
</script>

<template>
    <div class="mt-4">
        <h1 class="text-4xl bold mb-4 glow">
            Welcome to
            <span class="text-primary">{{ WEBSITE_NAME }}</span>
            !
        </h1>
        <p class="mb-4">
            The BIBS-C Network Hackathon brings creativity and technology together as teams turn
            ideas into prototypes and build for the future with
            <span class="text-primary glow">{{ WEBSITE_NAME }}</span>
            .
        </p>
        <p v-if="announcement" class="mb-4 whitespace-pre-wrap text-muted">
            {{ announcement }}
        </p>
        <ULink href="/dashboard">
            <span v-if="status === 'not_started'" class="sr-only">Go to your dashboard</span>
            <UAlert v-else variant="soft" class="mb-4">
                <template #title>
                    <span class="bold">
                        The hackathon has
                        {{ status === "finished" ? "finished" : "started" }}!
                    </span>
                    Click here to go to your dashboard!
                </template>
            </UAlert>
        </ULink>

        <!-- schedule -->
        <h2 v-if="status !== 'finished'" class="text-3xl bold mb-4 glow-sm">Schedule</h2>
        <p v-if="status === 'paused'" class="mb-4">
            The website is currently under maintenance. Please check back later.
        </p>
        <ul v-else-if="status !== 'finished'" class="grid grid-cols-1 lg:grid-cols-2 mb-4 gap-4">
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

        <UCollapsible class="mb-4">
            <template #default="{ open }">
                <button type="button" class="text-left">
                    {{ open ? "▼" : "▶" }} Detailed schedule
                </button>
            </template>

            <template #content>
                <ul class="mb-4 whitespace-pre-wrap">
                    <li>
                        {{ "" }}* Hackathon starts:{{ "  " }}
                        <DateTime v-if="hasStart" :date="startDate" />
                        <span v-else>To be announced</span>
                    </li>
                    <li>
                        {{ "" }}* Hackathon ends:{{ "    " }}
                        <DateTime v-if="hasEnd" :date="endDate" />
                        <span v-else>To be announced</span>
                    </li>
                    <li>
                        {{ "" }}* Voting starts:{{ "     " }}
                        <DateTime v-if="hasVotingStart" :date="votingStartDate" />
                        <span v-else>To be announced</span>
                    </li>
                    <li>
                        {{ "" }}* Voting ends:{{ "       " }}
                        <DateTime v-if="hasVotingEnd" :date="votingEndDate" />
                        <span v-else>To be announced</span>
                    </li>
                    <li>
                        {{ "" }}* Results released:{{ "  " }}
                        <DateTime v-if="hasResultsOpen" :date="resultsOpenDate" />
                        <span v-else>To be announced</span>
                    </li>
                </ul>
            </template>
        </UCollapsible>

        <!-- theme -->
        <h2 class="text-3xl bold mb-4 glow-sm">Theme</h2>
        <p v-if="!hackathon.theme_name" class="mb-4">
            The theme of the hackathon will be revealed
            <template v-if="hasStart">
                on
                <DateTime class="bold" :date="startDate" />
            </template>
            <template v-else>soon</template>
            .
        </p>
        <template v-else>
            <p class="mb-2">
                The theme of the hackathon is:
                <span class="bold glow text-primary">{{ hackathon.theme_name }}</span>
                !
            </p>
            <p class="mb-4 whitespace-pre-wrap">{{ themeDescription }}</p>
        </template>

        <h2 class="text-3xl bold mb-4 glow-sm">Resources</h2>
        <p class="mb-2">Here are some resources to help you get started:</p>
        <ul class="mb-4">
            <li>
                * Check out the projects made in
                <ULink to="/showcase" class="inline-flex min-h-11 items-center">
                    last year's network hackathon!
                </ULink>
                Maybe you'll find inspiration there.
            </li>
            <li>
                * Check out
                <ULink href="/rules" class="inline-flex min-h-11 items-center">
                    the rules for the hackathon
                </ULink>
                and start planning your project accordingly.
            </li>
        </ul>
    </div>
</template>
