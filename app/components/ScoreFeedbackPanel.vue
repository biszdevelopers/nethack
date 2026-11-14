<script setup lang="ts">
import { useId } from "vue";
import { SCORE_CURVE_PRESETS, type ScoreCurvePreset } from "~~/shared/score-curve";

const props = withDefaults(
    defineProps<{
        teamId: number;
        admin?: boolean;
        showSummary?: boolean;
        showOriginalScore?: boolean;
        showRank?: boolean;
    }>(),
    { admin: false, showSummary: true, showOriginalScore: true, showRank: true },
);

const headingId = useId();
const endpoint = computed(() =>
    props.admin ? `/api/admin/teams/${props.teamId}/scores` : `/api/teams/${props.teamId}/scores`,
);
const { data, pending, error } = await useApiFetch<TeamScoreFeedbackResponse>(endpoint);
const curve = computed(() =>
    data.value?.curve_preset ? SCORE_CURVE_PRESETS[data.value.curve_preset] : null,
);
const hasSummary = computed(() =>
    Boolean(
        data.value &&
        ((props.showOriginalScore && data.value.original_score !== null) ||
            (data.value.displayed_score !== null && data.value.curve_preset !== "original") ||
            (props.showRank && data.value.rank !== null)),
    ),
);
</script>

<template>
    <section class="min-w-0 rounded-xl border border-default p-4" :aria-labelledby="headingId">
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
                <h3 :id="headingId" class="font-semibold">Judge feedback</h3>
                <p v-if="admin" class="mt-1 text-sm text-muted">
                    Judge names and account IDs are visible only in this admin view.
                </p>
                <p v-else class="mt-1 text-sm text-muted">
                    Judge names, account IDs, rubric metadata, and individual scores are hidden.
                    Comments appear only after publication when at least three judges have submitted
                    evaluations.
                </p>
            </div>
            <div v-if="showSummary && hasSummary" class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span v-if="showOriginalScore && data?.original_score !== null">
                    Original average:
                    <strong>{{ data.original_score }}/100</strong>
                </span>
                <span
                    v-if="data?.displayed_score !== null && data.curve_preset !== 'original'"
                    class="text-primary"
                >
                    Curved display ({{ curve?.label }}):
                    <strong>{{ data.displayed_score }}/100</strong>
                </span>
                <span v-if="showRank && data?.rank !== null">
                    Rank:
                    <strong>#{{ data.rank }}</strong>
                </span>
            </div>
        </div>

        <p v-if="pending" class="mt-4 text-sm text-muted" role="status">
            Loading published feedback…
        </p>
        <UAlert
            v-else-if="error"
            class="mt-4"
            color="error"
            variant="subtle"
            title="Feedback could not be loaded"
            description="Try again in a moment."
        />
        <p
            v-else-if="data?.feedback_withheld_for_anonymity"
            class="mt-4 rounded-lg bg-elevated p-4 text-sm text-muted"
            role="status"
        >
            Written feedback is hidden until at least three judges have evaluated this project so no
            single judge can be identified from a one-person review.
        </p>
        <div v-else-if="data?.feedback.length" class="mt-4 space-y-3">
            <article
                v-for="(evaluation, index) in data.feedback"
                :key="index"
                class="min-w-0 rounded-lg bg-elevated p-4"
            >
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <h4 class="font-medium">
                        {{
                            admin
                                ? (evaluation.judge_name ?? `Judge #${evaluation.judge_id}`)
                                : "Anonymous evaluation"
                        }}
                    </h4>
                    <span
                        v-if="admin && evaluation.normalized_score != null"
                        class="text-sm font-semibold"
                    >
                        {{ evaluation.normalized_score }}/100
                    </span>
                </div>
                <p v-if="admin" class="mt-1 text-xs text-muted">
                    {{ evaluation.track_name }} · {{ evaluation.rubric_name }} v{{
                        evaluation.rubric_version
                    }}
                </p>
                <dl
                    v-if="evaluation.scores && evaluation.criteria"
                    class="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2"
                >
                    <div
                        v-for="criterion in evaluation.criteria"
                        :key="criterion.id"
                        class="flex justify-between gap-3"
                    >
                        <dt class="min-w-0 truncate text-muted">{{ criterion.name }}</dt>
                        <dd class="shrink-0 font-medium">
                            {{ evaluation.scores[criterion.id] ?? "—" }}
                            <span class="text-muted">
                                ({{ criterion.minScore }}–{{ criterion.maxScore }})
                            </span>
                        </dd>
                    </div>
                </dl>
                <p class="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {{ evaluation.reasoning }}
                </p>
            </article>
        </div>
        <p v-else-if="data" class="mt-4 text-sm text-muted">No written feedback is available.</p>
    </section>
</template>
