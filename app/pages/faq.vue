<script setup lang="ts">
type FaqItem = { question: string; answer: string; link?: { label: string; to: string } };

const faqItems: FaqItem[] = [
    {
        question: "Who can participate?",
        answer: "The event is open to BIBS-C Network students. Sign in with your basis-auth account, then create a team or accept a team invitation from a classmate.",
        link: { label: "Sign in and open the dashboard", to: "/dashboard" },
    },
    {
        question: "How large can a team be?",
        answer: "A team can have up to six members, including the member who created it. Remove inactive members before sending new invitations.",
    },
    {
        question: "What must a submission include?",
        answer: "A public repository with the complete source code, a complete README in American English, a working demo URL, a demonstration video between two and three minutes long with no audio, and a complete AI-use disclosure.",
        link: { label: "Read the full requirements", to: "/rules" },
    },
    {
        question: "Which repository platforms are accepted?",
        answer: "GitHub is preferred. GitLab, Codeberg, and Gitee are also accepted as long as the repository is publicly readable and stays available through evaluation.",
    },
    {
        question: "Is AI allowed?",
        answer: 'Yes. AI tools are permitted, but every project component that was generated or substantially assisted by AI must be disclosed. Name the tools and the specific parts they helped with. A statement such as "AI was used" is not sufficient.',
        link: { label: "AI disclosure rules", to: "/rules#phase-1" },
    },
    {
        question: "When are the deadlines?",
        answer: "Every published deadline uses Asia/Shanghai (UTC+8). The home page shows the live schedule and countdowns. Late submissions are not accepted after the deadline except for a documented platform failure confirmed by organizers.",
        link: { label: "Live schedule", to: "/" },
    },
    {
        question: "How are projects evaluated?",
        answer: "Judges score each project against the season's published rubric. Participants also distribute 10 stars across eligible projects in their own pathway during peer voting. Rankings and awards appear only after results are published.",
        link: { label: "Published results", to: "/results" },
    },
    {
        question: "How do we get help?",
        answer: "Contact the BIBS-C Developers' Club by email or Microsoft Teams. Include your team name, the page you are using, and what you expected to happen.",
        link: { label: "Contact support", to: "/contact" },
    },
    {
        question: "How is our data handled?",
        answer: "Account identity, team membership, submissions, and judging records are used to run the competition and the public showcase. See the privacy and data-retention section of the rules for retention and deletion requests.",
        link: { label: "Privacy and data retention", to: "/rules#privacy-and-data-retention" },
    },
];

useHead(
    pageSeo({
        title: `FAQ | ${WEBSITE_NAME}`,
        description:
            "Answers about eligibility, team size, submissions, AI-use disclosure, deadlines, judging, and support for the BIBS-C Network Hackathon.",
        path: "/faq",
    }),
);
</script>

<template>
    <div class="mt-4 max-w-4xl">
        <header>
            <p class="font-mono text-xs tracking-wide text-primary">Help centre</p>
            <h1 class="mt-3 text-4xl font-black tracking-tight sm:text-6xl">FAQ</h1>
            <p class="mt-4 max-w-2xl text-base leading-7 text-muted">
                Short answers for participants. The
                <ULink to="/rules" class="underline">competition rules</ULink>
                remain the binding document when the two differ.
            </p>
        </header>

        <div class="mt-10 divide-y divide-default border-y border-default">
            <details v-for="item in faqItems" :key="item.question" class="group py-5">
                <summary
                    class="flex min-h-11 cursor-pointer items-center justify-between gap-4 text-lg font-semibold"
                >
                    {{ item.question }}
                    <UIcon
                        name="i-lucide-chevron-down"
                        class="shrink-0 transition group-open:rotate-180"
                    />
                </summary>
                <p class="mt-3 max-w-3xl text-sm leading-7 text-muted">{{ item.answer }}</p>
                <ULink
                    v-if="item.link"
                    :to="item.link.to"
                    class="mt-3 inline-flex min-h-11 items-center gap-1 text-sm"
                >
                    {{ item.link.label }}
                    <UIcon name="i-lucide-arrow-right" />
                </ULink>
            </details>
        </div>

        <section class="mt-10 border border-default p-6">
            <h2 class="text-2xl font-bold">Still stuck?</h2>
            <p class="mt-3 text-sm leading-6 text-muted">
                Contact the organizers. For rule clarifications, appeals, and privacy requests, use
                the dedicated contact page so the message reaches the right organizers.
            </p>
            <UButton to="/contact" class="mt-5 min-h-11" variant="subtle">Contact support</UButton>
        </section>
    </div>
</template>
