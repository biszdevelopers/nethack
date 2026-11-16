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

const backgroundUrl = computed(() => getProfileThemeUrl(user.value?.profile_theme));
</script>

<template>
    <div
        class="min-h-[calc(100vh-var(--ui-header-height))] bg-center bg-cover pb-16"
        :style="backgroundUrl ? { backgroundImage: `url(${backgroundUrl})` } : undefined"
    >
        <div class="mx-auto w-full max-w-3xl px-4 pt-8 sm:px-6 lg:px-8">
            <section class="rounded-2xl border border-default bg-default p-6">
                <div class="flex items-center gap-4">
                    <UserAvatar :user="user" size="lg" />
                    <div class="min-w-0">
                        <p class="font-mono text-xs tracking-[0.18em] text-muted uppercase">
                            Member profile
                        </p>
                        <h1 class="mt-1 truncate text-2xl font-bold text-primary glow sm:text-3xl">
                            {{ user.name || "Unnamed member" }}
                        </h1>
                    </div>
                </div>
            </section>
        </div>
    </div>
</template>
