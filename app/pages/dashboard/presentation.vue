<template>
    <div>
        <h1 class="text-4xl font-bold glow">Presentation!</h1>
        <p class="mt-8">
            <span class="text-primary">{{ WEBSITE_NAME }}</span>
            events include an additional presentation stage.
        </p>
        <p class="mt-8">
            Teams scoring top 10 will be invited to present their projects in front of judges and
            students!
        </p>
        <USeparator class="mt-8" size="sm" />
        <p class="mt-8 text-muted">Presentation is currently under development! Stay tuned</p>
    </div>
</template>

<script lang="ts" setup>
definePageMeta({
    layout: "dashboard",
    middleware: "auth",
});
</script>
