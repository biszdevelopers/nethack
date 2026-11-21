<script setup lang="ts">
const teamsChannelUrl =
    "https://teams.microsoft.com/l/channel/19%3AS3B3lM0EUkIeBixZSQN6dZanoQv5GfVFr6kiVuf_P3U1%40thread.tacv2/General?groupId=b207a655-d801-4200-8345-5dcc50d6d957&tenantId=cbc6e1e2-a6bb-4002-bbdc-6da892a051a7";

useHead(
    pageSeo({
        title: `Contact | ${WEBSITE_NAME}`,
        description:
            "Contact the BIBS-C Developers' Club about the hackathon, rule clarifications, appeals, privacy requests, or platform problems.",
        path: "/contact",
    }),
);
</script>

<template>
    <div class="mt-4 max-w-3xl">
        <header>
            <p class="font-mono text-xs tracking-[0.28em] text-primary uppercase">Support</p>
            <h1 class="mt-3 text-4xl font-black tracking-tight sm:text-6xl">Contact</h1>
            <p class="mt-4 text-base leading-7 text-muted">
                The BIBS-C Developers' Club runs the hackathon and maintains {{ WEBSITE_NAME }}.
                Choose the channel that matches your request.
            </p>
        </header>

        <section class="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div class="border border-default p-6">
                <h2 class="text-xl font-bold">Email</h2>
                <p class="mt-3 text-sm leading-6 text-muted">
                    Best for rule clarifications, appeals, privacy requests, and anything that
                    should not be public.
                </p>
                <ULink
                    to="mailto:devclub-bisz@basischina.com"
                    class="mt-4 inline-flex min-h-11 items-center gap-2 font-semibold text-primary"
                >
                    <UIcon name="i-lucide-mail" />
                    devclub-bisz@basischina.com
                </ULink>
            </div>

            <div class="border border-default p-6">
                <h2 class="text-xl font-bold">Microsoft Teams</h2>
                <p class="mt-3 text-sm leading-6 text-muted">
                    Best for quick questions during the event. Join the club channel and ask in the
                    general conversation.
                </p>
                <UButton
                    :to="teamsChannelUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="mt-4 min-h-11"
                    variant="subtle"
                >
                    Open the Teams channel
                </UButton>
            </div>
        </section>

        <section class="mt-8 border border-default p-6">
            <h2 class="text-xl font-bold">What to include</h2>
            <ul class="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-muted">
                <li>Your team name and the account you used to sign in.</li>
                <li>What you were trying to do and what happened instead.</li>
                <li>The page address, plus a screenshot when the problem is visual.</li>
                <li>
                    For appeals: the season, the submission, and the outcome you are asking us to
                    review.
                </li>
            </ul>
            <p class="mt-4 text-sm leading-6 text-muted">
                Appeals must be sent within 48 hours of the published result. Privacy and
                data-retention requests follow the deadlines in the
                <ULink to="/rules#privacy-and-data-retention" class="underline">
                    privacy and data-retention section
                </ULink>
                .
            </p>
        </section>

        <section class="mt-8 flex flex-wrap gap-3">
            <UButton to="/faq" variant="subtle" class="min-h-11">Read the FAQ</UButton>
            <UButton to="/rules" variant="subtle" class="min-h-11">Competition rules</UButton>
        </section>
    </div>
</template>
