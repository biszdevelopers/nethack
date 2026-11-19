<script setup lang="ts">
import { apiFetch } from "~~/app/composables/useApiFetch";
import { onMounted } from "vue";
definePageMeta({
    layout: "developers-dashboard",
    middleware: ["auth"],
});

useHead({ title: `DeepSeek | ${WEBSITE_NAME}` });

const toast = useToast();

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
const sendingSessionId = ref<number | null>(null);
const deletingSessionId = ref<number | null>(null);

const sessionRoles = ref<Record<number, string>>({});
const sessionToolCallIds = ref<Record<number, string>>({});
const roleValues = ref(["user", "tool_result"]);

onMounted(async () => {
    try {
        sessions.value = await apiFetch("/api/debug/deepseek/sessions");
        for (const session of sessions.value) {
            sessionRoles.value[session.id] ??= "user";
        }
    } catch {
        // Debug routes may be disabled in this environment.
    }
});

const createSession = async () => {
    if (!newSessionName.value) return;

    creatingSession.value = true;
    try {
        const session = await apiFetch<{
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
        sessionRoles.value[session.id] = "user";
        newSessionName.value = "";

        toast.add({
            title: "Session created",
            description: `"${session.sessionName}" is ready.`,
            color: "success",
        });
    } catch (err: any) {
        toast.add({
            title: "Error",
            description: err.message || "Failed to create session",
            color: "error",
        });
    } finally {
        creatingSession.value = false;
    }
};

const sendMessage = async (sessionId: number) => {
    const message = sessionMessages.value[sessionId];
    if (!message) return;

    sendingSessionId.value = sessionId;
    try {
        const response = await apiFetch<{
            sessionId: number;
            userMessage: string;
            assistantMessage: string;
            allMessages: Array<{ role: "user" | "assistant" | "tool"; content: string }>;
        }>(`/api/debug/deepseek/sessions/${sessionId}/message`, {
            method: "POST",
            body: {
                message,
                role: sessionRoles.value[sessionId] ?? "user",
                toolCallId: sessionToolCallIds.value[sessionId] ?? "",
            },
        });

        const sessionIndex = sessions.value.findIndex((s) => s.id === sessionId);
        if (sessionIndex != -1) {
            sessions.value[sessionIndex]!.messages = response.allMessages;
        }

        sessionMessages.value[sessionId] = "";
    } catch (err: any) {
        toast.add({
            title: "Error",
            description: err.message || "Failed to send message",
            color: "error",
        });
    } finally {
        sendingSessionId.value = null;
    }
};

const deleteSession = async (sessionId: number) => {
    deletingSessionId.value = sessionId;
    try {
        await apiFetch(`/api/debug/deepseek/sessions/${sessionId}`, {
            method: "DELETE",
        });

        sessions.value = sessions.value.filter((s) => s.id !== sessionId);
        Reflect.deleteProperty(sessionMessages.value, sessionId);

        toast.add({
            title: "Session deleted",
            color: "success",
        });
    } catch (err: any) {
        toast.add({
            title: "Error",
            description: err.message || "Failed to delete session",
            color: "error",
        });
    } finally {
        deletingSessionId.value = null;
    }
};
</script>

<template>
    <UDashboardPanel id="deepseek">
        <template #header>
            <UDashboardNavbar title="DeepSeek Chat">
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
            </UDashboardNavbar>
        </template>

        <template #body>
            <UCard>
                <template #header>
                    <h2 class="text-lg font-semibold">Create New Session</h2>
                </template>

                <div class="flex gap-2">
                    <UInput
                        v-model="newSessionName"
                        placeholder="Enter session name"
                        class="flex-1"
                    />
                    <UButton
                        label="Create Session"
                        :loading="creatingSession"
                        :disabled="!newSessionName || creatingSession"
                        @click="createSession"
                    />
                </div>
            </UCard>

            <div class="mt-6 space-y-4">
                <h2 class="text-lg font-semibold">Active Sessions</h2>
                <div v-if="sessions.length === 0" class="text-muted">No active sessions</div>

                <UCard v-for="session in sessions" :key="session.id">
                    <template #header>
                        <div class="flex justify-between items-center">
                            <div>
                                <h3 class="font-semibold">{{ session.sessionName }}</h3>
                                <p class="text-sm text-muted">
                                    ID: {{ session.id }} | Messages: {{ session.messages.length }}
                                </p>
                            </div>
                            <UButton
                                color="error"
                                variant="ghost"
                                size="sm"
                                icon="i-lucide-trash"
                                :aria-label="`Delete session ${session.id}`"
                                :loading="deletingSessionId === session.id"
                                @click="deleteSession(session.id)"
                            />
                        </div>
                    </template>

                    <div
                        class="bg-elevated/50 p-3 rounded-lg mb-3 max-h-64 overflow-y-auto border border-default"
                    >
                        <div v-if="session.messages.length === 0" class="text-muted text-sm">
                            No messages yet
                        </div>
                        <div v-for="(msg, idx) in session.messages" :key="idx" class="mb-2">
                            <p
                                :class="
                                    msg.role === 'user'
                                        ? 'font-semibold text-primary'
                                        : 'text-highlighted'
                                "
                            >
                                {{ msg.role === "user" ? "You" : "Barron" }}:
                            </p>
                            <p class="text-sm text-muted ml-2">{{ msg.content }}</p>
                        </div>
                    </div>

                    <div class="flex gap-2">
                        <UInput
                            v-model="sessionMessages[session.id]"
                            placeholder="Type a message..."
                            class="flex-1"
                            @keyup.enter="sendMessage(session.id)"
                        />
                        <USelectMenu v-model="sessionRoles[session.id]" :items="roleValues" />
                        <UInput
                            v-if="sessionRoles[session.id] === 'tool_result'"
                            v-model="sessionToolCallIds[session.id]"
                            placeholder="Tool call ID"
                            class="w-40"
                        />
                        <UButton
                            label="Send"
                            :loading="sendingSessionId === session.id"
                            :disabled="
                                !sessionMessages[session.id] || sendingSessionId === session.id
                            "
                            @click="sendMessage(session.id)"
                        />
                    </div>
                </UCard>
            </div>
        </template>
    </UDashboardPanel>
</template>
