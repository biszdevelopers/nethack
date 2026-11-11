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
            </div>
            <div v-if="error" class="mt-4 text-red-500">Error: {{ error }}</div>

            <section class="mt-8">
                <div class="flex items-center justify-between mb-4">
                    <h2 class="text-2xl font-bold">Uploaded Asset Files</h2>
                    <button
                        type="button"
                        class="bg-secondary text-white px-3 py-2 rounded"
                        @click="loadFiles"
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
const safePermalink = computed(() => safeUrl(permalink.value));
const error = ref("");
const loadingFiles = ref(false);
const fileLists = ref({
    assets: [] as Array<{ name: string; url: string }>,
    userast: [] as Array<{ name: string; url: string }>,
});

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

const handleFileChange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    file.value = target.files?.[0] || null;
};

const uploadFile = async () => {
    if (!file.value) return;

    uploading.value = true;
    error.value = "";
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
        error.value = err.message || "Upload failed";
    } finally {
        uploading.value = false;
    }
};

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

onMounted(loadFiles);
</script>
