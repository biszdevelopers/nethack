<template>
    <UApp>
        <NuxtLoadingIndicator />
        <NuxtLayout>
            <NuxtPage />
        </NuxtLayout>
    </UApp>
</template>

<script setup lang="ts">
useHead({
    htmlAttrs: { lang: "en" },
    link: [
        {
            rel: "preload",
            href: "/fonts/Monaspace-Neon.woff2",
            as: "font",
            type: "font/woff2",
            crossorigin: "anonymous",
        },
    ],
});
</script>
