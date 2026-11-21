<script setup lang="ts">
setPageLayout("fullwidth");

const route = useRoute();
const userID = route.params.id as string;

const { data, error, status, refresh } = await useApiFetch<APIUser>(() => `/api/users/${userID}`);

const loading = computed(() => status.value === "idle" || status.value === "pending");
const user = computed(() => data.value ?? null);

useHead(() => ({ title: `${user.value?.name || "Member profile"} | ${WEBSITE_NAME}` }));

const backgroundUrl = computed(() => getProfileThemeUrl(user.value?.profile_theme));
</script>

<template>
    <div
        class="min-h-[calc(100vh-var(--ui-header-height))] bg-center bg-cover pb-16"
        :style="backgroundUrl ? { backgroundImage: `url(${backgroundUrl})` } : undefined"
    >
        <div class="mx-auto w-full max-w-3xl px-4 pt-8 sm:px-6 lg:px-8">
            <UAlert
                v-if="error"
                color="error"
                variant="subtle"
                icon="i-lucide-circle-alert"
                title="Member profile could not be loaded"
                :description="getErrorMessage(error)"
                class="mb-4"
            >
                <template #actions>
                    <UButton
                        variant="outline"
                        class="min-h-11"
                        :loading="loading"
                        @click="() => refresh()"
                    >
                        Try again
                    </UButton>
                    <UButton to="/" variant="ghost" class="min-h-11">Back to home</UButton>
                </template>
            </UAlert>

            <div
                v-else-if="loading || !user"
                class="rounded-2xl border border-default bg-default p-6"
                aria-live="polite"
            >
                <div class="flex items-center gap-4">
                    <USkeleton class="h-12 w-12 rounded-full" />
                    <div class="space-y-2">
                        <USkeleton class="h-3 w-24" />
                        <USkeleton class="h-6 w-48" />
                    </div>
                </div>
            </div>

            <section v-else class="rounded-2xl border border-default bg-default p-6">
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
