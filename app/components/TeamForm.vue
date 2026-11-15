<script setup lang="ts">
import { apiFetch } from "~~/app/composables/useApiFetch";
import type { FormSubmitEvent } from "@nuxt/ui";
import { AddTeamMemberRequest, UpdateTeamRequest } from "~~/shared/schemas";

const { team, disabled } = defineProps<{
    team: APITeam;
    disabled: boolean;
}>();
const emit = defineEmits<{
    refresh: [];
}>();

const { id, name } = team;

const toast = useToast();

const { user: currentUser } = useBasisAuthSession();

const {
    data: users,
    error,
    refresh,
} = await useApiFetch<GetTeamMembersResponse>(`/api/teams/${id}/users`);
if (error.value) {
    throw error.value;
}

const {
    data: invites,
    error: invitesError,
    refresh: refreshInvites,
} = await useApiFetch<GetTeamInvitesResponse>(`/api/teams/${id}/invites`);
if (invitesError.value) {
    throw invitesError.value;
}

async function cancelInvite(inviteID: number) {
    try {
        await withLoadingIndicator(async () => {
            const { message } = await apiFetch(`/api/teams/${id}/invites/${inviteID}`, {
                method: "DELETE",
            });
            toast.add({ color: "success", title: message });
            await refreshInvites();
        });
    } catch (e) {
        toast.add({
            color: "error",
            title: "Failed to cancel invitation",
            description: getErrorMessage(e),
        });
    }
}

const removeMemberMessage = (user: Pick<User, "id" | "name" | "email">) => {
    return `Are you sure you want to ${
        user.id === currentUser.value?.id ? "leave" : `remove ${user.name || user.email} from`
    } your team?${
        users.value?.length === 1
            ? " This is the last member of your team, so you won't be able to recover it."
            : ""
    }`;
};

async function removeUser(user: Pick<User, "id" | "name" | "email">) {
    try {
        await withLoadingIndicator(async () => {
            const { message } = await apiFetch(`/api/teams/${id}/users/${user.id}`, {
                method: "DELETE",
            });
            toast.add({
                color: "success",
                title: message,
            });
            if (user.id === currentUser.value?.id) {
                emit("refresh");
            } else {
                await refresh();
            }
        });
    } catch (e) {
        toast.add({
            color: "error",
            title: "Failed to remove member",
            description: getErrorMessage(e),
        });
    }
}

// rename
const nameState = reactive({
    name: name,
});

async function onNameSubmit(event: FormSubmitEvent<UpdateTeamRequest>, close: () => void) {
    try {
        await withLoadingIndicator(async () => {
            const { message } = await apiFetch(`/api/teams/${id}`, {
                method: "PATCH",
                body: event.data,
            });
            toast.add({
                color: "success",
                title: message,
            });
            emit("refresh");
            await refresh();
        });
    } catch (e) {
        toast.add({
            color: "error",
            title: "Failed to rename team",
            description: getErrorMessage(e),
        });
    } finally {
        close();
    }
}

// add user
const state = reactive({
    email: "",
});

async function onSubmit(event: FormSubmitEvent<AddTeamMemberRequest>, close: () => void) {
    try {
        await withLoadingIndicator(async () => {
            const { message } = await apiFetch(`/api/teams/${id}/users`, {
                method: "POST",
                body: event.data,
            });
            toast.add({
                color: "success",
                title: message,
            });
            await refreshInvites();
        });
    } catch (e) {
        toast.add({
            color: "error",
            title: "Failed to send invitation",
            description: getErrorMessage(e),
        });
    } finally {
        close();
    }
}
</script>

<template>
    <div>
        <h2 class="text-3xl bold mb-4 flex gap-4">
            <span>
                Your team:
                <span class="glow">{{ team.name }}</span>
            </span>

            <UModal title="Rename team">
                <UButton
                    :disabled="disabled"
                    variant="soft"
                    icon="i-material-symbols-drive-file-rename-outline"
                    aria-label="Rename team"
                    class="min-h-11 min-w-11"
                />

                <template #body="{ close }">
                    <UForm
                        :state="nameState"
                        :schema="UpdateTeamRequest"
                        class="space-y-2 w-full"
                        @submit="onNameSubmit($event, close)"
                    >
                        <UFormField name="name" label="New name">
                            <UInput v-model="nameState.name" class="min-h-11 w-full" />
                        </UFormField>

                        <UFormField>
                            <UButton variant="subtle" type="submit">Rename</UButton>
                        </UFormField>
                    </UForm>
                </template>
            </UModal>

            <UModal title="Invite team member">
                <UButton
                    :disabled="disabled"
                    variant="soft"
                    icon="i-material-symbols-person-add"
                    aria-label="Invite team member"
                    class="min-h-11 min-w-11"
                />

                <template #body="{ close }">
                    <UForm
                        :state="state"
                        :schema="AddTeamMemberRequest"
                        class="space-y-2 w-full"
                        @submit="onSubmit($event, close)"
                    >
                        <UFormField name="email" label="Member email">
                            <UInput v-model="state.email" type="email" class="min-h-11 w-full" />
                        </UFormField>

                        <UFormField>
                            <UButton variant="subtle" type="submit">Invite</UButton>
                        </UFormField>
                    </UForm>
                </template>
            </UModal>
        </h2>

        <ul class="grid lg:grid-cols-2 gap-4 mb-4">
            <li v-for="user in users" :key="user.id">
                <UCard variant="subtle">
                    <h3 class="flex flex-wrap items-center gap-2">
                        <span class="bold">{{ user.name || user.email }}</span>
                        <div class="flex-1" />
                        <ModalConfirm
                            title="Remove team member"
                            color="error"
                            :click="
                                () => {
                                    removeUser(user);
                                }
                            "
                        >
                            <UButton
                                :disabled="disabled"
                                icon="i-material-symbols-delete"
                                color="warning"
                                variant="soft"
                                :aria-label="
                                    user.id === currentUser?.id
                                        ? 'Leave team'
                                        : `Remove ${user.name || user.email} from team`
                                "
                                class="min-h-11 min-w-11"
                            />

                            <template #content>
                                {{ removeMemberMessage(user) }}
                            </template>
                        </ModalConfirm>
                    </h3>
                    <p v-if="user.name">{{ user.email }}</p>
                </UCard>
            </li>
        </ul>

        <template v-if="invites?.invites.length">
            <h3 class="text-xl bold mb-2">Pending invitations</h3>
            <ul class="grid lg:grid-cols-2 gap-4 mb-4">
                <li v-for="invite in invites.invites" :key="invite.id">
                    <UCard variant="subtle">
                        <div class="flex flex-wrap items-center gap-2">
                            <span>{{ invite.email }}</span>
                            <div class="flex-1" />
                            <UButton
                                :disabled="disabled"
                                icon="i-material-symbols-close"
                                color="warning"
                                variant="soft"
                                :aria-label="`Cancel invitation for ${invite.email}`"
                                class="min-h-11 min-w-11"
                                @click="cancelInvite(invite.id)"
                            />
                        </div>
                    </UCard>
                </li>
            </ul>
        </template>
    </div>
</template>
