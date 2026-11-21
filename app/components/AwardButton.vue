<template>
    <UPopover mode="click" :ui="{ content: 'p-3' }">
        <UButton
            :size="props.size"
            :icon="props.award.icon"
            variant="subtle"
            :color="convertColor(props.award)"
            :aria-label="`${props.award.name} award`"
        />
        <template #content>
            <div class="flex flex-col gap-1">
                <p class="text-sm font-bold">{{ props.award.name }}</p>
                <p class="text-xs">{{ props.award.description }}</p>
            </div>
        </template>
    </UPopover>
</template>

<script setup lang="ts">
const props = defineProps<{
    award: APIAward;
    size: any;
}>();

const convertColor = (award: APIAward) => {
    switch (award.color) {
        case "gold":
            return "warning";
        case "silver":
            return "neutral";
        case "bronze":
            return "error";
        default:
            return "success";
    }
};
</script>
