<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NethackPermissions } from "~~/shared/permissions";
import { WEBSITE_NAME } from "~/utils/consts";

definePageMeta({
    layout: "fullwidth",
    hideFooter: true,
    middleware: ["auth"],
});
useHead({ title: `Judging history | ${WEBSITE_NAME}` });

const route = useRoute();
const rawSeasonId = Number(route.params.seasonId);
if (!Number.isInteger(rawSeasonId) || rawSeasonId <= 0) {
    throw await navigateTo("/judging");
}
const seasonId = rawSeasonId;

const { error: userError } = await useApiUser();
const { can } = useNethackPermissions();
if (userError.value) throw userError.value;
if (!can(NethackPermissions.Judging.assignmentsRead)) {
    throw await navigateTo("/");
}

const { data, error, status, refresh } = await useApiFetch<GetJudgingHistoryResponse>(
    () => `/api/judging/history/${seasonId}`,
    { server: false },
);

const selectedTeamId = ref<number | null>(null);
const items = computed(() => data.value?.items ?? []);
const loading = computed(() => status.value === "idle" || status.value === "pending");
const selectedItem = computed(
    () =>
        items.value.find((item) => item.team.id === selectedTeamId.value) ?? items.value[0] ?? null,
);
const selectedIndex = computed(() =>
    selectedItem.value ? items.value.indexOf(selectedItem.value) : -1,
);
const selectedRepoUrl = computed(() => safeUrl(selectedItem.value?.team.project.repo_url));
const selectedDemoUrl = computed(() => safeUrl(selectedItem.value?.team.project.demo_url));
const selectedHasDescription = computed(() =>
    Boolean(selectedItem.value?.team.project.description?.trim()),
);
const selectedHasSourcing = computed(() =>
    Boolean(selectedItem.value?.team.project.sourcing?.trim()),
);
const selectedTeamLabel = computed(() => selectedItem.value?.team.name?.trim() || "This team");

watch(
    items,
    (list) => {
        if (!list.some((item) => item.team.id === selectedTeamId.value)) {
            selectedTeamId.value = list[0]?.team.id ?? null;
        }
    },
    { immediate: true },
);

function selectRelative(offset: number) {
    const next = items.value[selectedIndex.value + offset];
    if (next) selectedTeamId.value = next.team.id;
}
</script>

<template>
    <main class="mx-auto w-full max-w-6xl px-4 pb-10 pt-4 sm:px-6">
        <NuxtLink
            to="/judging"
            class="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary"
        >
            <UIcon name="i-lucide-arrow-left" aria-hidden="true" />
            Back to judging
        </NuxtLink>

        <header class="mt-2 mb-5">
            <h1 class="text-3xl font-bold text-primary glow sm:text-4xl">Judging history</h1>
            <p class="mt-2 text-muted">
                <template v-if="data">
                    Your finalized evaluations for
                    <span class="font-semibold text-default">{{ data.season.name }}</span>
                    . This view is read-only.
                </template>
                <template v-else>Your finalized evaluations for a past season.</template>
            </p>
        </header>

        <UAlert
            v-if="error"
            color="error"
            icon="i-lucide-circle-alert"
            title="Could not load your past evaluations"
            :description="getErrorMessage(error)"
            class="mb-5"
        >
            <template #actions>
                <UButton variant="outline" class="min-h-11" @click="() => refresh()">
                    Try again
                </UButton>
            </template>
        </UAlert>

        <p v-else-if="loading" class="rounded-xl border border-default p-4 text-sm text-muted">
            Loading your saved evaluations…
        </p>

        <p
            v-else-if="items.length === 0"
            class="rounded-xl border border-default p-4 text-sm text-muted"
        >
            You have no finalized evaluations for this season.
            <template v-if="data && data.unavailable_evaluations > 0">
                {{ data.unavailable_evaluations }} saved evaluation(s) could not be displayed
                because their rubric is no longer available.
            </template>
        </p>

        <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]">
            <nav aria-label="Evaluated projects" class="min-w-0 md:sticky md:top-4 md:self-start">
                <h2 class="mb-2 text-sm font-semibold text-muted">
                    {{ items.length }} evaluated
                    {{ items.length === 1 ? "project" : "projects" }}
                </h2>
                <ol class="max-h-[70vh] space-y-2 overflow-y-auto pe-1">
                    <li v-for="item in items" :key="item.team.id">
                        <button
                            type="button"
                            class="flex min-h-11 w-full flex-col gap-1 rounded-xl border p-3 text-left transition"
                            :class="
                                item.team.id === selectedItem?.team.id
                                    ? 'border-primary bg-primary/10'
                                    : 'border-default hover:bg-elevated'
                            "
                            :aria-current="
                                item.team.id === selectedItem?.team.id ? 'true' : undefined
                            "
                            @click="selectedTeamId = item.team.id"
                        >
                            <span class="flex min-w-0 items-baseline justify-between gap-2">
                                <span class="min-w-0 truncate font-semibold">
                                    {{ item.team.project.name }}
                                </span>
                                <span
                                    class="shrink-0 text-sm font-semibold text-primary tabular-nums"
                                >
                                    {{ item.unavailable ? "—" : item.normalized_score }}
                                </span>
                            </span>
                            <span class="truncate text-sm text-muted">{{ item.team.name }}</span>
                        </button>
                    </li>
                </ol>
            </nav>

            <article
                v-if="selectedItem"
                class="min-w-0 rounded-xl border border-default p-4 sm:p-6"
            >
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="flex flex-wrap items-center gap-2">
                        <UBadge
                            variant="outline"
                            :color="selectedItem.team.pathway === 'junior' ? 'primary' : 'warning'"
                        >
                            {{ selectedItem.track_name }}
                        </UBadge>
                        <span class="text-sm text-muted">{{ selectedItem.team.name }}</span>
                    </div>
                    <div class="flex gap-2">
                        <UButton
                            variant="outline"
                            icon="i-lucide-arrow-left"
                            class="min-h-11"
                            aria-label="Previous evaluated project"
                            :disabled="selectedIndex <= 0"
                            @click="selectRelative(-1)"
                        >
                            Previous
                        </UButton>
                        <UButton
                            variant="outline"
                            trailing-icon="i-lucide-arrow-right"
                            class="min-h-11"
                            aria-label="Next evaluated project"
                            :disabled="selectedIndex >= items.length - 1"
                            @click="selectRelative(1)"
                        >
                            Next
                        </UButton>
                    </div>
                </div>

                <h2 class="mt-3 break-words text-2xl font-bold">
                    {{ selectedItem.team.project.name || "Untitled project" }}
                </h2>

                <UAlert
                    v-if="selectedItem.unavailable"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    title="Saved rubric unavailable"
                    description="The project details and your written feedback are still shown. The score breakdown cannot be reconstructed because its rubric version is no longer available."
                    class="mt-4"
                />

                <dl class="my-4 divide-y divide-default rounded-xl border border-default">
                    <div class="grid gap-1 p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
                        <dt class="text-sm font-semibold text-muted">Team</dt>
                        <dd class="min-w-0">
                            {{ selectedItem.team.name || "This team did not provide a team name." }}
                        </dd>
                    </div>
                    <div class="grid gap-1 p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
                        <dt class="text-sm font-semibold text-muted">Pathway</dt>
                        <dd class="min-w-0">{{ selectedItem.track_name }}</dd>
                    </div>
                    <div class="grid gap-1 p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
                        <dt class="text-sm font-semibold text-muted">Project name</dt>
                        <dd class="min-w-0">
                            {{
                                selectedItem.team.project.name ||
                                `${selectedTeamLabel} did not provide a project name.`
                            }}
                        </dd>
                    </div>
                    <div class="grid gap-1 p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
                        <dt class="text-sm font-semibold text-muted">Project description</dt>
                        <dd class="min-w-0">
                            <SafeComark
                                v-if="selectedHasDescription"
                                class="text-wrap leading-relaxed"
                            >
                                {{ selectedItem.team.project.description }}
                            </SafeComark>
                            <p v-else class="text-sm text-muted">
                                {{ selectedTeamLabel }} did not provide a project description.
                            </p>
                        </dd>
                    </div>
                    <div class="grid gap-1 p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
                        <dt class="text-sm font-semibold text-muted">AI-use disclosure</dt>
                        <dd class="min-w-0">
                            <SafeComark
                                v-if="selectedHasSourcing"
                                class="text-wrap leading-relaxed"
                            >
                                {{ selectedItem.team.project.sourcing }}
                            </SafeComark>
                            <p v-else class="text-sm text-muted">
                                {{ selectedTeamLabel }} did not provide an AI-use disclosure.
                            </p>
                        </dd>
                    </div>
                    <div class="grid gap-1 p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
                        <dt class="text-sm font-semibold text-muted">Repository</dt>
                        <dd class="min-w-0">
                            <UButton
                                v-if="selectedRepoUrl"
                                :href="selectedRepoUrl"
                                external
                                target="_blank"
                                rel="noopener noreferrer"
                                variant="subtle"
                                icon="i-material-symbols-merge"
                                class="min-h-11"
                            >
                                Open repository
                            </UButton>
                            <p v-else class="text-sm text-muted">
                                {{ selectedTeamLabel }} did not provide a repository link.
                            </p>
                        </dd>
                    </div>
                    <div class="grid gap-1 p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
                        <dt class="text-sm font-semibold text-muted">Demo</dt>
                        <dd class="min-w-0">
                            <UButton
                                v-if="selectedDemoUrl"
                                :href="selectedDemoUrl"
                                external
                                target="_blank"
                                rel="noopener noreferrer"
                                variant="subtle"
                                icon="i-material-symbols-play-arrow"
                                class="min-h-11"
                            >
                                Open demo
                            </UButton>
                            <p v-else class="text-sm text-muted">
                                {{ selectedTeamLabel }} did not provide a demo link.
                            </p>
                        </dd>
                    </div>
                    <div class="grid gap-1 p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
                        <dt class="text-sm font-semibold text-muted">Submission</dt>
                        <dd class="min-w-0">
                            {{
                                selectedItem.team.project.submitted
                                    ? "Submitted for judging."
                                    : "This project was not marked as submitted."
                            }}
                        </dd>
                    </div>
                </dl>

                <div class="rounded-xl bg-primary/10 p-4">
                    <p class="text-sm text-default">Your weighted score</p>
                    <p v-if="selectedItem.unavailable" class="mt-1 text-2xl font-bold text-muted">
                        Unavailable
                    </p>
                    <template v-else>
                        <p class="mt-1 text-3xl font-bold text-primary">
                            {{ selectedItem.normalized_score }}
                            <span class="text-lg">/ 100</span>
                        </p>
                        <p class="mt-1 text-sm text-default">
                            {{ selectedItem.rubric_name }} · version
                            {{ selectedItem.rubric_version }}
                        </p>
                    </template>
                </div>

                <section
                    v-if="!selectedItem.unavailable"
                    class="mt-5"
                    aria-labelledby="history-criteria-heading"
                >
                    <h3 id="history-criteria-heading" class="mb-2 font-semibold">
                        Criterion scores
                    </h3>
                    <dl class="divide-y divide-default rounded-xl border border-default">
                        <div
                            v-for="criterion in selectedItem.criteria"
                            :key="criterion.id"
                            class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3"
                        >
                            <dt class="min-w-0 flex-1">
                                <span class="font-medium">{{ criterion.name }}</span>
                                <span class="ml-2 text-sm text-muted">{{ criterion.weight }}%</span>
                            </dt>
                            <dd class="shrink-0 font-semibold tabular-nums">
                                {{ selectedItem.scores[criterion.id] ?? "—" }}
                                <span class="font-normal text-muted">
                                    /{{ criterion.maxScore }}
                                </span>
                            </dd>
                        </div>
                    </dl>
                </section>

                <section class="mt-5" aria-labelledby="history-feedback-heading">
                    <h3 id="history-feedback-heading" class="mb-2 font-semibold">
                        Your anonymous feedback
                    </h3>
                    <p
                        class="whitespace-pre-wrap rounded-xl bg-elevated p-4 leading-relaxed [overflow-wrap:anywhere]"
                    >
                        {{ selectedItem.reasoning }}
                    </p>
                </section>

                <p v-if="data && data.unavailable_evaluations > 0" class="mt-4 text-sm text-muted">
                    {{ data.unavailable_evaluations }} evaluation(s) could not be displayed because
                    their saved rubric is no longer available.
                </p>
            </article>
        </div>
    </main>
</template>
