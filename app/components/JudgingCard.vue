<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue";
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
    review: [event: MouseEvent];
    retry: [];
    discard: [];
}>();

const projectHeading = useTemplateRef<HTMLHeadingElement>("projectHeading");
const reasoningInput = useTemplateRef<HTMLTextAreaElement>("reasoningInput");
const splitRoot = useTemplateRef<HTMLElement>("splitRoot");
const splitPercent = ref(50);
const MIN_SPLIT = 25;
const MAX_SPLIT = 75;
const SPLIT_STORAGE_KEY = "basishacks:judging-split";
let dragging = false;
const commentGuidance = computed(() => props.commentGuidance ?? DEFAULT_JUDGE_COMMENT_GUIDANCE);
const safeRepoUrl = computed(() => safeUrl(props.team.project.repo_url));
const safeDemoUrl = computed(() => safeUrl(props.team.project.demo_url));
const safeVideoUrl = computed(() =>
    safeUrl((props.team.project as APITeam["project"] & { video_url?: string | null }).video_url),
);
const hasDescription = computed(() => Boolean(props.team.project.description?.trim()));
const hasSourcing = computed(() => Boolean(props.team.project.sourcing?.trim()));
const teamLabel = computed(() => props.team.name?.trim() || "This team");
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
            typeof value === "number" &&
            Number.isInteger(value) &&
            value >= criterion.minScore &&
            value <= criterion.maxScore
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

function clampSplit(value: number) {
    return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, value));
}

function updateSplitFromPointer(event: PointerEvent) {
    const root = splitRoot.value;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0) return;
    splitPercent.value = clampSplit(((event.clientX - rect.left) / rect.width) * 100);
}

function persistSplit() {
    try {
        localStorage.setItem(SPLIT_STORAGE_KEY, String(Math.round(splitPercent.value)));
    } catch {
        // Storage can be unavailable in private modes; the split still works.
    }
}

function startResize(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    updateSplitFromPointer(event);
}

function resizeWithPointer(event: PointerEvent) {
    if (dragging) updateSplitFromPointer(event);
}

function stopResize(event: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture?.(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId);
    }
    persistSplit();
}

function resizeWithKeyboard(event: KeyboardEvent) {
    const step = event.shiftKey ? 10 : 2;
    if (event.key === "ArrowLeft") splitPercent.value = clampSplit(splitPercent.value - step);
    else if (event.key === "ArrowRight") splitPercent.value = clampSplit(splitPercent.value + step);
    else if (event.key === "Home") splitPercent.value = MIN_SPLIT;
    else if (event.key === "End") splitPercent.value = MAX_SPLIT;
    else if (event.key === "Enter" || event.key === " ") splitPercent.value = 50;
    else return;
    event.preventDefault();
    persistSplit();
}

function resetSplit() {
    splitPercent.value = 50;
    persistSplit();
}

onMounted(() => {
    try {
        const stored = Number(localStorage.getItem(SPLIT_STORAGE_KEY));
        if (Number.isFinite(stored) && stored > 0) splitPercent.value = clampSplit(stored);
    } catch {
        // Storage can be unavailable; keep the default split.
    }
    void nextTick(() => projectHeading.value?.focus());
});

onBeforeUnmount(() => {
    dragging = false;
});
</script>

<template>
    <div ref="splitRoot" class="judging-split" :style="{ '--judging-split': `${splitPercent}%` }">
        <section class="judging-pane project-pane" aria-labelledby="project-heading" tabindex="0">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                    <p class="text-sm text-muted">{{ team.name }}</p>
                    <h2
                        id="project-heading"
                        ref="projectHeading"
                        tabindex="-1"
                        class="mt-1 break-words text-2xl font-bold outline-none focus-visible:ring-2 focus-visible:ring-primary sm:text-3xl"
                    >
                        {{ team.project.name || "Untitled project" }}
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

            <dl class="mt-6 divide-y divide-default rounded-xl border border-default">
                <div class="grid gap-1 p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
                    <dt class="text-sm font-semibold text-muted">Team</dt>
                    <dd class="min-w-0">
                        {{ team.name || "This team did not provide a team name." }}
                    </dd>
                </div>
                <div class="grid gap-1 p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
                    <dt class="text-sm font-semibold text-muted">Pathway</dt>
                    <dd class="min-w-0">{{ track.name }}</dd>
                </div>
                <div class="grid gap-1 p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
                    <dt class="text-sm font-semibold text-muted">Project name</dt>
                    <dd class="min-w-0">
                        {{ team.project.name || `${teamLabel} did not provide a project name.` }}
                    </dd>
                </div>
                <div class="grid gap-1 p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
                    <dt class="text-sm font-semibold text-muted">Project description</dt>
                    <dd class="min-w-0">
                        <SafeComark v-if="hasDescription" class="text-wrap leading-relaxed">
                            {{ team.project.description }}
                        </SafeComark>
                        <p v-else class="text-sm text-muted">
                            {{ teamLabel }} did not provide a project description.
                        </p>
                    </dd>
                </div>
                <div class="grid gap-1 p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
                    <dt class="text-sm font-semibold text-muted">AI-use disclosure</dt>
                    <dd class="min-w-0">
                        <SafeComark v-if="hasSourcing" class="text-wrap leading-relaxed">
                            {{ team.project.sourcing }}
                        </SafeComark>
                        <p v-else class="text-sm text-muted">
                            {{ teamLabel }} did not provide an AI-use disclosure.
                        </p>
                    </dd>
                </div>
                <div class="grid gap-1 p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
                    <dt class="text-sm font-semibold text-muted">Repository</dt>
                    <dd class="min-w-0">
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
                        <p v-else class="text-sm text-muted">
                            {{ teamLabel }} did not provide a repository link.
                        </p>
                    </dd>
                </div>
                <div class="grid gap-1 p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
                    <dt class="text-sm font-semibold text-muted">Demo</dt>
                    <dd class="min-w-0">
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
                        <p v-else class="text-sm text-muted">
                            {{ teamLabel }} did not provide a demo link.
                        </p>
                    </dd>
                </div>
                <div class="grid gap-1 p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
                    <dt class="text-sm font-semibold text-muted">Demonstration video</dt>
                    <dd class="min-w-0">
                        <UButton
                            v-if="safeVideoUrl"
                            :href="safeVideoUrl"
                            external
                            target="_blank"
                            rel="noopener noreferrer"
                            variant="subtle"
                            icon="i-lucide-video"
                            class="min-h-11"
                        >
                            Watch demonstration video
                        </UButton>
                        <p v-else class="text-sm text-muted">
                            {{ teamLabel }} did not provide a demonstration video link.
                        </p>
                    </dd>
                </div>
                <div class="grid gap-1 p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
                    <dt class="text-sm font-semibold text-muted">Submission</dt>
                    <dd class="min-w-0">
                        {{
                            team.project.submitted
                                ? "Submitted for judging."
                                : "This project has not been submitted."
                        }}
                    </dd>
                </div>
            </dl>
        </section>

        <div
            class="judging-divider"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the project details and scoring panes"
            aria-valuemin="25"
            aria-valuemax="75"
            :aria-valuenow="Math.round(splitPercent)"
            title="Drag to resize; use the arrow keys"
            tabindex="0"
            @pointerdown="startResize"
            @pointermove="resizeWithPointer"
            @pointerup="stopResize"
            @pointercancel="stopResize"
            @lostpointercapture="stopResize"
            @keydown="resizeWithKeyboard"
            @dblclick="resetSplit"
        >
            <span class="judging-divider-grip" aria-hidden="true" />
        </div>

        <section class="judging-pane rubric-pane" aria-labelledby="rubric-heading" tabindex="0">
            <slot name="navigation" />
            <div class="mb-4">
                <h3 id="rubric-heading" class="text-xl font-bold sm:text-2xl">
                    Scoring Guidelines
                </h3>
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
                            />
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
                        />
                        <output
                            class="min-w-14 rounded-lg border border-default px-3 py-2 text-center font-semibold tabular-nums"
                            :for="`score-${team.id}-${criterion.id}`"
                            aria-live="polite"
                        >
                            {{ scores[criterion.id] ?? "Choose" }}
                        </output>
                    </div>
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

            <div class="mt-4 min-h-11" aria-live="polite" aria-atomic="true">
                <p v-if="draftStatus === 'loading'" class="text-sm text-muted">
                    Loading your saved draft…
                </p>
                <p v-else-if="draftStatus === 'saving'" class="text-sm text-muted">
                    Saving your draft…
                </p>
                <p v-else-if="draftStatus === 'unsaved'" class="text-sm text-muted">
                    Unsaved changes
                </p>
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
                    <UButton size="sm" variant="ghost" class="min-h-11" @click="emit('discard')">
                        Discard and reload
                    </UButton>
                </div>
            </div>

            <div v-if="readOnly" class="mt-4 rounded-xl bg-success/10 p-4 text-sm">
                <p class="font-semibold">Evaluation submitted</p>
                <p class="mt-1 text-muted">
                    This project is complete and its score cannot be changed.
                </p>
            </div>
            <UButton
                v-else
                class="mt-3 min-h-12 w-full sm:w-auto"
                icon="i-lucide-clipboard-check"
                trailing-icon="i-lucide-arrow-right"
                :disabled="!canReview || draftStatus === 'error' || draftStatus === 'saving'"
                @click="emit('review', $event)"
            >
                Review evaluation
            </UButton>
        </section>
    </div>
</template>

<style scoped>
.judging-split {
    display: grid;
}

.judging-divider {
    display: none;
}

.judging-pane {
    min-width: 0;
    padding: clamp(1rem, 3vw, 2.5rem);
    overflow-wrap: anywhere;
}

.project-pane {
    border-block-end: 1px solid var(--ui-border);
}

.judging-pane:focus-visible {
    outline: 2px solid var(--ui-primary);
    outline-offset: -2px;
}

@media (min-width: 48rem) {
    .judging-split {
        grid-template-columns: var(--judging-split, 50%) 0.6rem minmax(0, 1fr);
        height: 100%;
        min-height: 16rem;
    }

    .project-pane {
        border-block-end: 0;
    }

    .judging-divider {
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--ui-border);
        cursor: col-resize;
        touch-action: none;
    }

    .judging-divider:hover,
    .judging-divider:focus-visible {
        background: var(--ui-primary);
        outline: none;
    }

    .judging-divider-grip {
        width: 0.25rem;
        height: 2.5rem;
        border-radius: 999px;
        background: var(--ui-bg);
    }

    .judging-pane {
        overflow-y: auto;
        overscroll-behavior-y: contain;
        scrollbar-gutter: stable;
    }
}

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
