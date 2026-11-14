<template>
    <div class="p-4">
        <div class="flex gap-4 mb-6">
            <button
                :class="[
                    'px-4 py-2 rounded font-medium',
                    activeTab === 'upload' ? 'bg-primary text-white' : 'bg-gray-200 text-gray-800',
                ]"
                @click="activeTab = 'upload'"
            >
                File Upload
            </button>
            <button
                :class="[
                    'px-4 py-2 rounded font-medium',
                    activeTab === 'deepseek'
                        ? 'bg-primary text-white'
                        : 'bg-gray-200 text-gray-800',
                ]"
                @click="activeTab = 'deepseek'"
            >
                DeepSeek Chat
            </button>
        </div>

        <!-- File Upload Tab -->
        <div v-if="activeTab === 'upload'">
            <h1 class="text-2xl font-bold mb-4">Debug File Upload</h1>
            <form class="space-y-4" @submit.prevent="uploadFile">
                <div>
                    <label for="file" class="block text-sm font-medium">Select File</label>
                    <input
                        id="file"
                        type="file"
                        class="mt-1 block w-full"
                        required
                        @change="handleFileChange"
                    />
                </div>
                <USelectMenu v-model="value" :items="items" />
                <button
                    type="submit"
                    :disabled="!file || uploading"
                    class="bg-primary text-white px-4 py-2 rounded disabled:opacity-50"
                >
                    {{ uploading ? "Uploading..." : "Upload" }}
                </button>
            </form>
            <div v-if="permalink" class="mt-4">
                <p>
                    Permalink:
                    <a
                        v-if="safePermalink"
                        :href="safePermalink"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-blue-500"
                    >
                        {{ permalink }}
                    </a>
                    <span v-else class="text-muted">{{ permalink }} (blocked unsafe URL)</span>
                </p>
                <p class="mt-2 text-sm text-muted">
                    This permalink remains active until its reference is released. Unreferenced
                    files become eligible for cleanup after seven days.
                </p>
                <button
                    v-if="referenceId"
                    type="button"
                    class="mt-2 min-h-11 rounded bg-red-700 px-3 py-2 text-white disabled:opacity-50"
                    :disabled="releasingReferenceId !== null"
                    @click="releaseReference(referenceId)"
                >
                    {{
                        releasingReferenceId === referenceId
                            ? "Releasing..."
                            : "Release this permalink"
                    }}
                </button>
            </div>
            <div v-if="error" class="mt-4 text-red-500">Error: {{ error }}</div>

            <section class="mt-8">
                <div class="flex items-center justify-between mb-4">
                    <h2 class="text-2xl font-bold">Uploaded Asset Files</h2>
                    <button
                        type="button"
                        class="bg-secondary text-white px-3 py-2 rounded"
                        @click="refreshUploads()"
                    >
                        Refresh
                    </button>
                </div>

                <div class="grid gap-6 md:grid-cols-2">
                    <div class="rounded border border-slate-200 p-4 bg-slate-50">
                        <h3 class="text-xl font-semibold mb-2">/assets</h3>
                        <ul class="space-y-2">
                            <li v-if="loadingFiles" class="text-sm text-slate-500">
                                Loading assets...
                            </li>
                            <li
                                v-else-if="fileLists.assets.length === 0"
                                class="text-sm text-slate-500"
                            >
                                No file uploads found.
                            </li>
                            <li v-for="file in fileLists.assets" :key="file.name">
                                <a
                                    :href="file.url"
                                    target="_blank"
                                    class="text-blue-600 hover:underline"
                                >
                                    {{ file.name }}
                                </a>
                            </li>
                        </ul>
                    </div>

                    <div class="rounded border border-slate-200 p-4 bg-slate-50">
                        <h3 class="text-xl font-semibold mb-2">/userast</h3>
                        <ul class="space-y-2">
                            <li v-if="loadingFiles" class="text-sm text-slate-500">
                                Loading user assets...
                            </li>
                            <li
                                v-else-if="fileLists.userast.length === 0"
                                class="text-sm text-slate-500"
                            >
                                No user asset uploads found.
                            </li>
                            <li v-for="file in fileLists.userast" :key="file.name">
                                <a
                                    :href="file.url"
                                    target="_blank"
                                    class="text-blue-600 hover:underline"
                                >
                                    {{ file.name }}
                                </a>
                            </li>
                        </ul>
                    </div>
                </div>
            </section>

            <section class="mt-8 rounded border border-slate-200 p-4">
                <div class="mb-4 flex items-center justify-between gap-3">
                    <div>
                        <h2 class="text-xl font-bold">Active Permalink References</h2>
                        <p class="mt-1 text-sm text-slate-600">
                            References remain active until released. Shared files stay available
                            while any reference remains.
                        </p>
                    </div>
                    <button
                        type="button"
                        class="min-h-11 rounded bg-secondary px-3 py-2 text-white"
                        :disabled="loadingReferences"
                        @click="loadReferences()"
                    >
                        Refresh references
                    </button>
                </div>
                <ul class="space-y-3">
                    <li v-if="loadingReferences" class="text-sm text-slate-500">
                        Loading references...
                    </li>
                    <li v-else-if="references.length === 0" class="text-sm text-slate-500">
                        No active permalink references.
                    </li>
                    <li
                        v-for="reference in references"
                        :key="reference.id"
                        class="flex flex-col gap-2 rounded border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                        <div class="min-w-0">
                            <a
                                :href="reference.permalink"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="break-all text-blue-600 hover:underline"
                            >
                                {{ reference.permalink }}
                            </a>
                            <p class="text-xs text-slate-500">
                                {{
                                    reference.collection === "assets"
                                        ? "Static upload"
                                        : "User asset"
                                }}
                                · {{ reference.created_at }}
                            </p>
                        </div>
                        <button
                            type="button"
                            class="min-h-11 min-w-11 shrink-0 rounded bg-red-700 px-3 py-2 text-white disabled:opacity-50"
                            :disabled="releasingReferenceId !== null"
                            @click="releaseReference(reference.id)"
                        >
                            {{ releasingReferenceId === reference.id ? "Releasing..." : "Release" }}
                        </button>
                    </li>
                </ul>
                <div
                    v-if="referencePagination.total_pages > 1"
                    class="mt-4 flex items-center justify-between gap-3"
                    aria-label="Permalink reference pages"
                >
                    <button
                        type="button"
                        class="min-h-11 min-w-11 rounded border px-3"
                        :disabled="loadingReferences || referencePage <= 1"
                        @click="loadReferences(referencePage - 1)"
                    >
                        Previous
                    </button>
                    <span class="text-sm text-slate-600">
                        Page {{ referencePage }} of {{ referencePagination.total_pages }}
                    </span>
                    <button
                        type="button"
                        class="min-h-11 min-w-11 rounded border px-3"
                        :disabled="
                            loadingReferences || referencePage >= referencePagination.total_pages
                        "
                        @click="loadReferences(referencePage + 1)"
                    >
                        Next
                    </button>
                </div>
            </section>
        </div>

        <!-- DeepSeek Chat Tab -->
        <div v-if="activeTab === 'deepseek'">
            <h1 class="text-2xl font-bold mb-4">DeepSeek Chat Test</h1>

            <!-- Create Session -->
            <div class="mb-6 p-4 border border-gray-300 rounded">
                <h2 class="text-xl font-semibold mb-3">Create New Session</h2>
                <div class="flex gap-2">
                    <input
                        v-model="newSessionName"
                        type="text"
                        placeholder="Enter session name"
                        class="flex-1 px-3 py-2 border border-gray-300 rounded"
                    />
                    <button
                        :disabled="!newSessionName || creatingSession"
                        class="bg-primary text-white px-4 py-2 rounded disabled:opacity-50"
                        @click="createSession"
                    >
                        {{ creatingSession ? "Creating..." : "Create Session" }}
                    </button>
                </div>
            </div>

            <!-- Sessions List -->
            <div class="mb-6">
                <h2 class="text-xl font-semibold mb-3">Active Sessions</h2>
                <div v-if="sessions.length === 0" class="text-gray-500">No active sessions</div>
                <div
                    v-for="session in sessions"
                    :key="session.id"
                    class="mb-4 p-4 border border-gray-300 rounded"
                >
                    <div class="flex justify-between items-center mb-3">
                        <div>
                            <h3 class="font-semibold">{{ session.sessionName }}</h3>
                            <p class="text-sm text-gray-500">
                                ID: {{ session.id }} | Messages: {{ session.messages.length }}
                            </p>
                        </div>
                        <button
                            :disabled="deletingSessionId === session.id"
                            class="bg-red-500 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
                            @click="deleteSession(session.id)"
                        >
                            {{ deletingSessionId === session.id ? "Deleting..." : "Delete" }}
                        </button>
                    </div>

                    <!-- Chat Messages -->
                    <div
                        class="bg-gray-50 p-3 rounded mb-3 max-h-64 overflow-y-auto border border-gray-200"
                    >
                        <div v-if="session.messages.length === 0" class="text-gray-500 text-sm">
                            No messages yet
                        </div>
                        <div v-for="(msg, idx) in session.messages" :key="idx" class="mb-2">
                            <p
                                :class="
                                    msg.role === 'user'
                                        ? 'font-semibold text-blue-600'
                                        : 'text-gray-700'
                                "
                            >
                                {{ msg.role === "user" ? "You" : "Barron" }}:
                            </p>
                            <p class="text-sm text-gray-700 ml-2">{{ msg.content }}</p>
                        </div>
                    </div>

                    <!-- Send Message -->
                    <div class="flex gap-2">
                        <input
                            v-model="sessionMessages[session.id]"
                            type="text"
                            placeholder="Type a message... (yes i can read webpages and stuff, or ask me the time...)"
                            class="flex-1 px-3 py-2 border border-gray-300 rounded"
                            @keyup.enter="sendMessage(session.id)"
                        />
                        <USelectMenu v-model="roleValue" :items="roleValues" />
                        <button
                            :disabled="
                                !sessionMessages[session.id] || sendingSessionId === session.id
                            "
                            class="bg-blue-500 text-white px-4 py-2 rounded disabled:opacity-50"
                            @click="sendMessage(session.id)"
                        >
                            {{ sendingSessionId === session.id ? "Sending..." : "Send" }}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { NethackPermissions } from "~~/shared/permissions";

definePageMeta({
    middleware: ["auth"],
});

const { user: me } = await useApiUser();
const { can } = useNethackPermissions();
if (!can(NethackPermissions.all)) {
    throw await navigateTo("/");
}

// Tab management
const activeTab = ref<"upload" | "deepseek">("upload");

// File upload state
const file = ref<File | null>(null);
const uploading = ref(false);
const permalink = ref("");
const referenceId = ref("");
const releasingReferenceId = ref<string | null>(null);
const safePermalink = computed(() => safeUrl(permalink.value));
const error = ref("");
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

// DeepSeek state
const newSessionName = ref("");
const creatingSession = ref(false);
const sessions = ref<
    Array<{
        id: number;
        sessionName: string;
        createdAt: number;
        messages: Array<{ role: "user" | "assistant" | "tool"; content: string }>;
    }>
>([]);
const sessionMessages = ref<Record<number, string>>({});
const toolCallId = ref<string>("");
const sendingSessionId = ref<number | null>(null);
const deletingSessionId = ref<number | null>(null);

const roleValue = ref("user");
const roleValues = ref(["user", "tool"]);

// File upload functions
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
        error.value = err.message || "Unable to load file list";
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
        error.value = err.message || "Unable to load permalink references";
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
    error.value = "";
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
        error.value = err.message || "Upload failed";
    } finally {
        uploading.value = false;
    }
};

const releaseReference = async (id = referenceId.value) => {
    if (!id || releasingReferenceId.value) return;
    releasingReferenceId.value = id;
    error.value = "";
    try {
        await $fetch(`/api/assets/references/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (referenceId.value === id) {
            permalink.value = "";
            referenceId.value = "";
        }
        await refreshUploads(true);
    } catch (err: any) {
        error.value = err.message || "Unable to release this permalink";
    } finally {
        releasingReferenceId.value = null;
    }
};

onMounted(refreshUploads);

// DeepSeek functions
const createSession = async () => {
    if (!newSessionName.value) return;

    creatingSession.value = true;
    try {
        const session = await $fetch<{
            id: number;
            sessionName: string;
            createdAt: number;
            messages: Array<{ role: "user" | "assistant" | "tool"; content: string }>;
        }>("/api/debug/deepseek/sessions", {
            method: "POST",
            body: {
                sessionName: newSessionName.value,
            },
        });

        sessions.value.push(session);
        sessionMessages.value[session.id] = "";
        newSessionName.value = "";
    } catch (err: any) {
        error.value = `Failed to create session: ${err.message || "Unknown error"}`;
    } finally {
        creatingSession.value = false;
    }
};

const sendMessage = async (sessionId: number) => {
    const message = sessionMessages.value[sessionId];

    if (!message) return;

    sendingSessionId.value = sessionId;
    try {
        const response = await $fetch<{
            sessionId: number;
            userMessage: string;
            assistantMessage: string;
            allMessages: Array<{ role: "user" | "assistant" | "tool"; content: string }>;
        }>(`/api/debug/deepseek/sessions/${sessionId}/message`, {
            method: "POST",
            body: {
                message,
                role: roleValue.value,
                toolId: toolCallId.value,
            },
        });

        // Update session with new messages
        const sessionIndex = sessions.value.findIndex((s) => s.id === sessionId);
        if (sessionIndex != -1) {
            sessions.value[sessionIndex].messages = response.allMessages;
        }

        sessionMessages.value[sessionId] = "";
    } catch (err: any) {
        error.value = `Failed to send message: ${err.message || "Unknown error"}`;
        console.log(err.message);
    } finally {
        sendingSessionId.value = null;
    }
};

const deleteSession = async (sessionId: number) => {
    deletingSessionId.value = sessionId;
    try {
        await $fetch(`/api/debug/deepseek/sessions/${sessionId}`, {
            method: "DELETE",
        });

        sessions.value = sessions.value.filter((s) => s.id !== sessionId);
        delete sessionMessages.value[sessionId];
    } catch (err: any) {
        error.value = `Failed to delete session: ${err.message || "Unknown error"}`;
    } finally {
        deletingSessionId.value = null;
    }
};
</script>
