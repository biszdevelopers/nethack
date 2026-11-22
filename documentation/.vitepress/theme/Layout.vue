<script setup lang="ts">
import { onMounted, ref } from "vue";
import DefaultTheme from "vitepress/theme";

const { Layout } = DefaultTheme;

// The same docs build runs standalone and inside the admin portal iframe.
// Detect the frame so the return action goes to the portal when embedded and
// to the public home page when opened directly. `target="_top"` then leaves
// the frame instead of loading a frame-denied app route inside it.
const embedded = ref(false);
onMounted(() => {
    embedded.value = window.self !== window.top;
    if (embedded.value) document.documentElement.classList.add("bh-embedded");
});
</script>

<template>
    <Layout :class="{ 'bh-embedded': embedded }">
        <template #nav-bar-content-after>
            <a
                class="vp-portal-return"
                :href="embedded ? '/developers' : '/'"
                target="_top"
                rel="noopener"
            >
                <span aria-hidden="true">←</span>
                {{ embedded ? "Portal" : "Home" }}
            </a>
        </template>
        <template #nav-screen-content-before>
            <a
                class="vp-portal-return vp-portal-return-mobile"
                :href="embedded ? '/developers' : '/'"
                target="_top"
                rel="noopener"
            >
                <span aria-hidden="true">←</span>
                {{ embedded ? "Back to portal" : "Back to home" }}
            </a>
        </template>
    </Layout>
</template>
