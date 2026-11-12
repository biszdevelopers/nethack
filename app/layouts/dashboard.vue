<script setup lang="ts">
import type { NavigationMenuItem } from "@nuxt/ui";

const { data: hackathon, error: hackathonError } = await useFetch("/api/seasons/active");
if (hackathonError.value) {
    throw hackathonError.value;
}

const items = ref<NavigationMenuItem[][]>([
    [
        {
            label: "Dashboard",
            type: "label",
        },

        {
            label: "Overview",
            icon: "i-lucide-info",
            to: "/dashboard",
        },
        {
            label: "Team",
            icon: "i-fluent-people-team-16-filled",
            to: "/dashboard/teams",
        },

        {
            label: "General",
            icon: "i-lucide-file-text",
            to: "/dashboard/general",
        },

        // {
        //       label: 'Presentation',
        //       icon: 'i-lucide-presentation',
        //       to: '/dashboard/presentation',
        //       chip: true
        // },
    ],
    [
        {
            label: "Results",
            icon: "i-lucide-trophy",
            to: "/dashboard/results",
        },
    ],
    [
        {
            label: "Help",
            icon: "i-lucide-circle-question-mark",
            to: "https://teams.microsoft.com/l/channel/19%3Ae352153b90524d81b9f9b50c7dd84d12%40thread.tacv2/QnA?groupId=b207a655-d801-4200-8345-5dcc50d6d957&tenantId=cbc6e1e2-a6bb-4002-bbdc-6da892a051a7",
            target: "_blank",
        },
    ],
]);
</script>

<template>
    <!-- <div class="flex flex-row items-start justify-start">
    <UNavigationMenu class="pl-16 pr-4 border-r border-default h-full h-100vh" orientation="vertical" :items="items" />
    <div class="bg-white-100 p-64"></div>
  </div> -->

    <a
        href="#main-content"
        class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:min-h-11 focus:rounded-md focus:bg-primary focus:px-4 focus:py-3 focus:text-inverted focus:shadow-lg"
    >
        Skip to main content
    </a>
    <RoleHeader />
    <UMain id="main-content" tabindex="-1">
        <UContainer class="flex flex-col lg:flex-row max-w-none gap-8 mt-12">
            <aside class="hidden lg:block lg:w-64 shrink-0">
                <UCard>
                    <template #header>
                        <span
                            v-if="hackathon?.status == 'in_progress'"
                            class="uppercase text-sm font-bold text-muted"
                        >
                            ongoing
                        </span>
                        <span v-else class="uppercase text-sm font-bold text-muted">completed</span>
                        <h3 class="text-2xl bold glow">
                            {{ hackathon?.theme_name || "Hackathon" }}
                        </h3>
                        <span class="">{{ hackathon?.theme_description || "" }}</span>
                        <USeparator class="my-4" size="sm" />
                    </template>
                </UCard>
                <UNavigationMenu
                    orientation="vertical"
                    :items="items"
                    class="data-[orientation=vertical]:w-full mt-8"
                />
            </aside>

            <nav
                class="lg:hidden flex gap-1 overflow-x-auto pb-2 -mx-4 px-4"
                aria-label="Mobile navigation"
            >
                <template v-for="group in items" :key="group">
                    <template v-for="item in group" :key="item.label">
                        <UBadge
                            v-if="item.to && item.type !== 'label'"
                            variant="subtle"
                            color="neutral"
                            class="whitespace-nowrap shrink-0"
                        >
                            <NuxtLink
                                :to="item.to"
                                class="flex min-h-11 items-center gap-2 px-3 py-2 no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                            >
                                <UIcon v-if="item.icon" :name="item.icon" class="w-4 h-4" />
                                {{ item.label }}
                            </NuxtLink>
                        </UBadge>
                    </template>
                </template>
            </nav>

            <div class="w-full min-w-0">
                <UBanner
                    id="hoverdashnotif"
                    color="neutral"
                    class="z-0 my-4 nopanel text-xs text-muted rounded-md show-small"
                    title="You can also hover or expand the dashboard tab to see more options"
                    close
                />

                <slot />
            </div>
        </UContainer>
    </UMain>
    <Footer />
</template>

<style scoped>
.metallic-gold {
    background: linear-gradient(
        135deg,
        #ffd700 0%,
        #ffa500 25%,
        #ffd700 50%,
        #ffa500 75%,
        #ffd700 100%
    );
    background-size: 200% 200%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    text-shadow: none;
    animation: shimmer 3s ease-in-out infinite;
}

.metallic-silver {
    background: linear-gradient(
        135deg,
        #e8e8e8 0%,
        #c0c0c0 25%,
        #e8e8e8 50%,
        #c0c0c0 75%,
        #e8e8e8 100%
    );
    background-size: 200% 200%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    text-shadow: none;
    animation: shimmer 3s ease-in-out infinite;
}

.metallic-bronze {
    background: linear-gradient(
        135deg,
        #cd7f32 0%,
        #b87333 25%,
        #df9953 50%,
        #b87333 75%,
        #cd7f32 100%
    );
    background-size: 200% 200%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    text-shadow: none;
    animation: shimmer 3s ease-in-out infinite;
}

@keyframes shimmer {
    0% {
        background-position: 0% 50%;
    }
    50% {
        background-position: 50% 100%;
    }
    100% {
        background-position: 0% 50%;
    }
}

.hide-small {
    @media (width < 1800px) {
        display: none;
    }
}

.show-small {
    @media (width >= 1800px) {
        display: none;
    }
}
</style>
