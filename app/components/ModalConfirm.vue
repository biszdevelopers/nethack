<template>
    <UModal v-model:open="isOpen">
        <slot />
        <template #body>
            <slot name="content" />
        </template>

        <template #footer="{ close }">
            <UButton
                :color="color"
                :loading="busy"
                :disabled="busy"
                class="min-h-12"
                @click="confirm(close)"
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
const isOpen = defineModel<boolean>("open", { default: false });

type ButtonColor = "primary" | "secondary" | "success" | "info" | "warning" | "error" | "neutral";

const props = withDefaults(
    defineProps<{
        color?: ButtonColor;
        colorSecond?: ButtonColor;
        click?: () => void | Promise<void>;
    }>(),
    {
        color: "primary",
        colorSecond: "neutral",
        click: () => {},
    },
);

const busy = ref(false);

async function confirm(close: () => void) {
    if (busy.value) return;
    busy.value = true;
    try {
        await props.click();
        close();
    } finally {
        busy.value = false;
    }
}
</script>
