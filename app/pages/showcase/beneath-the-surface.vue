<script setup lang="ts">
definePageMeta({
    layout: "fullwidth-nostick",
    title: `Beneath the Surface | ${WEBSITE_NAME}`,
});

useHead(
    pageSeo({
        title: `Beneath the Surface | ${WEBSITE_NAME}`,
        description: "The featured Beneath the Surface showcase from the BIBS-C Network Hackathon.",
        path: "/showcase/beneath-the-surface",
    }),
);
</script>

<template>
    <ShowcaseBeneathTheSurface />
</template>
