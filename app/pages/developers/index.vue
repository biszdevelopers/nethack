<script setup lang="ts">
definePageMeta({
    layout: "developers-dashboard",
    middleware: ["auth"],
});
</script>

<template>
    <UDashboardPanel id="developers-home">
        <template #header>
            <UDashboardNavbar title="Mod Portal">
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
            </UDashboardNavbar>
        </template>

        <template #body>
            <div class="p-6">
                <h1 class="text-2xl bold">Welcome back!</h1>
                <br />
                <p>
                    This is the official portal of the
                    <span class="text-primary">{{ WEBSITE_NAME }} mod portal</span>
                    .
                </p>
            </div>
        </template>
    </UDashboardPanel>
</template>
