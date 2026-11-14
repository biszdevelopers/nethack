<script setup lang="ts">
const props = defineProps<{
    user:
        | {
              id?: number;
              name?: string | null;
              email?: string;
              profile_picture?: string | null;
          }
        | null
        | undefined;
    size?: "3xs" | "2xs" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";
}>();

const src = computed(() => {
    if (props.user?.id) return `/api/users/${props.user.id}/profile_picture`;
    return undefined;
});

const alt = computed(() => {
    return props.user?.name || props.user?.email || "User";
});

const skeletonSize = computed(() => {
    const map: Record<string, string> = {
        "3xs": "w-4 h-4",
        "2xs": "w-5 h-5",
        xs: "w-6 h-6",
        sm: "w-8 h-8",
        md: "w-10 h-10",
        lg: "w-12 h-12",
        xl: "w-14 h-14",
        "2xl": "w-16 h-16",
        "3xl": "w-20 h-20",
    };
    return map[props.size || "md"] || "w-10 h-10";
});
</script>

<template>
    <USkeleton v-if="!user" :class="['rounded-full', skeletonSize]" />
    <UAvatar v-else :src="src" :alt="alt" :size="size" />
</template>
