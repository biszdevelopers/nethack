<script setup lang="ts">
import { NethackPermissions } from "~~/shared/permissions";

definePageMeta({
    layout: "dashboard",
    middleware: ["auth"],
});

useHead({
    title: `Dashboard | ${WEBSITE_NAME}`,
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

const { data, error, refresh, status } = await useApiUser();
if (error.value) {
    throw error.value;
}

const { can } = useNethackPermissions();
const canCreateTeam = computed(() => can(NethackPermissions.Teams.create));
const canJoinTeam = computed(() => can(NethackPermissions.Teams.membersAddOwn));
const canRemoveTeamMember = computed(() => can(NethackPermissions.Teams.membersRemoveOwn));
const canUpdateProject = computed(() => can(NethackPermissions.Projects.updateOwn));
const canManageTeam = computed(
    () => canJoinTeam.value || canRemoveTeamMember.value || canUpdateProject.value,
);

const team = computed(() => data.value?.team ?? null);
const loading = computed(
    () => !data.value && (status.value === "idle" || status.value === "pending"),
);
const teamChangesOpen = computed(
    () =>
        Boolean(hackathon.value) &&
        hackathon.value!.status !== "paused" &&
        !hackathon.value!.is_submission_closed,
);

const {
    data: inviteData,
    error: inviteError,
    refresh: refreshInvites,
} = await useApiFetch<GetUserInvitesResponse>("/api/team-invites", {
    immediate: canJoinTeam.value,
});

watch(canJoinTeam, (allowed) => {
    if (allowed) void refreshInvites();
});

const pendingInvites = computed(() => inviteData.value?.invites.length ?? 0);
const respondingInviteId = ref<number | null>(null);
const toast = useToast();

async function respondToInvite(inviteID: number, accept: boolean) {
    if (respondingInviteId.value !== null) return;
    respondingInviteId.value = inviteID;
    try {
        await withLoadingIndicator(async () => {
            const { message } = await apiFetch(
                `/api/team-invites/${inviteID}${accept ? "/accept" : ""}`,
                { method: accept ? "POST" : "DELETE" },
            );
            toast.add({ color: "success", title: message });
            await refreshInvites();
            if (accept) await refresh();
        });
    } catch (e) {
        toast.add({
            color: "error",
            title: accept ? "Failed to join the team" : "Failed to decline the invitation",
            description: getErrorMessage(e),
        });
    } finally {
        respondingInviteId.value = null;
    }
}

const actions = computed(() => {
    const items = [];
    if (canUpdateProject.value) {
        items.push({
            title: "Edit your project",
            description: "Make changes to your project details, add links, and more.",
            to: "/dashboard/general",
            icon: "i-heroicons-pencil-square-solid",
        });
    }
    if (canManageTeam.value) {
        items.push({
            title: "Manage your team",
            description: "Add or remove team members or change your team name.",
            to: "/dashboard/teams",
            icon: "i-heroicons-users-solid",
        });
    }
    items.push({
        title: "View your results",
        description: "View the results of the hackathon.",
        to: "/dashboard/results",
        icon: "i-lucide-trophy",
    });
    return items;
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
});
</script>

<template>
    <div>
        <h1 class="sr-only">Dashboard</h1>

        <p v-if="loading" class="text-muted" aria-live="polite">Loading your dashboard…</p>

        <template v-else-if="data">
            <div v-if="!team">
                <p class="mb-4">
                    Welcome
                    <span class="bold">{{ data.name || data.email || "there" }}</span>
                    ! You don't have a current-season team yet.
                    <template v-if="canCreateTeam">
                        You can
                        <ULink href="/dashboard/teams" class="underline">create a team</ULink>
                        or accept an invitation from another team!
                    </template>
                    <template v-else-if="data.team_id">
                        Your previous team belongs to an earlier season, so it is not your current
                        team. Team creation is not available for your account; ask an organizer if
                        you need one.
                    </template>
                    <template v-else>
                        Team creation is not available for your account. Ask an organizer if you
                        need a team.
                    </template>
                </p>

                <UAlert
                    v-if="inviteError"
                    color="error"
                    variant="subtle"
                    class="mb-4"
                    title="Pending invitations could not be loaded"
                    :description="getErrorMessage(inviteError)"
                >
                    <template #actions>
                        <UButton variant="outline" class="min-h-11" @click="() => refreshInvites()">
                            Try again
                        </UButton>
                    </template>
                </UAlert>

                <UCard v-if="canJoinTeam && pendingInvites > 0" variant="subtle" class="mb-4">
                    <h2 class="mb-2 text-2xl bold">Pending invitations ({{ pendingInvites }})</h2>
                    <p v-if="!teamChangesOpen" class="mb-2 text-sm text-muted">
                        Team changes are closed because the event is no longer accepting them.
                    </p>
                    <ul class="space-y-2">
                        <li
                            v-for="invite in inviteData?.invites ?? []"
                            :key="invite.id"
                            class="flex flex-wrap items-center gap-2"
                        >
                            <span>
                                You were invited to join
                                <span class="bold">{{ invite.team_name }}</span>
                            </span>
                            <div class="flex-1" />
                            <UButton
                                class="min-h-11"
                                :disabled="!teamChangesOpen || respondingInviteId !== null"
                                :loading="respondingInviteId === invite.id"
                                @click="respondToInvite(invite.id, true)"
                            >
                                Accept
                            </UButton>
                            <UButton
                                color="neutral"
                                variant="soft"
                                class="min-h-11"
                                :disabled="respondingInviteId !== null"
                                @click="respondToInvite(invite.id, false)"
                            >
                                Decline
                            </UButton>
                        </li>
                    </ul>
                </UCard>

                <p v-if="hackathon?.status === 'not_started'" class="mb-4">
                    Don't worry, you can also create or join a team during the hackathon :)
                </p>
            </div>

            <template v-else>
                <p class="mb-4">
                    Welcome
                    <span class="bold">{{ data.name || data.email || "there" }}</span>
                    !
                    <template v-if="hackathon?.status === 'not_started'">
                        The hackathon hasn't started yet - please check the timer on the home page!
                    </template>
                    <template v-else-if="hackathon?.status === 'in_progress'">
                        The hackathon is in progress -
                        <span class="glow">Hack away!</span>
                    </template>
                    <template v-else-if="hackathon?.status === 'voting'">
                        The hackathon is completed, and judging and peer voting are underway!
                    </template>
                    <template v-else-if="hackathon?.status === 'finished'">
                        The hackathon is finished.
                        <template v-if="hackathon?.results_published">
                            The scores are published.
                        </template>
                        <template v-else>The results have not been published yet.</template>
                    </template>
                    <template v-else-if="hackathon?.status === 'paused'">
                        The hackathon is paused as the organizers figure out the secrets of the
                        universe... Please check back later!
                    </template>
                </p>
                <p class="mb-4">
                    Please review the
                    <ULink href="/rules" class="underline">rules page</ULink>
                    for the most up-to-date rules and requirements.
                </p>

                <LargeCountdown
                    v-if="hackathon?.status === 'in_progress' && hackathon?.end_timestamp"
                    :date="new Date(hackathon.end_timestamp)"
                    label="Submission closes in"
                    class="mb-6"
                />

                <h2 class="mb-4 text-3xl bold">Your project</h2>

                <UAlert
                    v-if="!canUpdateProject"
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-lock"
                    title="Project editing is read-only"
                    description="Your account does not have the Projects.updateOwn permission."
                    class="mb-4"
                />

                <ProjectCard v-if="team" :id="team.id" :team="team" />

                <h2 class="my-4 text-3xl bold">Continue...</h2>

                <UPageGrid>
                    <UPageCard v-for="card in actions" :key="card.to" v-bind="card" />
                </UPageGrid>
            </template>
        </template>
    </div>
</template>

<style scoped>
@keyframes shimmer {
    0% {
        background-position: 0% 50%;
    }
    50% {
        background-position: 100% 50%;
    }
    100% {
        background-position: 0% 50%;
    }
}

.metallic-gold {
    background: linear-gradient(
        135deg,
        #ffd700 0%,
        #ffa500 25%,
        #ffd700 50%,
        #ffa500 75%,
        #ffd700 100%
    );
    background-size: 200% 200%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    text-shadow: none;
    animation: shimmer 3s ease-in-out infinite;
}

.metallic-silver {
    background: linear-gradient(
        135deg,
        #e8e8e8 0%,
        #c0c0c0 25%,
        #e8e8e8 50%,
        #c0c0c0 75%,
        #e8e8e8 100%
    );
    background-size: 200% 200%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    text-shadow: none;
    animation: shimmer 3s ease-in-out infinite;
}

.metallic-bronze {
    background: linear-gradient(
        135deg,
        #cd7f32 0%,
        #b87333 25%,
        #df9953 50%,
        #b87333 75%,
        #cd7f32 100%
    );
    background-size: 200% 200%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    text-shadow: none;
    animation: shimmer 3s ease-in-out infinite;
}
</style>
