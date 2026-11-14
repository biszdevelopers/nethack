<script setup>
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

async function doLogout() {
    try {
        await clear();
    } finally {
        await navigateTo("/");
    }
}

// edit form

const state = reactive({
    name: user.value.name || "",
    profile_theme_image: undefined,
});

const fileToBase64 = function (file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        // Read the file as a Data URL
        reader.readAsDataURL(file);

        reader.onload = () => resolve(reader.result);

        // Error callback
        reader.onerror = (error) => reject(error);
    });
};

async function removeProfileTheme() {
    try {
        const { message } = await withLoadingIndicator(async () => {
            return $fetch(`/api/users/${userID.value}`, {
                method: "PATCH",
                body: { profile_theme_image: null },
            });
        });
        toast.add({
            color: "success",
            title: message,
        });
        await refresh();
        if (fileUploadRef.value) {
            fileUploadRef.value.style = "";
        }
    } catch (e) {
        toast.add({
            color: "error",
            title: "Failed to remove profile theme",
            description: getErrorMessage(e),
        });
    }
}

async function onSubmitName(event) {
    try {
        let themeResult;

        if (
            event.data.profile_theme_image != undefined &&
            event.data.profile_theme_image instanceof File
        ) {
            themeResult = await fileToBase64(event.data.profile_theme_image);
            if (themeResult) event.data.profile_theme_image = themeResult.toString();
        }

        const { message } = await withLoadingIndicator(async () => {
            return $fetch(`/api/users/${userID.value}`, {
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
            state.profile_theme_image = undefined;
            fileUploadRef.value.style = `background-image:url("${themeResult}");`;
        }
    } catch (e) {
        toast.add({
            color: "error",
            title: "Failed to update profile",
            description: getErrorMessage(e),
        });
    }
}

const profileThemeValue = ref(user.value.profile_theme);

const fileUploadRef = ref(null);

const profileLink = "/user/" + userID.value;

onMounted(() => {
    if (profileThemeValue.value == undefined) return;

    if (fileUploadRef.value) {
        const url = getProfileThemeUrl(profileThemeValue.value);
        if (url) fileUploadRef.value.style = `background-image:url("${url}");`;
    }
});
</script>

<template>
    <div class="mt-4">
        <h1 class="text-4xl bold mb-4">Hi, {{ user.name || user.email }}!</h1>

        <UForm
            :state="state"
            :schema="UpdateUserRequest"
            class="w-full space-y-4 my-8"
            @submit="onSubmitName"
        >
            <UFormField name="name" label="Edit your name">
                <UInput v-model="state.name" class="w-full" />
            </UFormField>

            <div class="flex gap-4">
                <UButton type="submit">Update profile</UButton>
                <UButton color="warning" variant="subtle" @click="doLogout">Log out</UButton>
            </div>

            <div class="flex items-center gap-3">
                <UserAvatar :user="user" size="lg" />
                <p class="text-sm text-muted">This is... YOU!</p>
            </div>

            <USeparator />

            <UFormField name="profile_theme_image" label="Profile Theme">
                <p class="text-muted text-xs">Select the theme of your profile.</p>
                <p class="text-muted text-xs">
                    This setting will affect the background display of your
                    <ULink :to="profileLink">profile page</ULink>
                    and your
                    <UserPopover :user="user">
                        <span class="underline">profile card</span>
                    </UserPopover>
                </p>

                <div
                    ref="fileUploadRef"
                    class="w-full mt-4 rounded-md bg-gray-500 rounded-xl bg-center bg-cover bg-no-repeat"
                >
                    <UFileUpload
                        v-model="state.profile_theme_image"
                        label="Click to drop image to upload"
                        description="JPEG, PNG, GIF or WebP (max. 7 MB)"
                        accept="image/jpeg, image/jpg, image/png, image/gif, image/webp"
                        class="z-1"
                        :ui="{
                            base: `min-h-48 bg-white/0`,
                            wrapper: `bg-(--ui-bg)/85 rounded-xl`,
                        }"
                    />
                </div>

                <div class="flex gap-3 mt-4">
                    <UButton type="submit">Update profile</UButton>
                    <UButton
                        v-if="user.profile_theme?.mode === 'url'"
                        label="Remove theme"
                        color="error"
                        variant="outline"
                        @click="removeProfileTheme"
                    />
                </div>

                <div class="flex gap-3 mt-4"></div>
            </UFormField>
        </UForm>
    </div>
</template>
