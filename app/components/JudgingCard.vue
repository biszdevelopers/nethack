<script setup lang="ts">
import { computed, nextTick, onMounted, useTemplateRef } from "vue";
import type { JudgingDraftStatus } from "~/composables/useJudgingDraft";
import {
    DEFAULT_JUDGE_COMMENT_GUIDANCE,
    isJudgeCommentReady,
    MIN_JUDGE_COMMENT_LENGTH,
    type JudgeCommentGuidance,
} from "~~/shared/judge-comments";
import type { RubricTrack } from "~~/shared/rubric";

const props = defineProps<{
    team: APITeam;
    track: RubricTrack;
    commentGuidance?: JudgeCommentGuidance;
    commentIdentityError?: string | null;
    scores: Record<string, number>;
    reasoning: string;
    draftStatus: JudgingDraftStatus;
    draftError: string | null;
    draftReady: boolean;
    readOnly?: boolean;
    draftSavedAt?: number | null;
}>();

const emit = defineEmits<{
    score: [criterionId: string, value: number];
    reasoning: [value: string];
    review: [];
    retry: [];
}>();

const projectHeading = useTemplateRef<HTMLHeadingElement>("projectHeading");
const reasoningInput = useTemplateRef<HTMLTextAreaElement>("reasoningInput");
const commentGuidance = computed(() => props.commentGuidance ?? DEFAULT_JUDGE_COMMENT_GUIDANCE);
const safeRepoUrl = computed(() => safeUrl(props.team.project.repo_url));
const safeDemoUrl = computed(() => safeUrl(props.team.project.demo_url));
const criterionControls = computed(() =>
    Object.fromEntries(
        props.track.criteria.map((criterion) => {
            const range = criterion.maxScore - criterion.minScore;
            return [
                criterion.id,
                range <= 10
                    ? Array.from({ length: range + 1 }, (_, index) => criterion.minScore + index)
                    : null,
            ];
        }),
    ),
);
const criteriaComplete = computed(() =>
    props.track.criteria.every((criterion) => {
        const value = props.scores[criterion.id];
        return (
            Number.isInteger(value) && value >= criterion.minScore && value <= criterion.maxScore
        );
    }),
);
const reasoningComplete = computed(() => isJudgeCommentReady(props.reasoning));
const canReview = computed(
    () =>
        criteriaComplete.value &&
        reasoningComplete.value &&
        !props.commentIdentityError &&
        props.draftReady &&
        props.draftStatus !== "loading",
);
const savedLabel = computed(() => {
    if (!props.draftSavedAt) return "Draft saved";
    return `Draft saved at ${new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
    }).format(props.draftSavedAt)}`;
});

function setScore(criterionId: string, value: number) {
    if (!props.readOnly) emit("score", criterionId, value);
}

function updateRangeScore(criterionId: string, event: Event) {
    setScore(criterionId, Number((event.target as HTMLInputElement).value));
}

function updateReasoning(event: Event) {
    emit("reasoning", (event.target as HTMLTextAreaElement).value);
}

async function appendCommentPrompt(prompt: string) {
    const existing = props.reasoning.trimEnd();
    const nextValue = existing ? `${existing}\n\n${prompt}` : prompt;
    emit("reasoning", nextValue);
    await nextTick();
    reasoningInput.value?.focus();
    reasoningInput.value?.setSelectionRange(nextValue.length, nextValue.length);
}

onMounted(() => nextTick(() => projectHeading.value?.focus()));
</script>

<template>
    <UCard variant="subtle" class="judging-card">
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
                <p class="text-sm text-muted">{{ team.name }}</p>
                <h2
                    ref="projectHeading"
                    tabindex="-1"
                    class="mt-1 break-words text-2xl font-bold outline-none focus-visible:ring-2 focus-visible:ring-primary sm:text-3xl"
                >
                    {{ team.project.name }}
                </h2>
            </div>
            <UBadge
                variant="outline"
                :color="team.pathway === 'junior' ? 'primary' : 'warning'"
                class="shrink-0"
            >
                {{ track.name }}
            </UBadge>
        </div>

        <SafeComark class="my-5 max-w-prose text-wrap leading-relaxed">
            {{ team.project.description }}
        </SafeComark>

        <UAlert
            v-if="team.project.sourcing"
            icon="i-lucide-book-open"
            color="info"
            variant="subtle"
            title="Team's AI-use statement"
            class="mb-5"
        >
            <template #description>
                <SafeComark>{{ team.project.sourcing }}</SafeComark>
            </template>
        </UAlert>

        <div class="flex flex-wrap gap-2">
            <UButton
                v-if="safeRepoUrl"
                :href="safeRepoUrl"
                external
                target="_blank"
                rel="noopener noreferrer"
                variant="subtle"
                icon="i-material-symbols-merge"
                class="min-h-11"
            >
                Open repository
            </UButton>
            <UButton
                v-if="safeDemoUrl"
                :href="safeDemoUrl"
                external
                target="_blank"
                rel="noopener noreferrer"
                variant="subtle"
                icon="i-material-symbols-play-arrow"
                class="min-h-11"
            >
                Open demo
            </UButton>
            <p v-if="!safeRepoUrl && !safeDemoUrl" class="text-sm text-muted">
                This project has no available repository or demo links.
            </p>
        </div>

        <USeparator class="my-6" />

        <section aria-labelledby="rubric-heading">
            <div class="mb-4">
                <p class="text-sm text-muted">Step 1</p>
                <h3 id="rubric-heading" class="text-xl font-bold sm:text-2xl">
                    {{ readOnly ? "Your submitted evaluation" : "Score this project" }}
                </h3>
                <p class="mt-1 text-sm text-muted">
                    {{
                        readOnly
                            ? "This evaluation is finalized and read-only."
                            : "Choose one score for every criterion. Your draft saves as you work."
                    }}
                </p>
            </div>

            <div class="space-y-4">
                <fieldset
                    v-for="criterion in track.criteria"
                    :key="criterion.id"
                    class="criterion-fieldset rounded-xl border border-default p-4"
                    :disabled="readOnly || !draftReady || draftStatus === 'loading'"
                >
                    <legend class="max-w-full px-1 text-base font-semibold">
                        {{ criterion.name }}
                        <span class="ml-1 text-sm font-normal text-muted">
                            {{ criterion.weight }}%
                        </span>
                    </legend>
                    <p
                        :id="`criterion-${team.id}-${criterion.id}-hint`"
                        class="mb-3 text-sm text-muted"
                    >
                        {{ criterion.description }}
                    </p>
                    <div
                        v-if="criterionControls[criterion.id]"
                        class="score-options"
                        role="radiogroup"
                        :aria-label="`${criterion.name} score`"
                        :aria-describedby="`criterion-${team.id}-${criterion.id}-hint`"
                    >
                        <label
                            v-for="score in criterionControls[criterion.id]"
                            :key="score"
                            class="score-option"
                            :class="{
                                'score-option-selected': scores[criterion.id] === score,
                                'score-option-disabled':
                                    readOnly || !draftReady || draftStatus === 'loading',
                            }"
                        >
                            <!-- prettier-ignore -->
                            <input
                                type="radio"
                                class="sr-only"
                                :name="`team-${team.id}-${criterion.id}`"
                                :value="score"
                                :checked="scores[criterion.id] === score"
                                :aria-label="`${score} of ${criterion.maxScore} for ${criterion.name}`"
                                @change="setScore(criterion.id, score)"
                            >
                            <span aria-hidden="true">{{ score }}</span>
                        </label>
                    </div>
                    <div v-else class="flex min-h-11 items-center gap-3">
                        <label class="sr-only" :for="`score-${team.id}-${criterion.id}`">
                            {{ criterion.name }} score from {{ criterion.minScore }} to
                            {{ criterion.maxScore }}
                        </label>
                        <!-- prettier-ignore -->
                        <input
                            :id="`score-${team.id}-${criterion.id}`"
                            type="range"
                            class="score-range min-h-11 min-w-0 flex-1"
                            :min="criterion.minScore"
                            :max="criterion.maxScore"
                            step="1"
                            :value="scores[criterion.id] ?? criterion.minScore"
                            :aria-valuetext="
                                scores[criterion.id] === undefined
                                    ? 'No score selected'
                                    : `${scores[criterion.id]} of ${criterion.maxScore}`
                            "
                            :disabled="readOnly || !draftReady || draftStatus === 'loading'"
                            @input="updateRangeScore(criterion.id, $event)"
                        >
                        <output
                            class="min-w-14 rounded-lg border border-default px-3 py-2 text-center font-semibold tabular-nums"
                            :for="`score-${team.id}-${criterion.id}`"
                            aria-live="polite"
                        >
                            {{ scores[criterion.id] ?? "Choose" }}
                        </output>
                    </div>
                    <p class="mt-2 text-xs text-muted">
                        {{ criterion.minScore }} = lowest · {{ criterion.maxScore }} = highest
                    </p>
                </fieldset>
            </div>

            <div class="mt-5">
                <UAlert
                    icon="i-lucide-message-square-heart"
                    color="info"
                    variant="subtle"
                    title="Write useful, anonymous feedback"
                    class="mb-4"
                >
                    <template #description>
                        <p>{{ commentGuidance.introduction }}</p>
                        <ul class="mt-2 list-disc space-y-1 pl-5">
                            <li
                                v-for="(guideline, index) in commentGuidance.guidelines"
                                :key="index"
                            >
                                {{ guideline }}
                            </li>
                        </ul>
                        <p class="mt-2 font-medium">
                            Teams can read this comment anonymously after results are published.
                        </p>
                    </template>
                </UAlert>
                <label :for="`reasoning-${team.id}`" class="mb-1 block text-sm font-medium">
                    Anonymous feedback and score rationale
                </label>
                <p :id="`reasoning-${team.id}-hint`" class="mb-2 text-sm text-muted">
                    Needs at least {{ MIN_JUDGE_COMMENT_LENGTH }} characters
                </p>
                <div
                    class="mb-2 flex flex-wrap gap-2"
                    role="group"
                    aria-label="Editable comment prompts"
                >
                    <UButton
                        v-for="template in commentGuidance.templates"
                        :key="template.label"
                        variant="outline"
                        size="sm"
                        class="min-h-11"
                        :disabled="readOnly || !draftReady || draftStatus === 'loading'"
                        @click="appendCommentPrompt(template.body)"
                    >
                        {{ template.label }}
                    </UButton>
                </div>
                <textarea
                    :id="`reasoning-${team.id}`"
                    ref="reasoningInput"
                    :value="reasoning"
                    class="reasoning-input min-h-32 w-full resize-y rounded-xl border border-default bg-default px-3 py-3 text-base leading-relaxed"
                    placeholder="Describe the strengths and trade-offs behind your scores."
                    :aria-describedby="
                        commentIdentityError
                            ? `reasoning-${team.id}-hint reasoning-${team.id}-identity-error`
                            : `reasoning-${team.id}-hint`
                    "
                    :aria-invalid="
                        (reasoning.length > 0 && !reasoningComplete) ||
                        Boolean(commentIdentityError)
                    "
                    maxlength="10000"
                    :disabled="readOnly || !draftReady || draftStatus === 'loading'"
                    @input="updateReasoning"
                />
                <p
                    v-if="commentIdentityError"
                    :id="`reasoning-${team.id}-identity-error`"
                    class="mt-2 text-sm text-error"
                    role="alert"
                >
                    {{ commentIdentityError }}
                </p>
            </div>
        </section>

        <div class="mt-4 min-h-11" aria-live="polite" aria-atomic="true">
            <p v-if="draftStatus === 'loading'" class="text-sm text-muted">
                Loading your saved draft…
            </p>
            <p v-else-if="draftStatus === 'saving'" class="text-sm text-muted">
                Saving your draft…
            </p>
            <p v-else-if="draftStatus === 'unsaved'" class="text-sm text-muted">Unsaved changes</p>
            <p v-else-if="draftStatus === 'saved'" class="text-sm text-success">
                {{ savedLabel }}
            </p>
            <div v-else-if="draftStatus === 'error'" class="flex flex-wrap items-center gap-3">
                <p class="text-sm text-error">
                    {{ draftError || "We could not load or save your draft." }}
                </p>
                <UButton size="sm" variant="outline" class="min-h-11" @click="emit('retry')">
                    Retry
                </UButton>
            </div>
        </div>

        <div v-if="readOnly" class="mt-4 rounded-xl bg-success/10 p-4 text-sm">
            <p class="font-semibold">Evaluation submitted</p>
            <p class="mt-1 text-muted">This project is complete and its score cannot be changed.</p>
        </div>
        <UButton
            v-else
            class="mt-3 min-h-12 w-full sm:w-auto"
            icon="i-lucide-clipboard-check"
            trailing-icon="i-lucide-arrow-right"
            :disabled="!canReview || draftStatus === 'error' || draftStatus === 'saving'"
            @click="emit('review')"
        >
            Review evaluation
        </UButton>
    </UCard>
</template>

<style scoped>
.score-options {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(2.75rem, 1fr));
    gap: 0.5rem;
}

.score-option {
    display: flex;
    min-height: 2.75rem;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--ui-border);
    border-radius: 0.75rem;
    cursor: pointer;
    font-weight: 600;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        color 120ms ease;
}

.score-option:focus-within {
    outline: 2px solid var(--ui-primary);
    outline-offset: 2px;
}

.score-option-selected {
    border-color: var(--ui-primary);
    background: color-mix(in srgb, var(--ui-primary) 14%, transparent);
    color: var(--ui-primary);
}

.score-option-disabled {
    cursor: not-allowed;
    opacity: 0.65;
}

.reasoning-input:focus-visible {
    outline: 2px solid var(--ui-primary);
    outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
    .score-option {
        transition: none;
    }
}
</style>
