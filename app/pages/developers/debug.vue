<script setup lang="ts">
import { onMounted } from "vue";

definePageMeta({
    layout: "developers-dashboard",
});

// File upload state
const file = ref<File | null>(null);
const uploading = ref(false);
const permalink = ref("");
const safePermalink = computed(() => safeUrl(permalink.value));
const uploadError = ref("");
const loadingFiles = ref(false);
const fileLists = ref({
    assets: [] as Array<{ name: string; url: string }>,
    userast: [] as Array<{ name: string; url: string }>,
});

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

const handleFileChange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    file.value = target.files?.[0] || null;
};

const uploadFile = async () => {
    if (!file.value) return;

    uploading.value = true;
    uploadError.value = "";
    permalink.value = "";

    try {
        const formData = new FormData();
        formData.append("file", file.value);

        const params = new URLSearchParams({ mode: value.value });
        const response = await $fetch<{ permalink: string }>(
            `/api/debug/upload?${params.toString()}`,
            {
                method: "POST",
                body: formData,
            },
        );

        permalink.value = response.permalink;
        await loadFiles();
    } catch (err: any) {
        uploadError.value = err.message || "Upload failed";
    } finally {
        uploading.value = false;
    }
};

onMounted(loadFiles);
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
                                @click="loadFiles"
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
            </div>
        </template>
    </UDashboardPanel>
</template>
