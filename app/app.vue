<template>
    <UApp>
        <NuxtLoadingIndicator />
        <NuxtLayout>
            <NuxtPage />
        </NuxtLayout>
    </UApp>
</template>

<script setup lang="ts">
const runtimeConfig = useRuntimeConfig();
const requestUrl = useRequestURL();
const canonicalUrl = computed(() => {
    const origin = runtimeConfig.public.siteOrigin;
    return origin ? new URL(requestUrl.pathname, origin).toString() : undefined;
});

useHead({
    htmlAttrs: { lang: "en" },
    meta: [{ property: "og:site_name", content: WEBSITE_NAME }],
    link: [
        { rel: "canonical", href: canonicalUrl },
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
