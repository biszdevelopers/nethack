<script setup lang="ts">
import { apiFetch } from "~~/app/composables/useApiFetch";
import type { FormSubmitEvent } from "@nuxt/ui";
import { NethackPermissions } from "~~/shared/permissions";
import { AddTeamMemberRequest, UpdateTeamRequest, MAX_TEAM_MEMBERS } from "~~/shared/schemas";

type TeamWithOwner = APITeam & { owner_user_id?: number | null };
type SeasonTeamCap = { max_team_members?: number | null };
type InviteCreationResponse = {
    message?: string;
    id?: number;
    email?: string;
    token?: string;
    expires_at?: string | null;
    invite_url?: string | null;
};
type CreatedInvite = { email: string; link: string | null; expires_at: string | null };

const props = defineProps<{
    team: APITeam;
    disabled: boolean;
}>();
const emit = defineEmits<{
    refresh: [];
}>();

const team = computed(() => props.team);
const disabled = computed(() => props.disabled);
const { id } = props.team;

const toast = useToast();
const { can } = useNethackPermissions();
const { user: currentUser } = useBasisAuthSession();

const canInvite = computed(() => can(NethackPermissions.Teams.membersAddOwn));
const canRemove = computed(() => can(NethackPermissions.Teams.membersRemoveOwn));
const canRename = computed(() => can(NethackPermissions.Projects.updateOwn));

const { data: activeSeason } = await useApiFetch<SeasonTeamCap>("/api/seasons/active", {
    lazy: true,
    server: false,
});
const maxMembers = computed(() => {
    const value = Number(activeSeason.value?.max_team_members);
    return Number.isInteger(value) && value > 0 && value <= 64 ? value : MAX_TEAM_MEMBERS;
});

const {
    data: users,
    error: usersError,
    status: usersStatus,
    refresh: refreshUsers,
} = await useApiFetch<GetTeamMembersResponse>(`/api/teams/${id}/users`);

const {
    data: invites,
    error: invitesError,
    status: invitesStatus,
    refresh: refreshInvites,
} = await useApiFetch<GetTeamInvitesResponse>(`/api/teams/${id}/invites`);

const membersLoading = computed(
    () => usersStatus.value === "idle" || usersStatus.value === "pending",
);
const invitesLoading = computed(
    () => invitesStatus.value === "idle" || invitesStatus.value === "pending",
);
const memberCount = computed(() => users.value?.length ?? 0);
const pendingInviteCount = computed(() => invites.value?.invites.length ?? 0);
const atMemberLimit = computed(
    () => memberCount.value + pendingInviteCount.value >= maxMembers.value,
);

// The public team response only includes the owner once the API exposes it.
// When it is absent, fall back to permission checks so the page still works.
const ownerUserId = computed(() => (team.value as TeamWithOwner).owner_user_id ?? null);
const ownerKnown = computed(() => ownerUserId.value !== null);
const isOwner = computed(
    () => ownerUserId.value !== null && currentUser.value?.id === ownerUserId.value,
);
const canManageTeam = computed(() =>
    ownerKnown.value ? isOwner.value : canInvite.value || canRemove.value || canRename.value,
);
const canInviteMembers = computed(() => canInvite.value && canManageTeam.value);
const canRemoveMembers = computed(() => canRemove.value && canManageTeam.value);
const canRenameTeam = computed(() => canRename.value && canManageTeam.value);
const canLeaveTeam = computed(() => canRemove.value && memberCount.value > 1);
const canDisbandTeam = computed(() => canManageTeam.value && !team.value.project.submitted);

const busy = ref("");
const isBusy = (key: string) => busy.value === key;

function statusCodeOf(e: unknown): number | undefined {
    return (
        (e as { status?: number } | undefined)?.status ??
        (e as { statusCode?: number } | undefined)?.statusCode ??
        (e as { response?: { status?: number } } | undefined)?.response?.status
    );
}

function isMissingEndpoint(e: unknown): boolean {
    const status = statusCodeOf(e);
    return status === 404 || status === 405;
}

async function runExclusive(
    key: string,
    errorTitle: string,
    action: () => Promise<void>,
): Promise<boolean> {
    if (busy.value) return false;
    busy.value = key;
    try {
        await withLoadingIndicator(action);
        return true;
    } catch (e) {
        toast.add({
            color: "error",
            title: errorTitle,
            description: getErrorMessage(e),
        });
        return false;
    } finally {
        busy.value = "";
    }
}

async function cancelInvite(inviteID: number) {
    await runExclusive(`invite:${inviteID}`, "Failed to cancel invitation", async () => {
        const { message } = await apiFetch(`/api/teams/${id}/invites/${inviteID}`, {
            method: "DELETE",
        });
        toast.add({ color: "success", title: message });
        await refreshInvites();
    });
}

const removeMemberMessage = (user: Pick<User, "id" | "name" | "email">) => {
    const isSelf = user.id === currentUser.value?.id;
    const ownerNote =
        ownerKnown.value && user.id === ownerUserId.value
            ? isSelf
                ? " You are the team owner; leadership will transfer to the earliest remaining member when you leave."
                : " This member owns the team; leadership will transfer to the earliest remaining member."
            : "";
    return `Are you sure you want to ${
        isSelf ? "leave" : `remove ${user.name || user.email} from`
    } your team?${
        memberCount.value === 1
            ? " Every team must keep at least one member, so the last member cannot be removed."
            : ""
    }${ownerNote}`;
};

function canRemoveUser(user: Pick<User, "id">) {
    if (disabled.value || busy.value || memberCount.value <= 1) return false;
    return user.id === currentUser.value?.id ? canLeaveTeam.value : canRemoveMembers.value;
}

async function removeUser(user: Pick<User, "id" | "name" | "email">) {
    await runExclusive(`remove:${user.id}`, "Failed to remove member", async () => {
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
            await refreshUsers();
        }
    });
}

const nameState = reactive({
    name: props.team.name,
});

async function onNameSubmit(event: FormSubmitEvent<UpdateTeamRequest>, close: () => void) {
    const saved = await runExclusive("rename", "Failed to rename team", async () => {
        const { message } = await apiFetch(`/api/teams/${id}`, {
            method: "PATCH",
            body: event.data,
        });
        toast.add({
            color: "success",
            title: message,
        });
        if (event.data.name) nameState.name = event.data.name;
        emit("refresh");
        await refreshUsers();
    });
    if (saved) close();
}

const state = reactive({
    email: "",
    allowUnclaimed: false,
});
const inviteOpen = ref(false);
const createdInvite = ref<CreatedInvite | null>(null);

function openInvite() {
    createdInvite.value = null;
    inviteOpen.value = true;
}

async function copyInviteLink() {
    const link = createdInvite.value?.link;
    if (!link) return;
    try {
        if (!navigator.clipboard) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(link);
        toast.add({ color: "success", title: "Invitation link copied" });
    } catch {
        toast.add({
            color: "warning",
            title: "Copy the link manually",
            description: link,
        });
    }
}

function selectInviteLink(event: FocusEvent) {
    (event.target as HTMLInputElement | null)?.select();
}

async function onSubmit(event: FormSubmitEvent<AddTeamMemberRequest>) {
    const sent = await runExclusive("invite", "Failed to send invitation", async () => {
        const response = await apiFetch<InviteCreationResponse>(`/api/teams/${id}/users`, {
            method: "POST",
            body: {
                ...event.data,
                ...(state.allowUnclaimed ? { allowUnclaimed: true } : {}),
            },
        });
        const token = typeof response?.token === "string" ? response.token : null;
        const rawLink =
            response?.invite_url ??
            (token ? `/dashboard/teams?invite=${encodeURIComponent(token)}` : null);
        const link = rawLink ? new URL(rawLink, window.location.origin).toString() : null;
        createdInvite.value = {
            email: response?.email ?? event.data.email,
            link,
            expires_at: response?.expires_at ?? null,
        };
        toast.add({
            color: "success",
            title: response?.message ?? "Invitation created",
        });
        await refreshInvites();
        if (!link) inviteOpen.value = false;
    });
    if (sent) state.email = "";
}

const transferOpen = ref(false);
const transferTarget = ref<number | undefined>(undefined);
const transferCandidates = computed(() =>
    (users.value ?? []).filter((member) => member.id !== currentUser.value?.id),
);
const canTransfer = computed(
    () => canManageTeam.value && !disabled.value && transferCandidates.value.length > 0,
);

function openTransfer() {
    transferTarget.value = transferCandidates.value[0]?.id;
    transferOpen.value = true;
}

async function transferLeadership() {
    const targetID = transferTarget.value;
    if (!targetID || disabled.value) return;
    const transferred = await runExclusive(
        "transfer",
        "Failed to transfer team leadership",
        async () => {
            const body = { user_id: targetID };
            try {
                await apiFetch(`/api/teams/${id}/owner`, { method: "PATCH", body });
            } catch (e) {
                if (!isMissingEndpoint(e)) throw e;
                await apiFetch(`/api/teams/${id}/transfer`, { method: "POST", body });
            }
            toast.add({ color: "success", title: "Team leadership transferred" });
            emit("refresh");
        },
    );
    if (transferred) {
        transferOpen.value = false;
        await refreshUsers();
    }
}

async function disbandTeam() {
    if (!canDisbandTeam.value || disabled.value) return;
    await runExclusive("disband", "Failed to disband the team", async () => {
        await apiFetch(`/api/teams/${id}`, { method: "DELETE" });
        toast.add({ color: "success", title: "Your team was disbanded" });
        await navigateTo("/dashboard");
    });
}
</script>

<template>
    <div>
        <h1 class="mb-2 flex flex-wrap items-center gap-4 text-3xl bold">
            <span class="min-w-0 break-words">
                Your team:
                <span class="glow">{{ team.name }}</span>
            </span>

            <UModal title="Rename team" :dismissible="!busy">
                <UButton
                    :disabled="disabled || Boolean(busy) || !canRenameTeam"
                    :loading="isBusy('rename')"
                    variant="soft"
                    icon="i-material-symbols-drive-file-rename-outline"
                    aria-label="Rename team"
                    class="min-h-11 min-w-11"
                />

                <template #body="{ close }">
                    <UForm
                        :state="nameState"
                        :schema="UpdateTeamRequest"
                        :disabled="Boolean(busy)"
                        class="w-full space-y-2"
                        @submit="onNameSubmit($event, close)"
                    >
                        <UFormField name="name" label="New name">
                            <UInput v-model="nameState.name" class="min-h-11 w-full" />
                        </UFormField>

                        <UFormField>
                            <UButton
                                variant="subtle"
                                type="submit"
                                class="min-h-11"
                                :loading="isBusy('rename')"
                            >
                                Rename
                            </UButton>
                        </UFormField>
                    </UForm>
                </template>
            </UModal>

            <UModal v-model:open="inviteOpen" title="Invite team member" :dismissible="!busy">
                <UButton
                    :disabled="disabled || Boolean(busy) || !canInviteMembers || atMemberLimit"
                    :loading="isBusy('invite')"
                    variant="soft"
                    icon="i-material-symbols-person-add"
                    aria-label="Invite team member"
                    class="min-h-11 min-w-11"
                    @click="openInvite"
                />

                <template #body>
                    <div v-if="createdInvite" class="space-y-4">
                        <UAlert
                            color="success"
                            variant="subtle"
                            icon="i-lucide-mail-check"
                            :title="`Invitation created for ${createdInvite.email}`"
                        >
                            <template #description>
                                <p v-if="createdInvite.link">
                                    Share this link with your teammate. They must sign in with the
                                    invited email address to join.
                                </p>
                                <p v-else>The invitation appears in their in-app notifications.</p>
                            </template>
                        </UAlert>

                        <template v-if="createdInvite.link">
                            <UFormField label="Invitation link">
                                <UInput
                                    :model-value="createdInvite?.link ?? ''"
                                    readonly
                                    class="min-h-11 w-full"
                                    @focus="selectInviteLink"
                                />
                            </UFormField>
                            <p v-if="createdInvite.expires_at" class="text-sm text-muted">
                                Expires
                                <DateTime :date="createdInvite.expires_at" />
                            </p>
                            <UButton icon="i-lucide-copy" class="min-h-11" @click="copyInviteLink">
                                Copy link
                            </UButton>
                        </template>

                        <UButton variant="outline" class="min-h-11" @click="inviteOpen = false">
                            Done
                        </UButton>
                    </div>

                    <template v-else>
                        <UAlert
                            v-if="atMemberLimit"
                            color="warning"
                            variant="subtle"
                            title="Team is full"
                            :description="`Teams can have at most ${maxMembers} members.`"
                            class="mb-4"
                        />
                        <p v-else class="mb-4 text-sm text-muted">
                            The invitation appears in their in-app notifications when they already
                            have an account. Share the invitation link with anyone who has not
                            signed in yet.
                        </p>

                        <UForm
                            :state="state"
                            :schema="AddTeamMemberRequest"
                            :disabled="Boolean(busy) || atMemberLimit"
                            class="w-full space-y-2"
                            @submit="onSubmit"
                        >
                            <UFormField name="email" label="Member email">
                                <UInput
                                    v-model="state.email"
                                    type="email"
                                    class="min-h-11 w-full"
                                />
                            </UFormField>

                            <UCheckbox
                                v-model="state.allowUnclaimed"
                                label="This person has not signed in yet"
                                class="min-h-11"
                            />

                            <UFormField>
                                <UButton
                                    variant="subtle"
                                    type="submit"
                                    class="min-h-11"
                                    :loading="isBusy('invite')"
                                    :disabled="atMemberLimit"
                                >
                                    Invite
                                </UButton>
                            </UFormField>
                        </UForm>
                    </template>
                </template>
            </UModal>
        </h1>

        <p class="mb-4 text-sm text-muted">
            Members {{ memberCount }} / {{ maxMembers }} ·
            {{ pendingInviteCount }}
            {{ pendingInviteCount === 1 ? "pending invitation" : "pending invitations" }}
        </p>

        <UAlert
            v-if="!canManageTeam"
            color="neutral"
            variant="subtle"
            icon="i-lucide-lock"
            title="Team management is limited"
            description="Only the team owner can rename the team, invite members, or change the roster. Any member can leave the team."
            class="mb-4"
        />

        <UCard v-if="canManageTeam" variant="subtle" class="mb-6">
            <template #header>
                <h2 class="text-xl bold">Team leadership</h2>
            </template>
            <p class="mb-3 text-sm text-muted">
                Transfer leadership to another member before you leave, or disband the team before
                it submits a project.
            </p>
            <div class="flex flex-wrap gap-2">
                <UModal
                    v-model:open="transferOpen"
                    title="Transfer team leadership"
                    :dismissible="!busy"
                >
                    <UButton
                        variant="outline"
                        icon="i-lucide-crown"
                        class="min-h-11"
                        :disabled="!canTransfer || Boolean(busy)"
                        @click="openTransfer"
                    >
                        Transfer leadership
                    </UButton>

                    <template #body>
                        <p class="mb-4 text-sm text-muted">
                            The new owner can rename the team, manage invitations, and remove
                            members. You stay on the team as a regular member.
                        </p>
                        <UFormField label="New owner">
                            <USelect
                                v-model="transferTarget"
                                :items="
                                    transferCandidates.map((member) => ({
                                        label: member.name || member.email,
                                        value: member.id,
                                    }))
                                "
                                placeholder="Choose a member"
                                class="min-h-11 w-full"
                            />
                        </UFormField>
                    </template>
                    <template #footer>
                        <UButton
                            class="min-h-11"
                            :loading="isBusy('transfer')"
                            :disabled="!transferTarget || Boolean(busy)"
                            @click="transferLeadership"
                        >
                            Transfer
                        </UButton>
                    </template>
                </UModal>

                <ModalConfirm
                    v-if="canDisbandTeam"
                    title="Disband team"
                    color="error"
                    :click="disbandTeam"
                >
                    <UButton
                        color="error"
                        variant="soft"
                        icon="i-lucide-trash"
                        class="min-h-11"
                        :disabled="disabled || Boolean(busy)"
                    >
                        Disband team
                    </UButton>
                    <template #content>
                        Disband {{ team.name }}? This removes the team and its roster and cannot be
                        undone. Teams cannot be disbanded after submitting a project.
                    </template>
                </ModalConfirm>
                <p v-else class="self-center text-sm text-muted">
                    The team cannot be disbanded after its project is submitted.
                </p>
            </div>
        </UCard>

        <UAlert
            v-if="usersError"
            color="error"
            variant="subtle"
            title="Team members could not be loaded"
            :description="getErrorMessage(usersError)"
            class="mb-4"
        >
            <template #actions>
                <UButton variant="outline" class="min-h-11" @click="() => refreshUsers()">
                    Try again
                </UButton>
            </template>
        </UAlert>

        <p v-else-if="membersLoading" class="mb-4 text-muted" aria-live="polite">
            Loading team members…
        </p>

        <ul v-else class="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <li v-for="user in users ?? []" :key="user.id">
                <UCard variant="subtle">
                    <h3 class="flex flex-wrap items-center gap-2">
                        <span class="bold">{{ user.name || user.email }}</span>
                        <UBadge
                            v-if="ownerKnown && user.id === ownerUserId"
                            variant="subtle"
                            color="primary"
                        >
                            Owner
                        </UBadge>
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
                                :disabled="!canRemoveUser(user)"
                                :loading="isBusy(`remove:${user.id}`)"
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
                    <p v-if="user.name" class="break-words">{{ user.email }}</p>
                    <p v-if="ownerKnown && user.id === ownerUserId" class="text-sm text-muted">
                        Team owner
                    </p>
                </UCard>
            </li>
        </ul>

        <template v-if="invitesError || pendingInviteCount > 0">
            <h3 class="mb-2 text-xl bold">Pending invitations ({{ pendingInviteCount }})</h3>

            <UAlert
                v-if="invitesError"
                color="error"
                variant="subtle"
                title="Pending invitations could not be loaded"
                :description="getErrorMessage(invitesError)"
                class="mb-4"
            >
                <template #actions>
                    <UButton variant="outline" class="min-h-11" @click="() => refreshInvites()">
                        Try again
                    </UButton>
                </template>
            </UAlert>

            <p v-else-if="invitesLoading" class="mb-4 text-muted" aria-live="polite">
                Loading pending invitations…
            </p>

            <ul v-else class="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <li v-for="invite in invites?.invites ?? []" :key="invite.id">
                    <UCard variant="subtle">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="min-w-0 break-words">{{ invite.email }}</span>
                            <div class="flex-1" />
                            <UButton
                                :disabled="disabled || Boolean(busy) || !canInviteMembers"
                                :loading="isBusy(`invite:${invite.id}`)"
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
