<script setup lang="ts">
import type { FormSubmitEvent } from "@nuxt/ui";
import { UpdateUserRequest } from "~~/shared/schemas";

const toast = useToast();

definePageMeta({
    middleware: "auth",
});

const { data, error, refresh, sessionUser: userRef, clear } = await useApiUser();
if (error.value) {
    throw error.value;
}

const userID = computed(() => userRef.value?.id ?? 0);
const user = computed(() => data.value);
const profileUser = computed<APIUser>(
    () =>
        user.value ?? {
            id: 0,
            name: null,
            profile_theme: null,
            profile_picture: null,
        },
);
const submitting = ref(false);

useHead(() => ({ title: `${user.value?.name || "Your profile"} | ${WEBSITE_NAME}` }));

async function doLogout() {
    try {
        await clear();
    } finally {
        await navigateTo("/");
    }
}

const state = reactive<{ name: string; profile_theme_image?: File | string | null }>({
    name: user.value?.name || "",
    profile_theme_image: undefined,
});

const themeFile = computed<File | null>({
    get: () =>
        typeof state.profile_theme_image === "string" ? null : (state.profile_theme_image ?? null),
    set: (value) => {
        state.profile_theme_image = value ?? undefined;
    },
});

const fileToBase64 = function (file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.readAsDataURL(file);

        reader.onload = () => resolve(String(reader.result ?? ""));

        reader.onerror = (readError) => reject(readError);
    });
};

function clearPendingTheme() {
    state.profile_theme_image = undefined;
}

async function removeProfileTheme() {
    if (submitting.value) return;
    clearPendingTheme();
    submitting.value = true;
    try {
        const { message } = await withLoadingIndicator(async () => {
            return apiFetch(`/api/users/${userID.value}`, {
                method: "PATCH",
                body: { profile_theme_image: null },
            });
        });
        profileThemeValue.value = null;
        toast.add({
            color: "success",
            title: message,
        });
        await refresh();
        if (fileUploadRef.value) {
            fileUploadRef.value.style.backgroundImage = "";
        }
    } catch (e) {
        toast.add({
            color: "error",
            title: "Failed to remove profile theme",
            description: getErrorMessage(e),
        });
    } finally {
        submitting.value = false;
    }
}

async function onSubmitName(event: FormSubmitEvent<UpdateUserRequest>) {
    if (submitting.value) return;
    submitting.value = true;
    try {
        let themeResult: string | undefined;

        const image = event.data.profile_theme_image;
        if (image instanceof File) {
            themeResult = await fileToBase64(image);
            if (themeResult) event.data.profile_theme_image = themeResult;
        }

        const { message } = await withLoadingIndicator(async () => {
            return apiFetch(`/api/users/${userID.value}`, {
                method: "PATCH",
                body: event.data,
            });
        });
        toast.add({
            color: "success",
            title: message,
        });
        await refresh();

        if (themeResult) {
            clearPendingTheme();
            if (fileUploadRef.value) {
                fileUploadRef.value.style.backgroundImage = `url("${themeResult}")`;
            }
        }
    } catch (e) {
        toast.add({
            color: "error",
            title: "Failed to update profile",
            description: getErrorMessage(e),
        });
    } finally {
        submitting.value = false;
    }
}

const profileThemeValue = ref<ProfileTheme | null>(user.value?.profile_theme ?? null);

const fileUploadRef = ref<HTMLDivElement | null>(null);

const profileLink = computed(() => "/user/" + userID.value);

onMounted(() => {
    const url = getProfileThemeUrl(profileThemeValue.value);
    if (!url || !fileUploadRef.value) return;
    fileUploadRef.value.style.backgroundImage = `url("${url}")`;
});
</script>

<template>
    <div class="mt-4">
        <p v-if="!user" class="text-muted" aria-live="polite">Loading your profile…</p>

        <template v-else>
            <h1 class="mb-4 text-4xl bold">Hi, {{ profileUser.name || profileUser.email }}!</h1>

            <UForm
                :state="state"
                :schema="UpdateUserRequest"
                class="my-8 w-full space-y-4"
                :disabled="submitting"
                @submit="onSubmitName"
            >
                <UFormField name="name" label="Edit your name">
                    <UInput v-model="state.name" class="w-full" :disabled="submitting" />
                </UFormField>

                <div class="flex gap-4">
                    <UButton type="submit" :loading="submitting" class="min-h-11">
                        Update profile
                    </UButton>
                    <UButton
                        color="warning"
                        variant="subtle"
                        class="min-h-11"
                        :disabled="submitting"
                        @click="doLogout"
                    >
                        Log out
                    </UButton>
                </div>

                <div class="flex items-center gap-3">
                    <UserAvatar :user="profileUser" size="lg" />
                    <p class="text-sm text-muted">This is... YOU!</p>
                </div>

                <USeparator />

                <UFormField name="profile_theme_image" label="Profile Theme">
                    <p class="text-xs text-muted">Select the theme of your profile.</p>
                    <p class="text-xs text-muted">
                        This setting will affect the background display of your
                        <ULink :to="profileLink" class="underline">profile page</ULink>
                        and your
                        <UserPopover :user="profileUser">
                            <span class="underline">profile card</span>
                        </UserPopover>
                    </p>

                    <div
                        ref="fileUploadRef"
                        class="mt-4 w-full rounded-xl bg-gray-500 bg-cover bg-center bg-no-repeat"
                    >
                        <UFileUpload
                            v-model="themeFile"
                            label="Click to drop image to upload"
                            description="JPEG, PNG, GIF or WebP (max. 7 MB)"
                            accept="image/jpeg, image/jpg, image/png, image/gif, image/webp"
                            class="z-1"
                            :disabled="submitting"
                            :ui="{
                                base: `min-h-48 bg-white/0`,
                                wrapper: `bg-(--ui-bg)/85 rounded-xl`,
                            }"
                        />
                    </div>

                    <div class="mt-4 flex gap-3">
                        <UButton type="submit" :loading="submitting" class="min-h-11">
                            Update profile
                        </UButton>
                        <UButton
                            v-if="profileUser.profile_theme?.mode === 'url'"
                            label="Remove theme"
                            color="error"
                            variant="outline"
                            class="min-h-11"
                            :disabled="submitting"
                            :loading="submitting"
                            @click="removeProfileTheme"
                        />
                    </div>
                </UFormField>
            </UForm>
        </template>
    </div>
</template>
