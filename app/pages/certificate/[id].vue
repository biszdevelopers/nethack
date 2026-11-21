<script setup lang="ts">
import { formatDateTime } from "~/utils/datetime";

definePageMeta({
    layout: "default",
});

const route = useRoute();
const certificateID = Number(route.params.id);
if (!Number.isInteger(certificateID) || certificateID <= 0) {
    throw createError({ statusCode: 404, statusMessage: "Certificate not found", fatal: true });
}

const {
    data: team,
    error: teamError,
    status: teamStatus,
} = await useApiFetch<GetTeamResponse>(`/api/teams/${certificateID}`, {
    $fetch: globalThis.$fetch,
});
const { data: seasons } = await useApiFetch<PublicSeason[]>("/api/seasons", {
    lazy: true,
    $fetch: globalThis.$fetch,
});

const season = computed(() => {
    const seasonID = team.value?.season_id;
    if (!seasonID) return null;
    return seasons.value?.find((item) => item.id === seasonID) ?? null;
});
const resultsPublished = computed(() => Boolean(season.value?.results_published));
const certificateAvailable = computed(() => Boolean(team.value) && resultsPublished.value);
const loading = computed(() => teamStatus.value === "idle" || teamStatus.value === "pending");

const certificateTitle = computed(() => {
    const projectName = team.value?.project.name || team.value?.name;
    return projectName ? `${projectName} · Certificate` : "Certificate";
});

useHead(() => ({
    title: certificateAvailable.value
        ? `${certificateTitle.value} | ${WEBSITE_NAME}`
        : `Certificate unavailable | ${WEBSITE_NAME}`,
    meta: [{ name: "robots", content: "noindex, nofollow" }],
}));

const statusLabel = computed(() => {
    const status = team.value?.status;
    return status && status !== "active" ? status.replaceAll("_", " ") : null;
});

function printCertificate() {
    if (import.meta.client) window.print();
}
</script>

<template>
    <div class="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <div class="no-print mb-5 flex flex-wrap items-center justify-between gap-2">
            <UButton to="/results" variant="ghost" leading-icon="i-lucide-arrow-left">
                Back to results
            </UButton>
            <UButton
                v-if="certificateAvailable"
                icon="i-lucide-printer"
                class="min-h-11"
                @click="printCertificate"
            >
                Print certificate
            </UButton>
        </div>

        <p v-if="loading" class="text-muted" aria-live="polite">Loading the certificate…</p>

        <section
            v-else-if="!certificateAvailable"
            class="rounded-xl border border-default bg-elevated/40 p-6 sm:p-8"
            aria-labelledby="certificate-unavailable-heading"
        >
            <UIcon name="i-lucide-file-lock-2" class="mb-3 size-8 text-muted" aria-hidden="true" />
            <h1 id="certificate-unavailable-heading" class="text-2xl font-bold">
                Certificate not available
            </h1>
            <p v-if="teamError" class="mt-3 max-w-prose text-sm text-muted">
                This certificate is not available. It may belong to a team that has not submitted a
                project, or the link may be incorrect.
            </p>
            <p v-else-if="!resultsPublished" class="mt-3 max-w-prose text-sm text-muted">
                Results for this season have not been published yet. Certificates become available
                after organizers publish the final standings.
            </p>
            <p v-else class="mt-3 max-w-prose text-sm text-muted">
                This team does not have a certificate for the selected season.
            </p>
            <div class="mt-5 flex flex-wrap gap-2">
                <UButton to="/results" variant="subtle" class="min-h-11">View results</UButton>
                <UButton to="/" variant="outline" class="min-h-11">Back to the event</UButton>
            </div>
        </section>

        <article
            v-else-if="team"
            class="certificate rounded-xl border-2 border-default bg-default p-8 text-center sm:p-12"
            aria-labelledby="certificate-heading"
        >
            <p class="font-mono text-xs tracking-wide text-primary">
                {{ WEBSITE_NAME }}
            </p>
            <h1 id="certificate-heading" class="mt-4 text-3xl font-black sm:text-4xl">
                Certificate of Achievement
            </h1>
            <p class="mt-2 text-sm text-muted">Awarded to</p>

            <p class="mt-6 break-words text-2xl font-bold sm:text-3xl">
                {{ team.project.name || team.name }}
            </p>
            <p class="mt-2 break-words text-lg text-muted">{{ team.name }}</p>

            <p v-if="season" class="mt-2 text-sm text-muted">
                {{ season.name }}
                <template v-if="season.start_timestamp">
                    · {{ formatDateTime(season.start_timestamp) }}
                </template>
            </p>

            <div
                v-if="team.rank || team.awards.length > 0"
                class="mx-auto mt-8 flex max-w-md flex-col items-center gap-3"
            >
                <p v-if="team.rank" class="text-xl font-semibold">Rank #{{ team.rank }}</p>
                <div v-if="team.awards.length > 0" class="flex flex-wrap justify-center gap-2">
                    <UBadge
                        v-for="award in team.awards"
                        :key="award.namespace"
                        variant="subtle"
                        color="warning"
                        size="lg"
                    >
                        {{ award.name }}
                    </UBadge>
                </div>
            </div>

            <p v-if="statusLabel" class="mt-6 text-sm capitalize text-muted">
                Team status: {{ statusLabel }}
            </p>

            <div class="mt-10 border-t border-default pt-4">
                <p class="text-xs text-muted">
                    Issued by the {{ WEBSITE_NAME }} organizers
                    <template v-if="season?.name">for {{ season.name }}</template>
                    .
                </p>
            </div>
        </article>
    </div>
</template>

<style scoped>
@media print {
    .no-print {
        display: none !important;
    }

    :global(header),
    :global(footer),
    :global(nav) {
        display: none !important;
    }

    .certificate {
        min-height: 0;
        border-color: #111111 !important;
        background: #ffffff !important;
        color: #111111 !important;
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
    }
}

@page {
    margin: 18mm;
}
</style>
