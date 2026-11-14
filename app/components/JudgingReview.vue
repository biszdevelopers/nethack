<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import type { RubricTrack } from "~~/shared/rubric";
import { calculateWeightedRubricScore } from "~~/shared/rubric";

const props = defineProps<{
    open: boolean;
    team: APITeam;
    track: RubricTrack;
    scores: Record<string, number>;
    reasoning: string;
    submitting: boolean;
    submitError?: string | null;
}>();

const emit = defineEmits<{
    close: [];
    closeAutoFocus: [event: Event];
    finalize: [];
}>();

const reviewHeading = useTemplateRef<HTMLSpanElement>("reviewHeading");
const scorePreview = computed(() => calculateWeightedRubricScore(props.track, props.scores));

function focusReviewHeading(event: Event) {
    event.preventDefault();
    reviewHeading.value?.focus();
}
</script>

<template>
    <UModal
        :open="open"
        :dismissible="!submitting"
        :close="false"
        :content="{
            onOpenAutoFocus: focusReviewHeading,
            onCloseAutoFocus: (event) => emit('closeAutoFocus', event),
        }"
        :ui="{
            overlay: 'z-[60]',
            content: 'z-[60] max-w-2xl',
            header: 'shrink-0',
            body: 'grid min-h-0 overflow-hidden p-0 sm:p-0',
            footer: 'shrink-0 flex-col-reverse gap-3 sm:flex-row sm:justify-between',
        }"
        description="Check each score and your anonymous feedback. Teams can see the feedback after results are published, and this evaluation cannot be edited once submitted."
        @update:open="!$event && emit('close')"
    >
        <template #title>
            <span class="block text-sm font-normal text-muted" aria-hidden="true">Step 2</span>
            <span
                ref="reviewHeading"
                tabindex="-1"
                class="mt-1 block text-xl font-bold outline-none focus-visible:ring-2 focus-visible:ring-primary sm:text-2xl"
            >
                Review before you finalize
            </span>
        </template>
        <template #body>
            <div
                role="region"
                aria-label="Evaluation details"
                tabindex="0"
                class="overflow-y-auto p-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary sm:p-6"
            >
                <div class="rounded-xl border border-default p-4">
                    <p class="text-sm text-muted">
                        {{ team.name }}
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
                        <dd class="shrink-0 text-right tabular-nums">
                            <span class="font-semibold">{{ scores[criterion.id] }}</span>
                            <span class="text-sm text-muted">
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
                        class="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere] rounded-xl bg-elevated p-4 leading-relaxed"
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
            </div>
        </template>
        <template #footer>
            <UButton
                variant="outline"
                icon="i-lucide-arrow-left"
                class="min-h-12 w-full justify-center sm:w-auto"
                :disabled="submitting"
                @click="emit('close')"
            >
                Back to scoring
            </UButton>
            <UButton
                color="primary"
                trailing-icon="i-lucide-check"
                class="min-h-12 w-full justify-center sm:w-auto"
                :loading="submitting"
                :disabled="submitting"
                @click="emit('finalize')"
            >
                Finalize evaluation
            </UButton>
        </template>
    </UModal>
</template>
