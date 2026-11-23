<script setup lang="ts">
import { apiFetch } from "~~/app/composables/useApiFetch";
import { NethackPermissions } from "~~/shared/permissions";

definePageMeta({
    layout: "developers-dashboard",
    middleware: ["auth"],
});

useHead({ title: `Awards | ${WEBSITE_NAME}` });

const toast = useToast();
const { can } = useNethackPermissions();
const isAdmin = computed(() => can(NethackPermissions.all));

const awards = ref<APIAward[]>([]);
const loading = ref(false);
const loadError = ref<unknown>(null);
const saving = ref(false);
const deleting = ref<string | null>(null);

const form = reactive({
    namespace: "",
    name: "",
    description: "",
    icon: "i-lucide-award",
    color: "gold",
});

const unavailable = computed(() => isEndpointUnavailable(loadError.value));

function normalizeAwardCatalog(payload: unknown): APIAward[] {
    if (Array.isArray(payload)) return payload as APIAward[];
    const list = (payload as { awards?: APIAward[] } | null)?.awards;
    return Array.isArray(list) ? list : [];
}

async function loadAwards() {
    if (loading.value) return;
    loading.value = true;
    loadError.value = null;
    try {
        awards.value = normalizeAwardCatalog(await apiFetch<unknown>("/api/admin/awards"));
    } catch (error) {
        awards.value = [];
        loadError.value = error;
    } finally {
        loading.value = false;
    }
}

onMounted(() => void loadAwards());

async function createAward() {
    if (saving.value) return;
    const namespace = form.namespace.trim();
    const name = form.name.trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(namespace)) {
        toast.add({
            title: "Use a valid award key",
            description:
                "The award key must start with a lowercase letter or number and use only lowercase letters, numbers, _ or -.",
            color: "warning",
        });
        return;
    }
    if (!name) {
        toast.add({ title: "Enter an award name", color: "warning" });
        return;
    }

    saving.value = true;
    try {
        await apiFetch("/api/admin/awards", {
            method: "POST",
            body: {
                namespace,
                name,
                description: form.description.trim(),
                icon: form.icon.trim() || "i-lucide-award",
                color: form.color.trim() || "gold",
            },
        });
        toast.add({ title: "Award created", description: name, color: "success" });
        form.namespace = "";
        form.name = "";
        form.description = "";
        form.icon = "i-lucide-award";
        form.color = "gold";
        await loadAwards();
    } catch (error) {
        toast.add({
            title: isEndpointUnavailable(error)
                ? "Awards are not enabled"
                : "Could not create the award",
            description: isEndpointUnavailable(error)
                ? "This deployment does not expose the awards endpoints yet."
                : getErrorMessage(error),
            color: isEndpointUnavailable(error) ? "warning" : "error",
        });
    } finally {
        saving.value = false;
    }
}

async function removeAward(award: APIAward) {
    if (deleting.value) return;
    if (
        !window.confirm(
            `Delete the "${award.name}" award?\n\nAssignments of this award must be removed from teams first.`,
        )
    ) {
        return;
    }
    deleting.value = award.namespace;
    try {
        await apiFetch(`/api/admin/awards/${award.namespace}`, { method: "DELETE" });
        toast.add({ title: "Award deleted", description: award.name, color: "success" });
        await loadAwards();
    } catch (error) {
        toast.add({
            title: isEndpointUnavailable(error)
                ? "Awards are not enabled"
                : "Could not delete the award",
            description: isEndpointUnavailable(error)
                ? "This deployment does not expose the awards endpoints yet."
                : getErrorMessage(error),
            color: isEndpointUnavailable(error) ? "warning" : "error",
        });
    } finally {
        deleting.value = null;
    }
}
</script>

<template>
    <UDashboardPanel id="awards">
        <template #header>
            <UDashboardNavbar title="Awards">
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
                description="Administrator access is required to manage awards."
            />

            <div v-else class="space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 class="text-xl font-semibold">Award catalog</h1>
                        <p class="mt-1 text-sm text-muted">
                            Define the awards teams can receive, then assign them from the teams
                            page.
                        </p>
                    </div>
                    <div class="flex flex-wrap gap-2">
                        <UButton
                            class="min-h-11"
                            variant="outline"
                            icon="i-lucide-refresh-cw"
                            :loading="loading"
                            :disabled="loading"
                            @click="loadAwards"
                        >
                            Refresh
                        </UButton>
                        <UButton class="min-h-11" icon="i-lucide-plus" to="/developers/teams">
                            Assign awards
                        </UButton>
                    </div>
                </div>

                <p
                    v-if="loading"
                    class="rounded-lg border border-default p-4 text-sm text-muted"
                    role="status"
                >
                    Loading awards…
                </p>

                <UAlert
                    v-else-if="unavailable"
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-info"
                    title="Awards are not enabled"
                    description="This deployment does not expose the awards endpoints yet."
                />

                <UAlert
                    v-else-if="loadError"
                    color="error"
                    variant="subtle"
                    title="Could not load awards"
                    :description="getErrorMessage(loadError)"
                >
                    <template #actions>
                        <UButton variant="outline" class="min-h-11" @click="loadAwards">
                            Try again
                        </UButton>
                    </template>
                </UAlert>

                <template v-else>
                    <ul v-if="awards.length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <li
                            v-for="award in awards"
                            :key="award.namespace"
                            class="rounded-xl border border-default p-4"
                        >
                            <div class="flex items-start justify-between gap-3">
                                <div class="flex min-w-0 items-start gap-3">
                                    <UIcon
                                        :name="award.icon || 'i-lucide-award'"
                                        class="size-6 shrink-0"
                                        aria-hidden="true"
                                    />
                                    <div class="min-w-0">
                                        <p class="break-words font-semibold">{{ award.name }}</p>
                                        <p class="text-xs text-muted">{{ award.namespace }}</p>
                                    </div>
                                </div>
                                <UButton
                                    color="error"
                                    variant="subtle"
                                    size="sm"
                                    class="min-h-11"
                                    :loading="deleting === award.namespace"
                                    :disabled="deleting !== null"
                                    @click="removeAward(award)"
                                >
                                    Delete
                                </UButton>
                            </div>
                            <p v-if="award.description" class="mt-2 text-sm">
                                {{ award.description }}
                            </p>
                            <UBadge color="neutral" variant="subtle" class="mt-2">
                                {{ award.color || "gold" }}
                            </UBadge>
                        </li>
                    </ul>

                    <p v-else class="rounded-lg border border-default p-4 text-sm text-muted">
                        No awards exist yet. Create the first one below.
                    </p>

                    <UCard>
                        <template #header>
                            <h2 class="font-semibold">New award</h2>
                        </template>
                        <div class="grid gap-3 sm:grid-cols-2">
                            <UFormField
                                label="Key"
                                name="namespace"
                                help="Lowercase letters, numbers, _ or -."
                                class="w-full"
                            >
                                <UInput
                                    v-model="form.namespace"
                                    maxlength="64"
                                    placeholder="best-design"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField label="Name" name="name" class="w-full">
                                <UInput
                                    v-model="form.name"
                                    maxlength="100"
                                    placeholder="Best design"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="Description"
                                name="description"
                                class="w-full sm:col-span-2"
                            >
                                <UTextarea
                                    v-model="form.description"
                                    :rows="2"
                                    maxlength="500"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField label="Icon" name="icon" class="w-full">
                                <UInput
                                    v-model="form.icon"
                                    maxlength="100"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField label="Color" name="color" class="w-full">
                                <UInput
                                    v-model="form.color"
                                    maxlength="32"
                                    :ui="{ base: 'min-h-11' }"
                                    class="w-full"
                                />
                            </UFormField>
                        </div>
                        <div class="mt-4">
                            <UButton
                                class="min-h-11"
                                icon="i-lucide-plus"
                                :loading="saving"
                                :disabled="saving"
                                @click="createAward"
                            >
                                Create award
                            </UButton>
                        </div>
                    </UCard>
                </template>
            </div>
        </template>
    </UDashboardPanel>
</template>
