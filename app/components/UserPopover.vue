<template>
    <UPopover mode="hover" @update:open="handleHover">
        <slot />

        <template #content>
            <div class="min-w-[200px] overflow-hidden">
                <template v-if="pending">
                    <USkeleton class="w-full h-16 rounded-none" />
                    <div class="flex items-center gap-3 p-3">
                        <USkeleton class="w-10 h-10 rounded-full shrink-0" />
                        <div class="space-y-1.5 flex-1">
                            <USkeleton class="w-24 h-4 rounded" />
                            <USkeleton class="w-16 h-3 rounded" />
                        </div>
                    </div>
                </template>

                <template v-else-if="hoveredUser">
                    <div
                        v-if="backgroundUrl"
                        class="h-24 w-full bg-cover bg-center rounded-t"
                        :style="{
                            backgroundImage: `url(${backgroundUrl})`,
                        }"
                    />
                    <div class="flex items-center gap-3 p-3">
                        <UserAvatar :user="hoveredUser" size="md" />
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-1.5">
                                <p class="text-sm font-medium truncate">
                                    {{ hoveredUser?.name || hoveredUser?.email || "Unknown" }}
                                </p>
                                <UTooltip
                                    v-if="external"
                                    :text="`Not registered in ${WEBSITE_NAME}`"
                                    :delay-duration="0"
                                >
                                    <UIcon
                                        name="i-lucide-user-x"
                                        class="text-yellow-500 shrink-0"
                                        size="1em"
                                    />
                                </UTooltip>
                            </div>
                            <div v-if="hoveredUser?.email" class="flex items-center gap-1.5">
                                <p class="text-xs text-muted truncate">
                                    {{ hoveredUser.email }}
                                </p>
                                <button
                                    class="inline-flex items-center justify-center rounded p-0.5 transition-colors hover:bg-neutral-800"
                                    aria-label="Copy email"
                                    @click="copyEmail(hoveredUser.email)"
                                >
                                    <div class="relative h-4 w-4">
                                        <UIcon
                                            name="i-lucide-copy"
                                            class="absolute inset-0 text-neutral-400 transition-opacity duration-150"
                                            :class="copied ? 'opacity-0' : 'opacity-100'"
                                        />
                                        <UIcon
                                            name="i-lucide-check"
                                            class="absolute inset-0 text-green-500 transition-opacity duration-150"
                                            :class="copied ? 'opacity-100' : 'opacity-0'"
                                        />
                                    </div>
                                </button>
                            </div>
                        </div>
                    </div>
                    <template v-if="hoveredUser?.email">
                        <USeparator />
                        <div class="p-2">
                            <UButton
                                color="neutral"
                                variant="ghost"
                                :to="`https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(hoveredUser.email)}`"
                                target="_blank"
                                class="w-full justify-start gap-2"
                                aria-label="Chat on Teams"
                            >
                                <TeamsIcon class="w-5 h-5" />
                                <span class="text-sm">Chat on Teams</span>
                            </UButton>
                        </div>
                    </template>
                </template>
            </div>
        </template>
    </UPopover>
</template>

<script setup lang="ts">
import { WEBSITE_NAME } from "~/utils/consts";

const props = defineProps<{
    user: number | APIUser;
    external?: boolean;
}>();

const hasHovered = ref(false);
const hoveredUser = ref<APIUser | null>(null);
const backgroundUrl = computed(() => getProfileThemeUrl(hoveredUser.value?.profile_theme));
const pending = ref(false);
const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

const handleHover = async (isOpen: boolean) => {
    if (!isOpen || hasHovered.value) return;
    hasHovered.value = true;

    pending.value = true;
    try {
        if (typeof props.user === "number") {
            hoveredUser.value = await $fetch<APIUser>(`/api/users/${props.user}`);
        } else {
            hoveredUser.value = props.user;
        }
    } catch (e) {
        console.error("Failed to fetch user:", e);
    } finally {
        pending.value = false;
    }
};

async function copyEmail(email: string) {
    let ok = false;
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(email);
            ok = true;
        } else {
            const textarea = document.createElement("textarea");
            textarea.value = email;
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.select();
            try {
                ok = document.execCommand("copy");
            } catch (err) {
                console.error("execCommand copy failed:", err);
            }
            document.body.removeChild(textarea);
        }
    } catch (e) {
        console.error("Failed to copy email:", e);
    }

    if (!ok) return;

    copied.value = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
        copied.value = false;
    }, 1500);
}
</script>
