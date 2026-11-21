<script setup lang="ts">
import { apiFetch } from "~~/app/composables/useApiFetch";
import { NethackPermissions } from "~~/shared/permissions";
import { formatDateTime } from "~/utils/datetime";

definePageMeta({
    layout: "developers-dashboard",
    middleware: ["auth"],
});

useHead({ title: `Audit log | ${WEBSITE_NAME}` });

interface AdminAuditEvent {
    id: number | string;
    actor_user_id: number | null;
    action: string;
    entity_type: string;
    entity_id: string | number | null;
    before: unknown;
    after: unknown;
    reason: string | null;
    created_at: string | number;
}

interface DiffEntry {
    key: string;
    before: string;
    after: string;
}

const { can } = useNethackPermissions();
const isAdmin = computed(() => can(NethackPermissions.all));

const { data: adminData } = await useApiFetch("/api/admin/hackathon", {
    server: false,
    $fetch: globalThis.$fetch,
});
const seasons = computed(() => adminData.value?.seasons ?? []);

const events = ref<AdminAuditEvent[]>([]);
const loading = ref(false);
const loadError = ref<unknown>(null);
const seasonFilter = ref<number | null>(null);
const actionFilter = ref("");

const seasonItems = computed(() => [
    { label: "All seasons", value: null },
    ...(seasons.value as Season[]).map((season) => ({ label: season.name, value: season.id })),
]);

const unavailable = computed(() => isEndpointUnavailable(loadError.value));

const visibleEvents = computed(() => {
    const needle = actionFilter.value.trim().toLowerCase();
    if (!needle) return events.value;
    return events.value.filter((event) => event.action.toLowerCase().includes(needle));
});

function formatValue(value: unknown): string {
    if (value === null || value === undefined) return "—";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function diffEntries(before: unknown, after: unknown): DiffEntry[] {
    const beforeObject =
        before && typeof before === "object" ? (before as Record<string, unknown>) : null;
    const afterObject =
        after && typeof after === "object" ? (after as Record<string, unknown>) : null;
    if (!beforeObject && !afterObject) {
        return [
            {
                key: "value",
                before: formatValue(before),
                after: formatValue(after),
            },
        ];
    }

    const keys = new Set([...Object.keys(beforeObject ?? {}), ...Object.keys(afterObject ?? {})]);
    return [...keys]
        .filter((key) => formatValue(beforeObject?.[key]) !== formatValue(afterObject?.[key]))
        .map((key) => ({
            key,
            before: formatValue(beforeObject?.[key]),
            after: formatValue(afterObject?.[key]),
        }));
}

async function loadEvents() {
    if (loading.value) return;
    loading.value = true;
    loadError.value = null;
    try {
        const query = new URLSearchParams({ limit: "50" });
        if (seasonFilter.value !== null) query.set("season_id", String(seasonFilter.value));
        const response = await apiFetch<{ events?: AdminAuditEvent[] } | AdminAuditEvent[]>(
            `/api/admin/audit?${query.toString()}`,
        );
        events.value = Array.isArray(response) ? response : (response.events ?? []);
    } catch (error) {
        events.value = [];
        loadError.value = error;
    } finally {
        loading.value = false;
    }
}

watch(seasonFilter, () => void loadEvents());
onMounted(() => void loadEvents());
</script>

<template>
    <UDashboardPanel id="audit">
        <template #header>
            <UDashboardNavbar title="Audit log">
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
                description="Administrator access is required to read the audit log."
            />

            <div v-else class="space-y-4">
                <div class="flex flex-wrap items-end gap-3">
                    <UFormField label="Season" class="w-full sm:w-64">
                        <USelect
                            v-model="seasonFilter"
                            :items="seasonItems"
                            :ui="{ base: 'min-h-11' }"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField label="Action contains" class="w-full sm:w-64">
                        <UInput
                            v-model="actionFilter"
                            icon="i-lucide-search"
                            placeholder="For example, team.status"
                            :ui="{ base: 'min-h-11' }"
                            class="w-full"
                        />
                    </UFormField>
                    <UButton
                        class="min-h-11"
                        variant="outline"
                        icon="i-lucide-refresh-cw"
                        :loading="loading"
                        :disabled="loading"
                        @click="loadEvents"
                    >
                        Refresh
                    </UButton>
                </div>

                <p
                    v-if="loading"
                    class="rounded-lg border border-default p-4 text-sm text-muted"
                    role="status"
                >
                    Loading audit events…
                </p>

                <UAlert
                    v-else-if="unavailable"
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-info"
                    title="Audit log is not enabled"
                    description="This deployment does not expose the audit endpoint yet."
                />

                <UAlert
                    v-else-if="loadError"
                    color="error"
                    variant="subtle"
                    title="Could not load the audit log"
                    :description="getErrorMessage(loadError)"
                >
                    <template #actions>
                        <UButton variant="outline" class="min-h-11" @click="loadEvents">
                            Try again
                        </UButton>
                    </template>
                </UAlert>

                <p
                    v-else-if="visibleEvents.length === 0"
                    class="rounded-lg border border-default p-4 text-sm text-muted"
                >
                    No audit events match these filters.
                </p>

                <ol v-else class="space-y-3">
                    <li
                        v-for="event in visibleEvents"
                        :key="event.id"
                        class="rounded-xl border border-default p-4"
                    >
                        <div class="flex flex-wrap items-baseline justify-between gap-2">
                            <p class="font-semibold">{{ event.action }}</p>
                            <p class="text-sm text-muted">
                                {{ formatDateTime(event.created_at) }}
                            </p>
                        </div>
                        <p class="mt-1 text-sm text-muted">
                            {{ event.entity_type }}
                            <span v-if="event.entity_id !== null">#{{ event.entity_id }}</span>
                            · actor
                            {{
                                event.actor_user_id !== null ? `#${event.actor_user_id}` : "system"
                            }}
                        </p>
                        <p v-if="event.reason" class="mt-2 text-sm">Reason: {{ event.reason }}</p>

                        <ul
                            v-if="diffEntries(event.before, event.after).length"
                            class="mt-3 space-y-1 text-sm"
                        >
                            <li
                                v-for="entry in diffEntries(event.before, event.after)"
                                :key="entry.key"
                                class="grid gap-1 sm:grid-cols-[minmax(8rem,12rem)_minmax(0,1fr)]"
                            >
                                <span class="font-medium">{{ entry.key }}</span>
                                <span class="break-words">
                                    <span class="text-muted line-through">{{ entry.before }}</span>
                                    <span class="mx-2" aria-hidden="true">→</span>
                                    <span>{{ entry.after }}</span>
                                </span>
                            </li>
                        </ul>
                        <p v-else class="mt-3 text-sm text-muted">
                            No field changes were recorded.
                        </p>
                    </li>
                </ol>
            </div>
        </template>
    </UDashboardPanel>
</template>
