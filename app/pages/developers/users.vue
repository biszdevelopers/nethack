<script setup lang="ts">
import { apiFetch } from "~~/app/composables/useApiFetch";
import { NethackPermissions } from "~~/shared/permissions";
import type { TableColumn } from "@nuxt/ui";
import { upperFirst } from "scule";
import { getPaginationRowModel } from "@tanstack/table-core";
definePageMeta({
    layout: "developers-dashboard",
    middleware: ["auth"],
});

useHead({ title: `Users | ${WEBSITE_NAME}` });

const UserAvatar = resolveComponent("UserAvatar");
const UserPopover = resolveComponent("UserPopover");
const UButton = resolveComponent("UButton");
const UBadge = resolveComponent("UBadge");
const UCheckbox = resolveComponent("UCheckbox");

const { user: sessionUser } = useBasisAuthSession();
const { can } = useNethackPermissions();
const isAdmin = computed(() => can(NethackPermissions.all));
const currentUserId = computed(() => sessionUser.value?.id);

const toast = useToast();
const table = useTemplateRef<any>("table");
const modalOpen = ref(false);
const deleting = ref(false);
const pendingAdminIds = ref<number[]>([]);
const pendingJudgeIds = ref<number[]>([]);

const columnFilters = ref([
    {
        id: "email",
        value: "",
    },
]);
const columnVisibility = ref();
const rowSelection = ref<Record<string, boolean>>({});

type AdminUser = Omit<User, "is_admin" | "is_judge"> & {
    past_team_ids: string | null;
    is_admin: boolean;
    is_judge: boolean;
    is_initial_admin: boolean;
};

const { data, status, error, refresh } = await useApiFetch<AdminUser[]>("/api/users", {
    server: false,
    lazy: true,
    default: () => [],
});

const selectedRows = computed<any[]>(() => {
    if (!table.value?.tableApi) return [];
    return table.value.tableApi.getFilteredSelectedRowModel().rows;
});

const deletableIds = computed(() =>
    selectedRows.value
        .map((row: any) => row.original as AdminUser)
        .filter((user) => !user.is_initial_admin && user.id !== currentUserId.value)
        .map((user) => user.id),
);

async function onDelete() {
    if (deletableIds.value.length === 0 || deleting.value) return;

    deleting.value = true;
    try {
        await apiFetch("/api/users", {
            method: "DELETE",
            body: { ids: deletableIds.value },
        });

        toast.add({
            title: "Users deleted",
            description: `Successfully deleted ${deletableIds.value.length} user(s).`,
            color: "success",
        });

        rowSelection.value = {};
        await refresh();
    } catch (e: any) {
        toast.add({
            title: "Could not delete users",
            description: getErrorMessage(e),
            color: "error",
        });
    } finally {
        deleting.value = false;
        modalOpen.value = false;
    }
}

async function toggleAdmin(user: AdminUser) {
    if (user.is_initial_admin || user.id === currentUserId.value) return;
    if (pendingAdminIds.value.includes(user.id)) return;
    pendingAdminIds.value = [...pendingAdminIds.value, user.id];
    try {
        await apiFetch(`/api/users/${user.id}/admin`, {
            method: "PATCH",
            body: { is_admin: !user.is_admin },
        });
        toast.add({
            title: user.is_admin ? "Administrator removed" : "Administrator added",
            description: user.email,
            color: "success",
        });
        await refresh();
    } catch (e: any) {
        toast.add({
            title: "Failed to update administrator",
            description: getErrorMessage(e),
            color: "error",
        });
    } finally {
        pendingAdminIds.value = pendingAdminIds.value.filter((id) => id !== user.id);
    }
}

async function toggleJudge(user: AdminUser) {
    if (pendingJudgeIds.value.includes(user.id)) return;
    pendingJudgeIds.value = [...pendingJudgeIds.value, user.id];
    try {
        await apiFetch(`/api/users/${user.id}/judge`, {
            method: "PATCH",
            body: { is_judge: !user.is_judge },
        });
        toast.add({
            title: user.is_judge ? "Judge role removed" : "Judge role added",
            description: user.email,
            color: "success",
        });
        await refresh();
    } catch (e: any) {
        toast.add({
            title: "Failed to update the judge role",
            description: getErrorMessage(e),
            color: "error",
        });
    } finally {
        pendingJudgeIds.value = pendingJudgeIds.value.filter((id) => id !== user.id);
    }
}

const columns: TableColumn<AdminUser>[] = [
    {
        id: "select",
        header: ({ table }) =>
            h(UCheckbox, {
                modelValue: table.getIsSomePageRowsSelected()
                    ? "indeterminate"
                    : table.getIsAllPageRowsSelected(),
                "onUpdate:modelValue": (value: boolean | "indeterminate") =>
                    table.toggleAllPageRowsSelected(!!value),
                "aria-label": "Select all users",
            }),
        cell: ({ row }) =>
            h(UCheckbox, {
                modelValue: row.getIsSelected(),
                disabled: row.original.is_initial_admin || row.original.id === currentUserId.value,
                "onUpdate:modelValue": (value: boolean | "indeterminate") =>
                    row.toggleSelected(!!value),
                "aria-label": `Select ${row.original.name ?? row.original.email}`,
            }),
    },
    {
        accessorKey: "id",
        header: "ID",
    },
    {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => {
            const name = row.original.name ?? "Unknown";
            return h("div", { class: "flex items-center gap-3" }, [
                h(
                    UserPopover,
                    { user: row.original },
                    {
                        default: () =>
                            h(UserAvatar, {
                                user: row.original,
                                size: "lg",
                            }),
                    },
                ),
                h("p", { class: "font-medium text-highlighted" }, name),
            ]);
        },
    },
    {
        accessorKey: "email",
        header: ({ column }) => {
            const isSorted = column.getIsSorted();

            return h(UButton, {
                color: "neutral",
                variant: "ghost",
                label: "Email",
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
        id: "is_admin",
        header: "Admin",
        cell: ({ row }) =>
            h(UButton, {
                size: "xs",
                variant: "soft",
                color: row.original.is_initial_admin
                    ? "neutral"
                    : row.original.is_admin
                      ? "error"
                      : "primary",
                label: row.original.is_initial_admin
                    ? "Initial admin"
                    : row.original.is_admin
                      ? "Demote"
                      : "Promote",
                loading: pendingAdminIds.value.includes(row.original.id),
                disabled:
                    row.original.is_initial_admin ||
                    row.original.id === currentUserId.value ||
                    pendingAdminIds.value.includes(row.original.id),
                onClick: () => toggleAdmin(row.original),
            }),
    },
    {
        id: "is_judge",
        header: "Judge",
        cell: ({ row }) =>
            h(UButton, {
                size: "xs",
                variant: "soft",
                color: row.original.is_judge ? "warning" : "primary",
                label: row.original.is_judge ? "Demote" : "Promote",
                loading: pendingJudgeIds.value.includes(row.original.id),
                disabled: pendingJudgeIds.value.includes(row.original.id),
                onClick: () => toggleJudge(row.original),
            }),
    },
    {
        accessorKey: "team_id",
        header: "Team ID",
        cell: ({ row }) => row.original.team_id ?? "-",
    },
    {
        accessorKey: "past_team_ids",
        header: "Past Teams",
        cell: ({ row }) => {
            const ids = row.original.past_team_ids;
            if (!ids) return "-";
            const idList = ids
                .split(",")
                .map((s) => parseInt(s.trim(), 10))
                .filter(Boolean);
            return h(
                "div",
                { class: "flex flex-wrap gap-1" },
                idList.map((tid) =>
                    h(UBadge, { variant: "subtle", color: "neutral", size: "sm" }, () =>
                        String(tid),
                    ),
                ),
            );
        },
    },
];

const email = computed({
    get: (): string => {
        return (table.value?.tableApi?.getColumn("email")?.getFilterValue() as string) || "";
    },
    set: (value: string) => {
        table.value?.tableApi?.getColumn("email")?.setFilterValue(value || undefined);
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
    <UDashboardPanel id="users">
        <template #header>
            <UDashboardNavbar title="Users">
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
                description="Administrator access is required to manage users."
            />

            <template v-else>
                <div class="flex flex-wrap items-center justify-between gap-1.5">
                    <UInput
                        v-model="email"
                        class="max-w-sm"
                        icon="i-lucide-search"
                        placeholder="Filter emails..."
                    />

                    <div class="flex flex-wrap items-center gap-1.5">
                        <UButton
                            v-if="deletableIds.length"
                            label="Delete selected"
                            color="error"
                            variant="subtle"
                            icon="i-lucide-trash"
                            @click="modalOpen = true"
                        />

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
                    title="Could not load users"
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

    <UModal v-model:open="modalOpen" title="Delete users">
        <template #content>
            <UCard>
                <template #header>
                    <div class="flex items-center gap-2">
                        <UIcon name="i-lucide-trash" class="text-error" />
                        <h3 class="text-base font-semibold">Delete users</h3>
                    </div>
                </template>

                <p class="text-default">
                    Are you sure you want to delete
                    <strong>{{ deletableIds.length }}</strong>
                    selected user(s)? This action cannot be undone.
                </p>

                <template #footer>
                    <div class="flex justify-end gap-2">
                        <UButton color="neutral" variant="outline" @click="modalOpen = false">
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
</template>
