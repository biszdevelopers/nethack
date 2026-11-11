<script setup lang="ts">
useHead({
    title: `${WEBSITE_NAME}`,
});

const { data, error } = await useFetch("/api/seasons/active");
if (error.value) {
    throw error.value;
}
const hackathon = computed(() => data.value!);

const status = computed(() => hackathon.value.status);
const startDate = computed(() => new Date(hackathon.value.start_timestamp));
const endDate = computed(() => new Date(hackathon.value.end_timestamp));
const votingStartDate = computed(() => new Date(hackathon.value.voting_start_timestamp));
const votingEndDate = computed(() => new Date(hackathon.value.voting_end_timestamp));
const resultsOpenDate = computed(() => new Date(hackathon.value.results_open_timestamp));

const themeDescription = computed(() => hackathon.value.theme_description || "");
</script>

<template>
    <div class="mt-4">
        <h1 class="text-4xl bold mb-4 glow">
            Welcome to
            <span class="text-primary">{{ WEBSITE_NAME }}</span>
            !
        </h1>
        <p class="mb-4">
            This is the official website of the 2025-26 BIBS-C Network Hackathon (
            <span class="text-primary glow">{{ WEBSITE_NAME }}</span>
            ), a week where creativity meets technology, where ideas transform into prototypes, and
            where brilliant minds come together to build the future.
        </p>
        <ULink href="/dashboard">
            <UAlert v-if="status !== 'not_started'" variant="soft" class="mb-4">
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
            <li v-if="status === 'not_started'">
                <LargeCountdown :date="startDate" label="Hackathon starts" />
            </li>
            <li v-if="status === 'not_started' || status === 'in_progress'">
                <LargeCountdown :date="endDate" label="Hackathon ends" />
            </li>
            <li v-if="status === 'in_progress'">
                <LargeCountdown :date="votingStartDate" label="Voting starts" />
            </li>
            <li v-if="status === 'voting'">
                <LargeCountdown :date="votingEndDate" label="Voting ends" />
            </li>
            <li v-if="status === 'voting'">
                <LargeCountdown :date="resultsOpenDate" label="Results released" />
            </li>
        </ul>

        <UCollapsible class="mb-4">
            <template #default="{ open }">
                <p>{{ open ? "▼" : "▶" }} Detailed schedule</p>
            </template>

            <template #content>
                <ul class="mb-4 whitespace-pre-wrap">
                    <li>
                        {{ "" }}* Hackathon starts:{{ "  " }}
                        <DateTime :date="startDate" />
                    </li>
                    <li>
                        {{ "" }}* Hackathon ends:{{ "    " }}
                        <DateTime :date="endDate" />
                    </li>
                    <li>
                        {{ "" }}* Voting starts:{{ "     " }}
                        <DateTime :date="votingStartDate" />
                    </li>
                    <li>
                        {{ "" }}* Voting ends:{{ "       " }}
                        <DateTime :date="votingEndDate" />
                    </li>
                    <li>
                        {{ "" }}* Results released:{{ "  " }}
                        <DateTime :date="resultsOpenDate" />
                    </li>
                </ul>
            </template>
        </UCollapsible>

        <!-- theme -->
        <h2 class="text-3xl bold mb-4 glow-sm">Theme</h2>
        <p v-if="!hackathon.theme_name" class="mb-4">
            The theme of the hackathon will be revealed on
            <DateTime class="bold" :date="startDate" />
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
                <ULink
                    href="https://nethack.biszweb.club/showcase"
                    target="_blank"
                    class="inline-flex min-h-11 items-center"
                >
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
