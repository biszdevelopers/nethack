<script setup lang="ts">
import { computed, nextTick, onMounted, useTemplateRef } from "vue";
import type { RubricTrack } from "~~/shared/rubric";
import { calculateWeightedRubricScore } from "~~/shared/rubric";

const props = defineProps<{
    team: APITeam;
    track: RubricTrack;
    scores: Record<string, number>;
    reasoning: string;
    submitting: boolean;
    submitError?: string | null;
}>();

const emit = defineEmits<{
    back: [];
    finalize: [];
}>();

const reviewHeading = useTemplateRef<HTMLHeadingElement>("reviewHeading");
const scorePreview = computed(() => calculateWeightedRubricScore(props.track, props.scores));

onMounted(() => nextTick(() => reviewHeading.value?.focus()));
</script>

<template>
    <UCard variant="subtle" class="review-card">
        <p class="text-sm text-muted">Step 2</p>
        <h2
            ref="reviewHeading"
            tabindex="-1"
            class="mt-1 text-2xl font-bold outline-none focus-visible:ring-2 focus-visible:ring-primary sm:text-3xl"
        >
            Review before you finalize
        </h2>
        <p class="mt-2 text-muted">
            Check each score and your anonymous feedback. Teams can see the feedback after results
            are published, and this evaluation cannot be edited once submitted.
        </p>

        <div class="mt-5 rounded-xl border border-default p-4">
            <p class="text-sm text-muted">{{ team.name }}
                <UBadge
                variant="outline"
                :color="team.pathway === 'junior' ? 'primary' : 'warning'"
                class="shrink-0"
            >
                {{ track.name }}
            </UBadge>
            </p>
            <h3 class="mt-1 break-words text-lg font-semibold">{{ team.project.name }}</h3>
        </div>

        <div class="my-5 rounded-xl bg-primary/10 p-4">
            <p class="text-sm text-muted">Weighted score preview</p>
            <p class="mt-1 text-3xl font-bold text-primary">
                {{ scorePreview }}
                <span class="text-lg">/ 100</span>
            </p>
            <p class="mt-1 text-sm text-muted">
                This is your normalized score. Final rankings combine judges' evaluations.
            </p>
        </div>

        <dl class="divide-y divide-default rounded-xl border border-default">
            <div
                v-for="criterion in track.criteria"
                :key="criterion.id"
                class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3"
            >
                <dt class="min-w-0 flex-1">
                    <span class="font-medium">{{ criterion.name }}</span>
                    <span class="ml-2 text-sm text-muted">{{ criterion.weight }}%</span>
                </dt>
                <dd class="shrink-0 font-semibold tabular-nums">
                    {{ scores[criterion.id] }}
                    <span class="font-normal text-muted">
                        ({{ criterion.minScore }}–{{ criterion.maxScore }})
                    </span>
                </dd>
            </div>
        </dl>

        <section class="mt-5" aria-labelledby="review-reasoning-heading">
            <h3 id="review-reasoning-heading" class="font-semibold">
                Anonymous feedback and score rationale
            </h3>
            <p
                class="mt-2 whitespace-pre-wrap break-words rounded-xl bg-elevated p-4 leading-relaxed"
            >
                {{ reasoning }}
            </p>
        </section>

        <UAlert
            icon="i-lucide-lock-keyhole"
            color="warning"
            variant="subtle"
            title="Final submission"
            description="After finalizing, you cannot change this evaluation. The team will not see your feedback until results are published, and your identity will not be shown."
            class="mt-5"
        />

        <UAlert
            v-if="submitError"
            color="error"
            icon="i-lucide-circle-alert"
            title="Could not submit evaluation"
            :description="submitError"
            class="mt-5"
            role="alert"
        />

        <div class="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <UButton
                variant="outline"
                icon="i-lucide-arrow-left"
                class="min-h-12 justify-center"
                :disabled="submitting"
                @click="emit('back')"
            >
                Back to scoring
            </UButton>
            <UButton
                color="primary"
                trailing-icon="i-lucide-check"
                class="min-h-12 justify-center"
                :loading="submitting"
                :disabled="submitting"
                @click="emit('finalize')"
            >
                Finalize evaluation
            </UButton>
        </div>
    </UCard>
</template>
