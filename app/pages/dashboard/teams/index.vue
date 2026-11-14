<script setup lang="ts">
import type { FormSubmitEvent } from "@nuxt/ui";
import { CreateTeamRequest } from "~~/shared/schemas";

definePageMeta({
    layout: "dashboard",
    middleware: "auth",
});
useHead({
    title: `New Team | ${WEBSITE_NAME}`,
});

const toast = useToast();

const state = reactive({
    name: "",
});

const { data, error, refresh } = await useApiUser();
const { data: hackathon, error: hackathonError } = await useApiFetch("/api/seasons/active", {
    $fetch: globalThis.$fetch,
});
if (hackathonError.value) {
    throw hackathonError.value;
}
if (error.value) {
    throw error.value;
}

const isDirty = ref(false);

async function refreshData() {
    await withLoadingIndicator(async () => {
        await refresh();
    });
    isDirty.value = false;
}

async function onSubmit(event: FormSubmitEvent<CreateTeamRequest>) {
    const { name } = event.data;

    try {
        await withLoadingIndicator(async () => {
            await $fetch<CreateTeamResponse>("/api/teams", {
                method: "POST",
                body: { name },
                query: { add: "true" },
            });
            await refresh();
            toast.add({
                color: "success",
                title: "Your team is created",
            });
        });
        await navigateTo("/dashboard");
    } catch (e) {
        toast.add({
            color: "error",
            title: "Failed to create team",
            description: getErrorMessage(e),
        });
    }
}
</script>

<template>
    <div v-if="data?.team == null">
        <h1 class="text-4xl bold glow mb-4">Create a team</h1>

        <p class="mb-4">Please fill out this super long form to create a team!</p>

        <UForm
            :state="state"
            :schema="CreateTeamRequest"
            class="space-y-2 w-full"
            @submit="onSubmit"
        >
            <UFormField name="name" label="Team name">
                <UInput v-model="state.name" class="min-h-11 w-full" />
            </UFormField>

            <UFormField>
                <UButton type="submit" class="min-h-11">Create</UButton>
            </UFormField>
        </UForm>
    </div>

    <div v-else>
        <div>
            <TeamForm
                :team="data.team"
                :disabled="
                    (hackathon?.status !== 'in_progress' && hackathon?.status !== 'not_started') ||
                    data.team.project.submitted
                "
                @refresh="refreshData"
            />
        </div>
    </div>
</template>
