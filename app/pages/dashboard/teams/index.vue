<script setup lang="ts">
import { apiFetch } from "~~/app/composables/useApiFetch";
import type { FormSubmitEvent } from "@nuxt/ui";
import { NethackPermissions } from "~~/shared/permissions";
import { CreateTeamRequest } from "~~/shared/schemas";

definePageMeta({
    layout: "dashboard",
    middleware: "auth",
});
useHead({
    title: `New Team | ${WEBSITE_NAME}`,
});

const toast = useToast();
const { can } = useNethackPermissions();
const route = useRoute();
const router = useRouter();

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

const inviteToken = computed(() => {
    const value = route.query.invite;
    return typeof value === "string" && value.length > 0 ? value : null;
});
const inviteDismissed = ref(false);
const inviteState = ref<"idle" | "accepting" | "success" | "error">("idle");
const inviteError = ref<string | null>(null);

function endpointStatus(e: unknown): number | undefined {
    return (
        (e as { status?: number } | undefined)?.status ??
        (e as { statusCode?: number } | undefined)?.statusCode ??
        (e as { response?: { status?: number } } | undefined)?.response?.status
    );
}

/** Try the token route first, then the body-token fallback a backend may expose. */
async function acceptInviteToken(token: string): Promise<{ message?: string }> {
    try {
        return await apiFetch(`/api/team-invites/token/${encodeURIComponent(token)}/accept`, {
            method: "POST",
        });
    } catch (e) {
        const status = endpointStatus(e);
        if (status !== 404 && status !== 405) throw e;
        return await apiFetch("/api/team-invites/accept", {
            method: "POST",
            body: { token },
        });
    }
}

async function handleInvite() {
    const token = inviteToken.value;
    if (!token || inviteState.value === "accepting") return;
    if (data.value?.team) {
        inviteState.value = "error";
        inviteError.value =
            "You are already in a team. Leave it before accepting another invitation.";
        return;
    }

    inviteState.value = "accepting";
    inviteError.value = null;
    try {
        const result = await withLoadingIndicator(() => acceptInviteToken(token));
        inviteState.value = "success";
        toast.add({
            color: "success",
            title: result?.message ?? "You joined the team",
        });
        await refresh();
        await navigateTo("/dashboard");
    } catch (e) {
        inviteState.value = "error";
        inviteError.value = isEndpointUnavailable(e)
            ? "Invitation links are not enabled on this deployment. Ask the team owner to invite your email address instead."
            : getErrorMessage(e);
    }
}

function dismissInvite() {
    inviteDismissed.value = true;
    const query = { ...route.query };
    delete query.invite;
    void router.replace({ query });
}

onMounted(() => {
    if (inviteToken.value) void handleInvite();
});

const submitting = ref(false);
const canCreateTeam = computed(() => can(NethackPermissions.Teams.create));
const teamChangesOpen = computed(
    () => hackathon.value?.status === "not_started" || hackathon.value?.status === "in_progress",
);

async function refreshData() {
    await withLoadingIndicator(async () => {
        await refresh();
    });
}

async function onSubmit(event: FormSubmitEvent<CreateTeamRequest>) {
    if (submitting.value || !canCreateTeam.value) return;
    const { name } = event.data;

    submitting.value = true;
    try {
        await withLoadingIndicator(async () => {
            await apiFetch<CreateTeamResponse>("/api/teams", {
                method: "POST",
                body: { name },
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
    } finally {
        submitting.value = false;
    }
}
</script>

<template>
    <UCard v-if="inviteToken && !inviteDismissed" variant="subtle" class="mb-6">
        <template #header>
            <h2 class="text-xl bold">Team invitation</h2>
        </template>

        <p v-if="inviteState === 'accepting'" class="text-muted" aria-live="polite">
            Joining the team…
        </p>

        <UAlert
            v-else-if="inviteState === 'error'"
            color="error"
            variant="subtle"
            title="Could not accept this invitation"
            :description="inviteError ?? undefined"
        >
            <template #actions>
                <UButton class="min-h-11" @click="handleInvite">Try again</UButton>
                <UButton class="min-h-11" variant="outline" @click="dismissInvite">Dismiss</UButton>
            </template>
        </UAlert>

        <template v-else>
            <p class="text-sm text-muted">
                Accept the invitation to join your teammate's team. You must be signed in with the
                invited email address.
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
                <UButton class="min-h-11" @click="handleInvite">Accept invitation</UButton>
                <UButton class="min-h-11" variant="outline" @click="dismissInvite">Not now</UButton>
            </div>
        </template>
    </UCard>

    <div v-if="data?.team == null">
        <h1 class="mb-4 text-4xl bold glow">Create a team</h1>

        <UAlert
            v-if="!canCreateTeam"
            color="neutral"
            variant="subtle"
            icon="i-lucide-lock"
            title="Team creation is not available"
            description="Your account does not have the Teams.create permission. Ask an organizer if you should be able to create a team."
            class="mb-4"
        />

        <UAlert
            v-else-if="!teamChangesOpen"
            color="neutral"
            variant="subtle"
            title="Team creation is closed"
            description="Teams can only be created before or during the event."
            class="mb-4"
        />

        <p v-if="canCreateTeam && teamChangesOpen" class="mb-4">
            Pick a name your teammates will recognize. You can invite up to five more people after
            the team exists.
        </p>

        <UForm
            v-if="canCreateTeam && teamChangesOpen"
            :state="state"
            :schema="CreateTeamRequest"
            class="w-full space-y-2"
            :disabled="submitting"
            @submit="onSubmit"
        >
            <UFormField name="name" label="Team name">
                <UInput v-model="state.name" class="min-h-11 w-full" :maxlength="30" />
            </UFormField>

            <UFormField>
                <div class="flex items-center gap-3">
                    <UButton type="submit" class="min-h-11">Create</UButton>
                    <span v-if="submitting" class="text-sm text-muted" aria-live="polite">
                        Creating your team…
                    </span>
                </div>
            </UFormField>
        </UForm>
    </div>

    <div v-else>
        <TeamForm
            :team="data.team"
            :disabled="
                (hackathon?.status !== 'in_progress' && hackathon?.status !== 'not_started') ||
                data.team.project.submitted
            "
            @refresh="refreshData"
        />
    </div>
</template>
