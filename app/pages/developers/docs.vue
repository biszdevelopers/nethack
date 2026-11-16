<script setup lang="ts">
definePageMeta({
    layout: "developers-dashboard",
    middleware: ["auth"],
});

useHead({ title: `Documentation | ${WEBSITE_NAME}` });
</script>

<template>
    <UDashboardPanel id="developers-docs" :ui="{ body: 'flex-1 min-h-0 overflow-hidden p-0' }">
        <template #header>
            <UDashboardNavbar title="Documentation">
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
                <template #right>
                    <UButton
                        href="/docs/"
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="outline"
                        icon="i-lucide-external-link"
                        class="min-h-11"
                        aria-label="Open documentation in a new tab"
                    >
                        <span class="hidden sm:inline">Open in new tab</span>
                    </UButton>
                </template>
            </UDashboardNavbar>
        </template>

        <template #body>
            <iframe
                src="/docs/"
                title="nethack documentation"
                class="min-h-[70svh] w-full flex-1 border-0 bg-default"
            />
        </template>
    </UDashboardPanel>
</template>
