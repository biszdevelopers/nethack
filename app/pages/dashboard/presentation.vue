<script lang="ts" setup>
import { WEBSITE_NAME } from "~/utils/consts";

useHead({ title: `Presentation | ${WEBSITE_NAME}` });

definePageMeta({
    layout: "dashboard",
    middleware: "auth",
});
</script>

<template>
    <div class="max-w-3xl">
        <h1 class="text-4xl font-bold glow">Presentation</h1>
        <p class="mt-4 text-muted">
            <span class="text-primary">{{ WEBSITE_NAME }}</span>
            events include an additional presentation stage after the submission and judging phases.
        </p>

        <h2 class="mt-8 text-2xl bold">Who presents</h2>
        <p class="mt-2">
            Teams in the top 10 are invited to present their projects in front of judges and
            students. The organizers contact invited teams with their slot and the venue details
            once the judging results are final.
        </p>

        <h2 class="mt-8 text-2xl bold">What to prepare</h2>
        <ul class="mt-2 list-inside list-disc space-y-2">
            <li>
                A live walkthrough of the project. Have any accounts, sample data, and local setup
                ready before your slot.
            </li>
            <li>
                A short explanation of the problem, your approach, and the parts of the project that
                used AI tools.
            </li>
            <li>
                A backup recording in case the live environment cannot run. It must still follow the
                silence and anonymity rules.
            </li>
            <li>Your repository link and README, in case judges want to inspect the source.</li>
        </ul>

        <h2 class="mt-8 text-2xl bold">Rules that still apply</h2>
        <p class="mt-2">
            Presentations must not reveal the identity of any participant unless the organizers
            explicitly ask for it. The
            <ULink href="/rules" class="text-default underline underline-offset-2">
                hackathon rules
            </ULink>
            cover the submission, AI-disclosure, and licensing requirements that apply before the
            presentation stage.
        </p>

        <USeparator class="mt-8" size="sm" />

        <p class="mt-8 text-muted">
            If you are invited, the organizers will contact your team through your registered basis
            email. Check the
            <ULink href="/dashboard" class="underline underline-offset-2">dashboard</ULink>
            for schedule updates.
        </p>
    </div>
</template>
