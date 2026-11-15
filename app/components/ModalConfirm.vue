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
const isOpen = defineModel<boolean>("open", { default: false });

type ButtonColor = "primary" | "secondary" | "success" | "info" | "warning" | "error" | "neutral";

withDefaults(
    defineProps<{
        color?: ButtonColor;
        colorSecond?: ButtonColor;
        click?: () => void;
    }>(),
    {
        color: "primary",
        colorSecond: "neutral",
        click: () => {},
    },
);

//console.log(props.click)
</script>
