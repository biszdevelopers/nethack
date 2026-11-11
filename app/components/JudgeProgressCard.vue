<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
    season: BallotSummaryItem;
}>();

const progress = computed(() =>
    props.season.submitted_count > 0
        ? Math.min(
              100,
              Math.round((props.season.scored_count / props.season.submitted_count) * 100),
          )
        : 0,
);
</script>

<template>
    <UCard>
        <template #header>
            <div class="flex flex-col">
                <span class="text-lg font-semibold">{{ props.season.season_name }}</span>
            </div>
        </template>
        <template #default>
            <div class="flex flex-col">
                <div class="flex items-baseline justify-between gap-3">
                    <span class="text-sm text-muted">Projects evaluated</span>
                    <span class="text-lg tabular-nums">
                        <span class="text-primary bold">{{ props.season.scored_count }}</span>
                        <span class="text-muted">/</span>
                        <span class="bold">{{ props.season.submitted_count }}</span>
                    </span>
                </div>
                <div
                    class="mt-3 h-2 overflow-hidden rounded-full bg-muted/20"
                    role="progressbar"
                    :aria-valuenow="props.season.scored_count"
                    :aria-valuemin="0"
                    :aria-valuemax="props.season.submitted_count"
                    :aria-label="`${props.season.scored_count} of ${props.season.submitted_count} projects evaluated`"
                >
                    <div
                        class="h-full rounded-full bg-primary"
                        :style="{ width: `${progress}%` }"
                    />
                </div>
            </div>
        </template>
    </UCard>
</template>
