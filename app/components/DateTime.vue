<script setup lang="ts">
import {
    DISPLAY_TIME_ZONE_LABEL,
    formatDateTime,
    toValidDate,
    type DateInput,
} from "~/utils/datetime";

const props = defineProps<{
    date: DateInput;
}>();

const normalizedDate = computed(() => toValidDate(props.date));
const text = computed(() => formatDateTime(normalizedDate.value));
const dateTime = computed(() => normalizedDate.value?.toISOString());
</script>

<template>
    <time :datetime="dateTime">
        {{ text }}
        <span v-if="dateTime" class="text-muted">({{ DISPLAY_TIME_ZONE_LABEL }})</span>
    </time>
</template>
