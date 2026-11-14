<script setup lang="ts">
import { onMounted } from "vue";

definePageMeta({
    layout: "developers-dashboard",
});

// File upload state
const file = ref<File | null>(null);
const uploading = ref(false);
const permalink = ref("");
const referenceId = ref("");
const releasingReferenceId = ref<string | null>(null);
const safePermalink = computed(() => safeUrl(permalink.value));
const uploadError = ref("");
const loadingFiles = ref(false);
const loadingReferences = ref(false);
const references = ref<AssetReference[]>([]);
const referencePage = ref(1);
const referencePageSize = 20;
const referencePagination = ref({ total: 0, total_pages: 0 });
const fileLists = ref({
    assets: [] as Array<{ name: string; url: string }>,
    userast: [] as Array<{ name: string; url: string }>,
});

interface AssetReference {
    id: string;
    collection: "assets" | "userassets";
    permalink: string;
    created_at: string;
}

const items = ref(["static", "user"]);
const value = ref("static");

const loadFiles = async () => {
    loadingFiles.value = true;
    try {
        const response = await $fetch<{ assets: string[]; userast: string[] }>("/api/debug/files");
        fileLists.value.assets = response.assets.map((name) => ({
            name,
            url: `/assets/uploads/${name}`,
        }));
        fileLists.value.userast = response.userast.map((name) => ({
            name,
            url: `/userast/${name}`,
        }));
    } catch (err: any) {
        uploadError.value = err.message || "Unable to load file list";
    } finally {
        loadingFiles.value = false;
    }
};

const loadReferences = async (page = referencePage.value) => {
    loadingReferences.value = true;
    try {
        const response = await $fetch<{
            items: AssetReference[];
            page: number;
            page_size: number;
            total: number;
            total_pages: number;
        }>("/api/assets/references", {
            query: { page, page_size: referencePageSize },
        });
        references.value = response.items;
        referencePage.value = response.page;
        referencePagination.value = {
            total: response.total,
            total_pages: response.total_pages,
        };
    } catch (err: any) {
        uploadError.value = err.message || "Unable to load permalink references";
    } finally {
        loadingReferences.value = false;
    }
};

const refreshUploads = async (resetReferencePage = false) => {
    if (resetReferencePage) referencePage.value = 1;
    await Promise.all([loadFiles(), loadReferences()]);
};

const handleFileChange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    file.value = target.files?.[0] || null;
};

const uploadFile = async () => {
    if (!file.value) return;

    uploading.value = true;
    uploadError.value = "";
    permalink.value = "";
    referenceId.value = "";

    try {
        const formData = new FormData();
        formData.append("file", file.value);

        const params = new URLSearchParams({ mode: value.value });
        const response = await $fetch<{ permalink: string; referenceId: string }>(
            `/api/debug/upload?${params.toString()}`,
            {
                method: "POST",
                body: formData,
            },
        );

        permalink.value = response.permalink;
        referenceId.value = response.referenceId;
        await refreshUploads(true);
    } catch (err: any) {
        uploadError.value = err.message || "Upload failed";
    } finally {
        uploading.value = false;
    }
};

const releaseReference = async (id = referenceId.value) => {
    if (!id || releasingReferenceId.value) return;
    releasingReferenceId.value = id;
    uploadError.value = "";
    try {
        await $fetch(`/api/assets/references/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (referenceId.value === id) {
            permalink.value = "";
            referenceId.value = "";
        }
        await refreshUploads(true);
    } catch (err: any) {
        uploadError.value = err.message || "Unable to release this permalink";
    } finally {
        releasingReferenceId.value = null;
    }
};

onMounted(refreshUploads);
</script>

<template>
    <UDashboardPanel id="debug">
        <template #header>
            <UDashboardNavbar title="Files">
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
            </UDashboardNavbar>
        </template>

        <template #body>
            <UAlert
                v-if="uploadError"
                color="error"
                variant="soft"
                class="mb-4"
                :title="uploadError"
                :close="{
                    onClick: () => {
                        uploadError = '';
                    },
                }"
            />

            <div class="space-y-6">
                <UCard>
                    <template #header>
                        <h2 class="text-lg font-semibold">Upload File</h2>
                    </template>

                    <form class="space-y-4" @submit.prevent="uploadFile">
                        <div>
                            <label class="block text-sm font-medium mb-1">Select File</label>
                            <input
                                type="file"
                                class="block w-full text-sm text-muted file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary file:text-white hover:file:bg-primary/90"
                                required
                                @change="handleFileChange"
                            />
                        </div>

                        <USelectMenu v-model="value" :items="items" />

                        <UButton
                            type="submit"
                            label="Upload"
                            :loading="uploading"
                            :disabled="!file || uploading"
                        />
                    </form>

                    <div v-if="permalink" class="mt-4">
                        <p class="text-sm">
                            Permalink:
                            <a
                                v-if="safePermalink"
                                :href="safePermalink"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="text-primary hover:underline"
                            >
                                {{ permalink }}
                            </a>
                            <span v-else class="text-muted">
                                {{ permalink }} (blocked unsafe URL)
                            </span>
                        </p>
                        <p class="mt-2 text-sm text-muted">
                            This permalink stays active until released. After release, its file can
                            be collected after seven days if no other permalink uses it.
                        </p>
                        <UButton
                            v-if="referenceId"
                            class="mt-2"
                            color="error"
                            variant="soft"
                            :loading="releasingReferenceId === referenceId"
                            :disabled="releasingReferenceId !== null"
                            label="Release this permalink"
                            @click="releaseReference(referenceId)"
                        />
                    </div>
                </UCard>

                <UCard>
                    <template #header>
                        <div class="flex items-center justify-between">
                            <h2 class="text-lg font-semibold">Uploaded Asset Files</h2>
                            <UButton
                                icon="i-lucide-refresh-cw"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                @click="refreshUploads()"
                            />
                        </div>
                    </template>

                    <div class="grid gap-4 md:grid-cols-2">
                        <div>
                            <h3 class="font-medium mb-2">/assets</h3>
                            <ul class="space-y-1">
                                <li v-if="loadingFiles" class="text-sm text-muted">
                                    Loading assets...
                                </li>
                                <li
                                    v-else-if="fileLists.assets.length === 0"
                                    class="text-sm text-muted"
                                >
                                    No file uploads found.
                                </li>
                                <li v-for="f in fileLists.assets" :key="f.name">
                                    <a
                                        :href="f.url"
                                        target="_blank"
                                        class="text-sm text-primary hover:underline"
                                    >
                                        {{ f.name }}
                                    </a>
                                </li>
                            </ul>
                        </div>

                        <div>
                            <h3 class="font-medium mb-2">/userast</h3>
                            <ul class="space-y-1">
                                <li v-if="loadingFiles" class="text-sm text-muted">
                                    Loading user assets...
                                </li>
                                <li
                                    v-else-if="fileLists.userast.length === 0"
                                    class="text-sm text-muted"
                                >
                                    No user asset uploads found.
                                </li>
                                <li v-for="f in fileLists.userast" :key="f.name">
                                    <a
                                        :href="f.url"
                                        target="_blank"
                                        class="text-sm text-primary hover:underline"
                                    >
                                        {{ f.name }}
                                    </a>
                                </li>
                            </ul>
                        </div>
                    </div>
                </UCard>

                <UCard>
                    <template #header>
                        <div
                            class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                        >
                            <div>
                                <h2 class="text-lg font-semibold">Active Permalink References</h2>
                                <p class="mt-1 text-sm text-muted">
                                    References remain active until released. Shared files stay
                                    available while any reference remains.
                                </p>
                            </div>
                            <UButton
                                icon="i-lucide-refresh-cw"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                label="Refresh references"
                                :loading="loadingReferences"
                                @click="loadReferences()"
                            />
                        </div>
                    </template>

                    <ul class="space-y-3">
                        <li v-if="loadingReferences" class="text-sm text-muted">
                            Loading references...
                        </li>
                        <li v-else-if="references.length === 0" class="text-sm text-muted">
                            No active permalink references.
                        </li>
                        <li
                            v-for="reference in references"
                            :key="reference.id"
                            class="flex flex-col gap-2 rounded border border-default p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                            <div class="min-w-0">
                                <a
                                    :href="reference.permalink"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="break-all text-primary hover:underline"
                                >
                                    {{ reference.permalink }}
                                </a>
                                <p class="text-xs text-muted">
                                    {{
                                        reference.collection === "assets"
                                            ? "Static upload"
                                            : "User asset"
                                    }}
                                    · {{ reference.created_at }}
                                </p>
                            </div>
                            <UButton
                                class="min-h-11 min-w-11 shrink-0"
                                color="error"
                                variant="soft"
                                :loading="releasingReferenceId === reference.id"
                                :disabled="releasingReferenceId !== null"
                                :label="
                                    releasingReferenceId === reference.id
                                        ? 'Releasing...'
                                        : 'Release'
                                "
                                @click="releaseReference(reference.id)"
                            />
                        </li>
                    </ul>
                    <div
                        v-if="referencePagination.total_pages > 1"
                        class="mt-4 flex items-center justify-between gap-3"
                        aria-label="Permalink reference pages"
                    >
                        <UButton
                            class="min-h-11 min-w-11"
                            color="neutral"
                            variant="outline"
                            label="Previous"
                            :disabled="loadingReferences || referencePage <= 1"
                            @click="loadReferences(referencePage - 1)"
                        />
                        <span class="text-sm text-muted">
                            Page {{ referencePage }} of {{ referencePagination.total_pages }}
                        </span>
                        <UButton
                            class="min-h-11 min-w-11"
                            color="neutral"
                            variant="outline"
                            label="Next"
                            :disabled="
                                loadingReferences ||
                                referencePage >= referencePagination.total_pages
                            "
                            @click="loadReferences(referencePage + 1)"
                        />
                    </div>
                </UCard>
            </div>
        </template>
    </UDashboardPanel>
</template>
