<template>
    <UModal :title="title">
        <slot name="trigger">
            <UButton
                :variant="buttonVariant as any"
                :icon="buttonIcon"
                class="text-ui-muted"
                :disabled="disabled"
            >
                <slot name="buttonLabel">
                    {{ buttonLabel }}
                </slot>
            </UButton>
        </slot>

        <template #body="{ close }">
            <div class="popup-media-content max-w-[50vw] max-h-[50vh] flex flex-col overflow-auto">
                <slot :close="close" />
            </div>
        </template>
    </UModal>
</template>

<script setup lang="ts">
defineProps({
    title: {
        type: String,
        default: "Media preview",
    },
    buttonLabel: {
        type: String,
        default: "Open media",
    },
    buttonIcon: {
        type: String,
        default: "i-material-symbols-open-in-new",
    },

    buttonVariant: {
        type: String,
        default: "ghost",
    },
    disabled: {
        type: Boolean,
        default: false,
    },
});
</script>

<style scoped>
.popup-media-content {
    min-height: 0;
}
</style>
