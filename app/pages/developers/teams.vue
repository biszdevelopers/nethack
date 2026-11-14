<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import { upperFirst } from "scule";
import { getPaginationRowModel } from "@tanstack/table-core";
useHead({ title: `Teams | ${WEBSITE_NAME}` });

definePageMeta({
    layout: "developers-dashboard",
});

const UButton = resolveComponent("UButton");
const UBadge = resolveComponent("UBadge");
const UCheckbox = resolveComponent("UCheckbox");
const UserAvatarGroup = resolveComponent("UserAvatarGroup");

const toast = useToast();
const table = useTemplateRef<any>("table");
const modalOpen = ref(false);
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

type AdminTeam = Team & { season_name: string | null; members: AdminTeamMember[] };

const { data, status, refresh } = await useApiFetch<AdminTeam[]>("/api/admin/teams", {
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
    if (selectedIds.value.length === 0) return;

    try {
        await $fetch("/api/admin/teams", {
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
            title: "Error",
            description: e?.data?.message || e?.message || "Failed to delete teams.",
            color: "error",
        });
    } finally {
        modalOpen.value = false;
    }
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
                ariaLabel: "Select all",
            }),
        cell: ({ row }) =>
            h(UCheckbox, {
                modelValue: row.getIsSelected(),
                "onUpdate:modelValue": (value: boolean | "indeterminate") =>
                    row.toggleSelected(!!value),
                ariaLabel: "Select row",
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
                onClick: () => {
                    selectedFeedbackTeam.value = row.original;
                    feedbackModalOpen.value = true;
                },
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
            return h(
                UBadge,
                {
                    class: "capitalize",
                    variant: "subtle",
                    color: submitted ? "success" : "neutral",
                },
                () => (submitted ? "Yes" : "No"),
            );
        },
    },
    {
        accessorKey: "season_name",
        header: "Season",
        cell: ({ row }) => row.original.season_name ?? "-",
    },
];

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

            <div
                class="flex items-center justify-between gap-3 border-t border-default pt-4 mt-auto"
            >
                <div class="text-sm text-muted">
                    {{ selectedRows.length || 0 }} of {{ filteredRowCount }} row(s) selected.
                </div>

                <div class="flex items-center gap-1.5">
                    <UPagination
                        :default-page="currentPage"
                        :items-per-page="currentPageSize"
                        :total="filteredRowCount"
                        @update:page="(p: number) => table?.tableApi?.setPageIndex(p - 1)"
                    />
                </div>
            </div>
        </template>
    </UDashboardPanel>

    <UModal v-model:open="modalOpen">
        <template #content>
            <UCard>
                <template #header>
                    <div class="flex items-center gap-2">
                        <UIcon name="i-lucide-trash" class="text-error" />
                        <h3 class="text-base font-semibold">Delete teams</h3>
                    </div>
                </template>

                <p class="text-muted">
                    Are you sure you want to delete
                    <strong>{{ selectedRows.length }}</strong>
                    selected team(s)? This action cannot be undone.
                </p>

                <template #footer>
                    <div class="flex justify-end gap-2">
                        <UButton color="neutral" variant="outline" @click="modalOpen = false">
                            Cancel
                        </UButton>
                        <UButton color="error" @click="onDelete">Delete</UButton>
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
                aria-label="Judge feedback details"
                class="max-h-[85dvh] w-full max-w-3xl overflow-y-auto"
            >
                <template #header>
                    <h3 class="text-base font-semibold">
                        Judge feedback
                        <span v-if="selectedFeedbackTeam">
                            · {{ selectedFeedbackTeam.project_name || selectedFeedbackTeam.name }}
                        </span>
                    </h3>
                </template>
                <ScoreFeedbackPanel
                    v-if="selectedFeedbackTeam"
                    :team-id="selectedFeedbackTeam.id"
                    admin
                />
            </UCard>
        </template>
    </UModal>
</template>
