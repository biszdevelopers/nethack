<script setup lang="ts">
import type { VNode } from "vue";
import SafeLink from "~/components/SafeLink.vue";

const safeComponents = { a: SafeLink };
const safeOptions = { html: false };
const slots = useSlots();

const getNodeText = (node: VNode): string => {
    if (typeof node.children === "string") return node.children;
    if (Array.isArray(node.children)) {
        return node.children.map((child) => getNodeText(child as VNode)).join("");
    }
    return "";
};

const markdown = computed(() => (slots.default?.() ?? []).map(getNodeText).join(""));
</script>

<template>
    <Comark :markdown="markdown" :options="safeOptions" :components="safeComponents" />
</template>
