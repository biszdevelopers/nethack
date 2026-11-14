<script setup lang="ts">
setPageLayout("fullwidth");

const route = useRoute();
const userID = route.params.id as string;

const { data, error } = await useApiFetch<APIUser>(() => `/api/users/${userID}`);
if (error.value) {
    throw createError({
        status: 404,
        statusText: "User not found",
    });
}

const user = computed(() => data.value as APIUser);

const backgroundUrl = computed(() => {
    if (!user.value?.profile_theme?.value) return null;
    const v = user.value.profile_theme.value;
    return v.startsWith("http") ? v : `/api/users/${userID}/profile_picture`;
});
</script>

<template>
    <div
        class="bg-center bg-cover"
        :style="backgroundUrl ? { backgroundImage: `url(${backgroundUrl})` } : undefined"
    >
        <div class="h-[calc(100vh-var(--ui-header-height))] bg-default pt-4 px-4 sm:px-6 lg:px-8" />
    </div>
</template>
