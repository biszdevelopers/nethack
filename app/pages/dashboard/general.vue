<script setup lang="ts">
import type { ButtonProps } from "@nuxt/ui";
import { NethackPermissions } from "~~/shared/permissions";

definePageMeta({
    layout: "dashboard",
    middleware: ["auth"],
});

useHead({
    title: `General | ${WEBSITE_NAME}`,
});

const {
    data: hackathon,
    error: hackathonError,
    refresh: refreshHackathon,
} = await useApiFetch("/api/seasons/active", {
    $fetch: globalThis.$fetch,
});
if (hackathonError.value) {
    throw hackathonError.value;
}

const { user: data, error, refresh, status } = await useApiUser();
if (error.value) {
    throw error.value;
}

const { can } = useNethackPermissions();
const canUpdateProject = computed(() => can(NethackPermissions.Projects.updateOwn));
const loading = computed(
    () => !data.value && (status.value === "idle" || status.value === "pending"),
);

const isDirty = ref(false);

const readOnlyReason = computed(() => {
    if (hackathon.value?.status !== "in_progress") {
        return "The submission period is not open. The form is read-only and nothing you type will be saved.";
    }
    if (data.value?.team?.project.submitted) {
        return "This project is submitted and locked. You can no longer edit it.";
    }
    if (!canUpdateProject.value) {
        return "Your account does not have the Projects.updateOwn permission, so this form is read-only.";
    }
    return "";
});

async function refreshData() {
    await withLoadingIndicator(async () => {
        await refresh();
    });
    isDirty.value = false;
}

function dateUpdated(dirty: boolean) {
    isDirty.value = dirty;
}

onBeforeRouteLeave(() => {
    if (isDirty.value && !confirm("You have unsaved changes. Are you sure you want to leave?")) {
        return abortNavigation();
    }
});

function beforeUnload(event: BeforeUnloadEvent) {
    if (isDirty.value) {
        event.preventDefault();
        event.returnValue = true;
    }
}

watch(isDirty, (value) => {
    if (value) {
        window.addEventListener("beforeunload", beforeUnload);
    } else {
        window.removeEventListener("beforeunload", beforeUnload);
    }
});

async function refreshStatus() {
    await Promise.allSettled([refreshHackathon(), refresh()]);
}

function onVisibilityChange() {
    if (document.visibilityState === "visible") void refreshStatus();
}

onMounted(() => {
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", refreshStatus);
});

onUnmounted(() => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("focus", refreshStatus);
    window.removeEventListener("beforeunload", beforeUnload);
});

const links = ref<ButtonProps[]>([
    {
        label: "Check Schedule",
        color: "neutral",
        variant: "subtle",
        trailingIcon: "i-lucide-arrow-right",
        href: "/",
    },
]);

const links_noteam = ref<ButtonProps[]>([
    {
        label: "Create Team",
        color: "neutral",
        variant: "subtle",
        trailingIcon: "i-lucide-arrow-right",
        href: "/dashboard/teams",
    },
]);
</script>

<template>
    <div>
        <h1 class="sr-only">General</h1>

        <p v-if="loading" class="text-muted" aria-live="polite">Loading your project…</p>

        <div v-else-if="data?.team == null && hackathon?.status !== 'not_started'">
            <UPageCTA
                :links="links_noteam"
                title="You don't have a team yet!"
                description="You need a current-season team before you can edit a project. You can still create a solo team if you want to work alone :)"
            />
        </div>

        <div v-else-if="hackathon?.status !== 'not_started'" class="">
            <h2 class="mb-4 text-3xl bold">General</h2>

            <p v-if="data?.team?.project.submitted" class="mb-4 glow">
                You have submitted your project. Congratulations! 🎉
            </p>

            <UAlert
                v-else-if="readOnlyReason"
                color="warning"
                variant="subtle"
                icon="i-lucide-lock"
                title="Editing is closed"
                :description="readOnlyReason"
                class="mb-4"
            />

            <LargeCountdown
                v-if="!readOnlyReason && hackathon?.end_timestamp"
                :date="new Date(hackathon.end_timestamp)"
                label="Submission closes in"
                class="mb-6"
            />

            <ProjectForm
                :team="data?.team"
                :disabled="Boolean(readOnlyReason)"
                @dirty="dateUpdated"
                @refresh="refreshData"
            />
        </div>

        <div v-else>
            <UPageCTA
                :links="links"
                title="Hackathon not started yet!"
                description="Stay tuned for news and check out the schedule!"
            />
        </div>
    </div>
</template>
