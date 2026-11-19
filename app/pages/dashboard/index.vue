<script setup lang="ts">
definePageMeta({
    layout: "dashboard",
    middleware: ["auth"],
});

useHead({
    title: `Dashboard | ${WEBSITE_NAME}`,
});

const { data: hackathon, error: hackathonError } = await useApiFetch("/api/seasons/active", {
    $fetch: globalThis.$fetch,
});
if (hackathonError.value) {
    throw hackathonError.value;
}

const { data, error, refresh } = await useApiUser();
if (error.value) {
    throw error.value;
}

const {
    data: inviteData,
    error: inviteError,
    refresh: refreshInvites,
} = await useApiFetch<GetUserInvitesResponse>("/api/team-invites");
const toast = useToast();
const canJoinTeam = computed(
    () => hackathon.value?.status === "not_started" || hackathon.value?.status === "in_progress",
);

async function respondToInvite(inviteID: number, accept: boolean) {
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
    }
}

const actions = ref([
    {
        title: "Edit your project",
        description: "Make changes to your project details, add links, and more.",
        to: "/dashboard/general",
        icon: "i-heroicons-pencil-square-solid",
    },
    {
        title: "Manage your team",
        description: "Add or remove team member or change your team name.",
        to: "/dashboard/teams",
        icon: "i-heroicons-users-solid",
    },
    {
        title: "View your results",
        description: "View the results of the hackathon.",
        to: "/dashboard/results",
        icon: "i-lucide-trophy",
    },
]);
</script>

<template>
    <div>
        <h1 class="sr-only">Dashboard</h1>
        <div v-if="!data?.team">
            <p class="mb-4">
                Welcome
                <span class="bold">{{ data!.name || data!.email }}</span>
                ! You don't have a team yet. You can
                <ULink href="/dashboard/teams" class="underline">create a team</ULink>
                or accept an invitation from another team!
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

            <UCard v-if="inviteData?.invites.length" variant="subtle" class="mb-4">
                <h2 class="text-2xl bold mb-2">Pending invitations</h2>
                <p v-if="!canJoinTeam" class="mb-2 text-sm text-muted">
                    Team changes are closed because the event is no longer accepting them.
                </p>
                <ul class="space-y-2">
                    <li
                        v-for="invite in inviteData.invites"
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
                            :disabled="!canJoinTeam"
                            @click="respondToInvite(invite.id, true)"
                        >
                            Accept
                        </UButton>
                        <UButton
                            color="neutral"
                            variant="soft"
                            class="min-h-11"
                            @click="respondToInvite(invite.id, false)"
                        >
                            Decline
                        </UButton>
                    </li>
                </ul>
            </UCard>

            <p v-if="hackathon?.status === 'not_started'" class="mb-4">
                (Don't worry though, you can also create or join a team during the hackathon :)
            </p>
        </div>

        <template v-else>
            <p class="mb-4">
                Welcome
                <span class="bold">{{ data.name || data.email }}</span>
                !
                <template v-if="hackathon?.status === 'not_started'">
                    The hackathon hasn't started yet - please check the timer on the home page!
                </template>
                <template v-else-if="hackathon?.status === 'in_progress'">
                    The hackathon is in progress -
                    <span class="glow">HACK AWAY!</span>
                </template>
                <template v-else-if="hackathon?.status === 'voting'">
                    The hackathon is completed, and judging and peer voting is underway!
                </template>
                <template v-else-if="hackathon?.status === 'finished'">
                    The hackathon is completed, and the scores are released!
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

            <h2 class="text-3xl bold mb-4">Your project</h2>

            <ProjectCard v-if="data.team_id" :id="data.team_id" />

            <h2 class="text-3xl bold my-4">Continue...</h2>

            <UPageGrid>
                <UPageCard v-for="(card, index) in actions" :key="index" v-bind="card" />
            </UPageGrid>
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
