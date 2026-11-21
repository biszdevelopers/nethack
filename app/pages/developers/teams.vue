<script setup lang="ts">
import { apiFetch } from "~~/app/composables/useApiFetch";
import type { TableColumn } from "@nuxt/ui";
import { upperFirst } from "scule";
import { getPaginationRowModel } from "@tanstack/table-core";
import { NethackPermissions } from "~~/shared/permissions";
import { formatDateTime } from "~/utils/datetime";
useHead({ title: `Teams | ${WEBSITE_NAME}` });

definePageMeta({
    layout: "developers-dashboard",
    middleware: ["auth"],
});

const UButton = resolveComponent("UButton");
const UBadge = resolveComponent("UBadge");
const UCheckbox = resolveComponent("UCheckbox");
const UserAvatarGroup = resolveComponent("UserAvatarGroup");

const toast = useToast();
const { can } = useNethackPermissions();
const isAdmin = computed(() => can(NethackPermissions.all));
const table = useTemplateRef<any>("table");
const modalOpen = ref(false);
const deleting = ref(false);
const feedbackModalOpen = ref(false);
const selectedFeedbackTeam = ref<AdminTeam | null>(null);

const columnFilters = ref([
    {
        id: "name",
        value: "",
    },
]);
const columnVisibility = ref();
const rowSelection = ref<Record<string, boolean>>({});

type AdminTeamMember = {
    id: number;
    name: string | null;
    email: string;
    profile_picture: string | null;
};

type AdminTeam = Team & {
    season_name: string | null;
    members: AdminTeamMember[];
    submitted_at?: number | null;
};

type AdminFeedbackEntry = ScoreFeedbackEntryResponse & { created_at?: string | number | null };
type AdminTeamScores = Omit<TeamScoreFeedbackResponse, "feedback"> & {
    feedback: AdminFeedbackEntry[];
};

const { data, status, error, refresh } = await useApiFetch<AdminTeam[]>("/api/admin/teams", {
    server: false,
    lazy: true,
    default: () => [],
});

const selectedRows = computed<any[]>(() => {
    if (!table.value?.tableApi) return [];
    return table.value.tableApi.getFilteredSelectedRowModel().rows;
});

const selectedIds = computed(() => selectedRows.value.map((row: any) => row.original.id as number));

async function onDelete() {
    if (selectedIds.value.length === 0 || deleting.value) return;

    deleting.value = true;
    try {
        await apiFetch("/api/admin/teams", {
            method: "DELETE",
            body: { ids: selectedIds.value },
        });

        toast.add({
            title: "Teams deleted",
            description: `Successfully deleted ${selectedIds.value.length} team(s).`,
            color: "success",
        });

        rowSelection.value = {};
        await refresh();
    } catch (e: any) {
        toast.add({
            title: "Could not delete teams",
            description: getErrorMessage(e),
            color: "error",
        });
    } finally {
        deleting.value = false;
        modalOpen.value = false;
    }
}

function formatSubmitted(team: AdminTeam): string | null {
    const submittedAt = Number(team.submitted_at);
    return Number.isFinite(submittedAt) && submittedAt > 0 ? formatDateTime(submittedAt) : null;
}

const columns: TableColumn<AdminTeam>[] = [
    {
        id: "select",
        header: ({ table }) =>
            h(UCheckbox, {
                modelValue: table.getIsSomePageRowsSelected()
                    ? "indeterminate"
                    : table.getIsAllPageRowsSelected(),
                "onUpdate:modelValue": (value: boolean | "indeterminate") =>
                    table.toggleAllPageRowsSelected(!!value),
                "aria-label": "Select all teams",
            }),
        cell: ({ row }) =>
            h(UCheckbox, {
                modelValue: row.getIsSelected(),
                "onUpdate:modelValue": (value: boolean | "indeterminate") =>
                    row.toggleSelected(!!value),
                "aria-label": `Select ${row.original.name ?? `team ${row.original.id}`}`,
            }),
    },
    {
        accessorKey: "id",
        header: "ID",
    },
    {
        accessorKey: "name",
        header: ({ column }) => {
            const isSorted = column.getIsSorted();

            return h(UButton, {
                color: "neutral",
                variant: "ghost",
                label: "Name",
                icon: isSorted
                    ? isSorted === "asc"
                        ? "i-lucide-arrow-up-narrow-wide"
                        : "i-lucide-arrow-down-wide-narrow"
                    : "i-lucide-arrow-up-down",
                class: "-mx-2.5",
                onClick: () => column.toggleSorting(column.getIsSorted() === "asc"),
            });
        },
    },
    {
        id: "members",
        header: "Members",
        cell: ({ row }) =>
            h(UserAvatarGroup, {
                users: row.original.members ?? [],
                max: 4,
                size: "xs",
                developerMode: true,
            }),
    },
    {
        accessorKey: "pathway",
        header: "Pathway",
        cell: ({ row }) => {
            const pathway = row.original.pathway;
            if (!pathway) return "-";
            const color = pathway === "senior" ? "warning" : "primary";
            return h(UBadge, { class: "capitalize", variant: "subtle", color }, () => pathway);
        },
    },
    {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
            const status = row.original.status ?? "active";
            const color =
                status === "active" ? "success" : status === "withdrawn" ? "neutral" : "error";
            return h(UBadge, { class: "capitalize w-fit", variant: "subtle", color }, () =>
                status.replaceAll("_", " "),
            );
        },
    },
    {
        accessorKey: "score",
        header: "Score (/100)",
        cell: ({ row }) => row.original.score ?? "-",
    },
    {
        id: "score_feedback",
        header: "Judge feedback",
        cell: ({ row }) =>
            h(UButton, {
                label: "View",
                icon: "i-lucide-message-square-text",
                color: "neutral",
                variant: "subtle",
                class: "min-h-11",
                onClick: () => openFeedback(row.original),
            }),
    },
    {
        accessorKey: "rank",
        header: "Rank",
        cell: ({ row }) => row.original.rank ?? "-",
    },
    {
        accessorKey: "project_name",
        header: "Project",
    },
    {
        accessorKey: "project_submitted",
        header: "Submitted",
        cell: ({ row }) => {
            const submitted = row.original.project_submitted;
            const submittedAt = formatSubmitted(row.original);
            return h("div", { class: "flex flex-col gap-1" }, [
                h(
                    UBadge,
                    {
                        class: "capitalize w-fit",
                        variant: "subtle",
                        color: submitted ? "success" : "neutral",
                    },
                    () => (submitted ? "Yes" : "No"),
                ),
                submittedAt ? h("span", { class: "text-xs text-muted" }, submittedAt) : null,
            ]);
        },
    },
    {
        accessorKey: "season_name",
        header: "Season",
        cell: ({ row }) => row.original.season_name ?? "-",
    },
];

// ---------------------------------------------------------------------------
// Team review and management
// ---------------------------------------------------------------------------
const reviewLoading = ref(false);
const reviewError = ref<unknown>(null);
const teamScores = ref<AdminTeamScores | null>(null);
const teamAwards = ref<APIAward[]>([]);
const awardCatalog = ref<APIAward[]>([]);
const awardsUnavailable = ref(false);
const selectedAward = ref<string | undefined>(undefined);
const currentStatus = ref<TeamStatus>("active");
const statusDraft = ref("active");
const statusReason = ref("");
const pendingAction = ref<string | null>(null);

const teamStatusOptions = [
    { label: "Active", value: "active" },
    { label: "Withdrawn", value: "withdrawn" },
    { label: "Disqualified", value: "disqualified" },
    { label: "No-show", value: "no_show" },
];

function normalizeAwardCatalog(payload: unknown): APIAward[] {
    if (Array.isArray(payload)) return payload as APIAward[];
    const list = (payload as { awards?: APIAward[] } | null)?.awards;
    return Array.isArray(list) ? list : [];
}

function openFeedback(team: AdminTeam) {
    selectedFeedbackTeam.value = team;
    teamScores.value = null;
    teamAwards.value = [];
    reviewError.value = null;
    currentStatus.value = team.status ?? "active";
    statusDraft.value = currentStatus.value;
    statusReason.value = "";
    selectedAward.value = undefined;
    feedbackModalOpen.value = true;
    void loadTeamReview();
}

async function loadTeamReview() {
    const team = selectedFeedbackTeam.value;
    if (!team || reviewLoading.value) return;
    reviewLoading.value = true;
    reviewError.value = null;
    const [scores, project, catalog] = await Promise.allSettled([
        apiFetch<AdminTeamScores>(`/api/admin/teams/${team.id}/scores`),
        apiFetch<GetTeamResponse>(`/api/teams/${team.id}`),
        apiFetch<unknown>("/api/admin/awards"),
    ]);

    if (scores.status === "fulfilled") teamScores.value = scores.value;
    else {
        teamScores.value = null;
        reviewError.value = scores.reason;
    }

    if (project.status === "fulfilled") {
        teamAwards.value = project.value.awards ?? [];
        currentStatus.value = project.value.status ?? currentStatus.value;
        statusDraft.value = currentStatus.value;
        // The admin list endpoint may not include status or the submission
        // timestamp yet; the public team response supplies the status.
        selectedFeedbackTeam.value = {
            ...team,
            status: currentStatus.value,
            project_submitted: project.value.project.submitted ? 1 : 0,
        };
    }

    if (catalog.status === "fulfilled") {
        awardCatalog.value = normalizeAwardCatalog(catalog.value);
        awardsUnavailable.value = false;
    } else {
        awardCatalog.value = [];
        awardsUnavailable.value = isEndpointUnavailable(catalog.reason);
    }

    reviewLoading.value = false;
}

async function refreshSelectedTeam() {
    const team = selectedFeedbackTeam.value;
    if (!team) return;
    await refresh();
    const updated = (data.value ?? []).find((row) => row.id === team.id);
    if (updated) selectedFeedbackTeam.value = updated;
}

async function updateTeamStatus() {
    const team = selectedFeedbackTeam.value;
    if (!team || pendingAction.value) return;
    const next = statusDraft.value;
    const reason = statusReason.value.trim();
    if (next !== "active" && !reason) {
        toast.add({
            title: "Add a reason",
            description: "Record why this team's status is changing.",
            color: "warning",
        });
        return;
    }
    if (
        !window.confirm(
            `Set ${team.name} to "${next}"?\n\nThis changes what the team can do and is recorded in the audit log.`,
        )
    ) {
        return;
    }

    pendingAction.value = "status";
    try {
        await apiFetch(`/api/admin/teams/${team.id}/status`, {
            method: "PATCH",
            body: { status: next, reason: reason || undefined },
        });
        toast.add({ title: "Team status updated", description: team.name, color: "success" });
        currentStatus.value = next as TeamStatus;
        selectedFeedbackTeam.value = { ...team, status: currentStatus.value };
        statusReason.value = "";
        await refreshSelectedTeam();
    } catch (updateError) {
        toast.add({
            title: isEndpointUnavailable(updateError)
                ? "Team status is not enabled"
                : "Could not update the team status",
            description: isEndpointUnavailable(updateError)
                ? "This deployment does not expose the team status endpoint yet."
                : getErrorMessage(updateError),
            color: isEndpointUnavailable(updateError) ? "warning" : "error",
        });
    } finally {
        pendingAction.value = null;
    }
}

async function reopenSubmission() {
    const team = selectedFeedbackTeam.value;
    if (!team || !team.project_submitted || pendingAction.value) return;
    if (
        !window.confirm(
            `Reopen the project submission for ${team.name}?\n\nThe team can edit and resubmit its project until the organizer closes submissions again.`,
        )
    ) {
        return;
    }

    pendingAction.value = "reopen";
    try {
        await apiFetch(`/api/admin/teams/${team.id}/reopen`, { method: "POST", body: {} });
        toast.add({ title: "Submission reopened", description: team.name, color: "success" });
        selectedFeedbackTeam.value = { ...team, project_submitted: 0 };
        await refreshSelectedTeam();
    } catch (reopenError) {
        toast.add({
            title: isEndpointUnavailable(reopenError)
                ? "Reopening submissions is not enabled"
                : "Could not reopen the submission",
            description: isEndpointUnavailable(reopenError)
                ? "This deployment does not expose the reopen endpoint yet."
                : getErrorMessage(reopenError),
            color: isEndpointUnavailable(reopenError) ? "warning" : "error",
        });
    } finally {
        pendingAction.value = null;
    }
}

async function voidScore(entry: AdminFeedbackEntry) {
    const team = selectedFeedbackTeam.value;
    if (!team || !entry.judge_id || pendingAction.value) return;
    const judge = entry.judge_name ?? `judge #${entry.judge_id}`;
    if (
        !window.confirm(
            `Void ${judge}'s evaluation of ${team.project_name || team.name}?\n\nThis cannot be undone. Recompute standings afterwards so the team's score reflects the removal.`,
        )
    ) {
        return;
    }

    pendingAction.value = `void-${entry.judge_id}`;
    try {
        await apiFetch(`/api/admin/teams/${team.id}/scores/${entry.judge_id}`, {
            method: "DELETE",
        });
        toast.add({
            title: "Evaluation voided",
            description: `${judge} no longer counts toward this team's score.`,
            color: "success",
        });
        await Promise.allSettled([loadTeamReview(), refresh()]);
    } catch (voidError) {
        toast.add({
            title: isEndpointUnavailable(voidError)
                ? "Voiding scores is not enabled"
                : "Could not void the evaluation",
            description: isEndpointUnavailable(voidError)
                ? "This deployment does not expose the score void endpoint yet."
                : getErrorMessage(voidError),
            color: isEndpointUnavailable(voidError) ? "warning" : "error",
        });
    } finally {
        pendingAction.value = null;
    }
}

async function assignAward() {
    const team = selectedFeedbackTeam.value;
    const award = selectedAward.value;
    if (!team || !award || pendingAction.value) return;
    pendingAction.value = "award";
    try {
        await apiFetch(`/api/admin/teams/${team.id}/awards`, {
            method: "POST",
            body: { award },
        });
        toast.add({ title: "Award assigned", description: team.name, color: "success" });
        selectedAward.value = undefined;
        await loadTeamReview();
    } catch (awardError) {
        toast.add({
            title: isEndpointUnavailable(awardError)
                ? "Awards are not enabled"
                : "Could not assign the award",
            description: isEndpointUnavailable(awardError)
                ? "This deployment does not expose the awards endpoints yet."
                : getErrorMessage(awardError),
            color: isEndpointUnavailable(awardError) ? "warning" : "error",
        });
    } finally {
        pendingAction.value = null;
    }
}

async function unassignAward(namespace: string) {
    const team = selectedFeedbackTeam.value;
    if (!team || pendingAction.value) return;
    if (!window.confirm(`Remove the "${namespace}" award from ${team.name}?`)) return;
    pendingAction.value = `award-${namespace}`;
    try {
        await apiFetch(`/api/admin/teams/${team.id}/awards/${namespace}`, { method: "DELETE" });
        toast.add({ title: "Award removed", description: team.name, color: "success" });
        await loadTeamReview();
    } catch (awardError) {
        toast.add({
            title: isEndpointUnavailable(awardError)
                ? "Awards are not enabled"
                : "Could not remove the award",
            description: isEndpointUnavailable(awardError)
                ? "This deployment does not expose the awards endpoints yet."
                : getErrorMessage(awardError),
            color: isEndpointUnavailable(awardError) ? "warning" : "error",
        });
    } finally {
        pendingAction.value = null;
    }
}

async function recomputeStandings() {
    const team = selectedFeedbackTeam.value;
    if (!team || pendingAction.value) return;
    if (
        !window.confirm(
            "Recompute scores and ranks for this season from every finalized evaluation?\n\nPublished standings are replaced by the recomputed result.",
        )
    ) {
        return;
    }
    pendingAction.value = "recompute";
    try {
        await apiFetch(`/api/admin/scores/compute?season_id=${team.season_id}`, { method: "POST" });
        toast.add({ title: "Standings recomputed", color: "success" });
        await refresh();
    } catch (computeError) {
        toast.add({
            title: "Could not recompute standings",
            description: getErrorMessage(computeError),
            color: "error",
        });
    } finally {
        pendingAction.value = null;
    }
}

const nameFilter = computed({
    get: (): string => {
        return (table.value?.tableApi?.getColumn("name")?.getFilterValue() as string) || "";
    },
    set: (value: string) => {
        table.value?.tableApi?.getColumn("name")?.setFilterValue(value || undefined);
    },
});

const displayColumnItems = computed(
    () =>
        table.value?.tableApi
            ?.getAllColumns()
            .filter((column: any) => column.getCanHide())
            .map((column: any) => ({
                label: upperFirst(column.id),
                type: "checkbox" as const,
                checked: column.getIsVisible(),
                onUpdateChecked(checked: boolean) {
                    table.value?.tableApi?.getColumn(column.id)?.toggleVisibility(!!checked);
                },
                onSelect(e?: Event) {
                    e?.preventDefault();
                },
            })) ?? [],
);

const filteredRowCount = computed(
    () => table.value?.tableApi?.getFilteredRowModel()?.rows?.length ?? 0,
);

const currentPage = computed(
    () => (table.value?.tableApi?.getState()?.pagination?.pageIndex ?? 0) + 1,
);

const pageModel = computed({
    get: () => currentPage.value,
    set: (page: number) => table.value?.tableApi?.setPageIndex(page - 1),
});

const currentPageSize = computed(
    () => table.value?.tableApi?.getState()?.pagination?.pageSize ?? pagination.value.pageSize,
);

const pagination = ref({
    pageIndex: 0,
    pageSize: 10,
});

const paginationOptions = {
    getPaginationRowModel: getPaginationRowModel(),
};
</script>

<template>
    <UDashboardPanel id="teams">
        <template #header>
            <UDashboardNavbar title="Teams">
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
            </UDashboardNavbar>
        </template>

        <template #body>
            <UAlert
                v-if="!isAdmin"
                color="error"
                variant="subtle"
                icon="i-lucide-shield-x"
                title="Access denied"
                description="Administrator access is required to manage teams."
            />

            <template v-else>
                <div class="flex flex-wrap items-center justify-between gap-1.5">
                    <UInput
                        v-model="nameFilter"
                        class="max-w-sm"
                        icon="i-lucide-search"
                        placeholder="Filter names..."
                    />

                    <div class="flex flex-wrap items-center gap-1.5">
                        <UButton
                            v-if="selectedRows.length"
                            label="Delete selected"
                            color="error"
                            variant="subtle"
                            icon="i-lucide-trash"
                            :disabled="deleting"
                            @click="modalOpen = true"
                        >
                            <template #trailing>
                                <UKbd>{{ selectedRows.length }}</UKbd>
                            </template>
                        </UButton>

                        <UDropdownMenu :items="displayColumnItems" :content="{ align: 'end' }">
                            <UButton
                                label="Display"
                                color="neutral"
                                variant="outline"
                                trailing-icon="i-lucide-settings-2"
                            />
                        </UDropdownMenu>
                    </div>
                </div>

                <UAlert
                    v-if="error"
                    color="error"
                    variant="soft"
                    class="mb-4"
                    title="Could not load teams"
                    :description="getErrorMessage(error)"
                />

                <UTable
                    ref="table"
                    v-model:column-filters="columnFilters"
                    v-model:column-visibility="columnVisibility"
                    v-model:row-selection="rowSelection"
                    v-model:pagination="pagination"
                    :pagination-options="paginationOptions"
                    class="shrink-0"
                    :data="data ?? []"
                    :columns="columns"
                    :loading="status === 'pending'"
                    :ui="{
                        base: 'table-fixed border-separate border-spacing-0',
                        thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
                        tbody: '[&>tr]:last:[&>td]:border-b-0',
                        th: 'py-2 first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
                        td: 'border-b border-default',
                        separator: 'h-0',
                    }"
                />

                <p
                    v-if="status !== 'pending' && !error && (data ?? []).length === 0"
                    class="rounded-lg border border-default p-4 text-sm text-muted"
                >
                    No teams exist yet.
                </p>

                <div
                    class="flex items-center justify-between gap-3 border-t border-default pt-4 mt-auto"
                >
                    <div class="text-sm text-muted">
                        {{ selectedRows.length || 0 }} of {{ filteredRowCount }} row(s) selected.
                    </div>

                    <div class="flex items-center gap-1.5">
                        <UPagination
                            v-model:page="pageModel"
                            :items-per-page="currentPageSize"
                            :total="filteredRowCount"
                        />
                    </div>
                </div>
            </template>
        </template>
    </UDashboardPanel>

    <UModal v-model:open="modalOpen" title="Delete teams">
        <template #content>
            <UCard>
                <template #header>
                    <div class="flex items-center gap-2">
                        <UIcon name="i-lucide-trash" class="text-error" />
                        <h3 class="text-base font-semibold">Delete teams</h3>
                    </div>
                </template>

                <p class="text-default">
                    Are you sure you want to delete
                    <strong>{{ selectedRows.length }}</strong>
                    selected team(s)? This action cannot be undone.
                </p>

                <template #footer>
                    <div class="flex justify-end gap-2">
                        <UButton
                            color="neutral"
                            variant="outline"
                            :disabled="deleting"
                            @click="modalOpen = false"
                        >
                            Cancel
                        </UButton>
                        <UButton
                            color="error"
                            :loading="deleting"
                            :disabled="deleting"
                            @click="onDelete"
                        >
                            Delete
                        </UButton>
                    </div>
                </template>
            </UCard>
        </template>
    </UModal>

    <UModal v-model:open="feedbackModalOpen">
        <template #content>
            <UCard
                tabindex="0"
                role="region"
                aria-label="Team review and management"
                class="max-h-[85dvh] w-full max-w-3xl overflow-y-auto"
            >
                <template #header>
                    <h3 class="text-base font-semibold">
                        Team review
                        <span v-if="selectedFeedbackTeam">
                            · {{ selectedFeedbackTeam.project_name || selectedFeedbackTeam.name }}
                        </span>
                    </h3>
                </template>

                <div v-if="selectedFeedbackTeam" class="space-y-4">
                    <p v-if="reviewLoading" class="text-sm text-muted" role="status">
                        Loading team details…
                    </p>

                    <UAlert
                        v-if="reviewError"
                        color="error"
                        variant="subtle"
                        title="Could not load judge evaluations"
                        :description="getErrorMessage(reviewError)"
                    >
                        <template #actions>
                            <UButton variant="outline" class="min-h-11" @click="loadTeamReview">
                                Try again
                            </UButton>
                        </template>
                    </UAlert>

                    <section class="rounded-lg border border-default p-3">
                        <h4 class="font-semibold">Status</h4>
                        <p class="mt-1 text-sm text-muted">Current status: {{ currentStatus }}</p>
                        <div class="mt-3 grid gap-3 sm:grid-cols-2">
                            <UFormField label="New status" class="w-full">
                                <USelect
                                    v-model="statusDraft"
                                    :items="teamStatusOptions"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="Reason"
                                class="w-full"
                                help="Required unless active."
                            >
                                <UInput
                                    v-model="statusReason"
                                    maxlength="500"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                />
                            </UFormField>
                        </div>
                        <div class="mt-3 flex flex-wrap gap-2">
                            <UButton
                                class="min-h-11"
                                :loading="pendingAction === 'status'"
                                :disabled="Boolean(pendingAction)"
                                @click="updateTeamStatus"
                            >
                                Apply status
                            </UButton>
                            <UButton
                                class="min-h-11"
                                variant="outline"
                                icon="i-lucide-unlock"
                                :loading="pendingAction === 'reopen'"
                                :disabled="
                                    !selectedFeedbackTeam.project_submitted ||
                                    Boolean(pendingAction)
                                "
                                @click="reopenSubmission"
                            >
                                Reopen submission
                            </UButton>
                            <UButton
                                class="min-h-11"
                                variant="outline"
                                icon="i-lucide-calculator"
                                :loading="pendingAction === 'recompute'"
                                :disabled="Boolean(pendingAction)"
                                @click="recomputeStandings"
                            >
                                Recompute standings
                            </UButton>
                        </div>
                    </section>

                    <section class="rounded-lg border border-default p-3">
                        <h4 class="font-semibold">Awards</h4>
                        <div v-if="teamAwards.length" class="mt-2 flex flex-wrap gap-2">
                            <UBadge
                                v-for="award in teamAwards"
                                :key="award.namespace"
                                variant="subtle"
                                :color="award.color === 'gold' ? 'warning' : 'primary'"
                                class="gap-1"
                            >
                                {{ award.name }}
                                <button
                                    type="button"
                                    class="ms-1 inline-flex min-h-6 min-w-6 items-center justify-center rounded hover:bg-elevated"
                                    :aria-label="`Remove the ${award.name} award`"
                                    :disabled="Boolean(pendingAction)"
                                    @click="unassignAward(award.namespace)"
                                >
                                    <UIcon name="i-lucide-x" aria-hidden="true" />
                                </button>
                            </UBadge>
                        </div>
                        <p v-else class="mt-2 text-sm text-muted">No awards are assigned.</p>

                        <p v-if="awardsUnavailable" class="mt-3 text-sm text-muted">
                            The award catalog is not enabled on this deployment.
                        </p>
                        <div
                            v-else
                            class="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
                        >
                            <UFormField label="Award" class="w-full">
                                <USelect
                                    v-model="selectedAward"
                                    :items="
                                        awardCatalog.map((award) => ({
                                            label: award.name,
                                            value: award.namespace,
                                        }))
                                    "
                                    placeholder="Choose an award"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                />
                            </UFormField>
                            <UButton
                                class="min-h-11"
                                :loading="pendingAction === 'award'"
                                :disabled="!selectedAward || Boolean(pendingAction)"
                                @click="assignAward"
                            >
                                Assign
                            </UButton>
                        </div>
                        <p
                            v-if="!awardsUnavailable && awardCatalog.length === 0"
                            class="mt-2 text-sm text-muted"
                        >
                            The catalog is empty. Create awards in the awards manager.
                        </p>
                    </section>

                    <section
                        v-if="teamScores?.feedback.length"
                        class="rounded-lg border border-default p-3"
                    >
                        <h4 class="font-semibold">Evaluations</h4>
                        <ul class="mt-2 divide-y divide-default">
                            <li
                                v-for="entry in teamScores.feedback"
                                :key="entry.judge_id"
                                class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                            >
                                <div class="min-w-0">
                                    <p class="font-medium">
                                        {{ entry.judge_name ?? `Judge #${entry.judge_id}` }}
                                    </p>
                                    <p class="text-xs text-muted">
                                        <span v-if="entry.normalized_score != null">
                                            {{ entry.normalized_score }}/100
                                        </span>
                                        <span v-if="entry.created_at" class="ms-2">
                                            {{ formatDateTime(entry.created_at) }}
                                        </span>
                                    </p>
                                </div>
                                <UButton
                                    v-if="entry.judge_id"
                                    size="sm"
                                    color="error"
                                    variant="subtle"
                                    class="min-h-11"
                                    :loading="pendingAction === `void-${entry.judge_id}`"
                                    :disabled="Boolean(pendingAction)"
                                    @click="voidScore(entry)"
                                >
                                    Void score
                                </UButton>
                            </li>
                        </ul>
                    </section>

                    <ScoreFeedbackPanel :team-id="selectedFeedbackTeam.id" admin />
                </div>
            </UCard>
        </template>
    </UModal>
</template>
