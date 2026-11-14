<template>
    <UModal v-model:open="isOpen">
        <slot />
        <template #body>
            <slot name="content" />
        </template>

        <template #footer="{ close }">
            <UButton
                :color="color"
                class="min-h-12"
                @click="
                    click();
                    close();
                "
            >
                Confirm
            </UButton>
            <UButton :color="colorSecond" variant="outline" class="min-h-12" @click="close">
                Cancel
            </UButton>
        </template>
    </UModal>
</template>

<script setup lang="ts">
const isOpen = defineModel("open", { default: false });

const props = defineProps({
    color: {
        type: String,
        default: "primary",
    },
    click: {
        type: Function,
        default: () => {},
    },
    colorSecond: {
        type: String,
        default: "neutral",
    },
});

//console.log(props.click)
</script>
