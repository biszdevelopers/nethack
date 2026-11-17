<script setup lang="ts">
import { formatDateTime, toValidDate, type DateInput } from "~/utils/datetime";

const props = defineProps<{
    date: DateInput;
}>();

const normalizedDate = computed(() => toValidDate(props.date));
const text = computed(() => formatDateTime(normalizedDate.value));
const dateTime = computed(() => normalizedDate.value?.toISOString());
</script>

<template>
    <time :datetime="dateTime">
        <ClientOnly>{{ text }}</ClientOnly>
    </time>
</template>
