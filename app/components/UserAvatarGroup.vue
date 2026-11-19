<script setup lang="ts">
defineProps<{
    users: Array<
        | {
              id?: number;
              name?: string | null;
              email?: string;
              profile_picture?: string | null;
          }
        | null
        | undefined
    >;
    size?: "3xs" | "2xs" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";
    max?: number | string;
    ui?: any;
    developerMode?: boolean;
}>();
</script>

<template>
    <UPopover mode="click" class="w-fit">
        <button
            type="button"
            class="w-fit rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            aria-label="View team members"
        >
            <UAvatarGroup :size="size" :max="max" :ui="ui">
                <UserAvatar v-for="(user, index) in users" :key="index" :user="user" :size="size" />
            </UAvatarGroup>
        </button>

        <template #content>
            <div class="max-h-48 overflow-y-auto p-2 space-y-1 min-w-[200px]">
                <div
                    v-for="(user, index) in users"
                    :key="index"
                    class="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-elevated/50"
                >
                    <UserItem :user="user" size="sm" />
                    <span
                        v-if="developerMode && user?.id != null"
                        class="text-xs text-muted font-mono"
                    >
                        &lt;{{ user.id }}&gt;
                    </span>
                </div>
            </div>
        </template>
    </UPopover>
</template>
