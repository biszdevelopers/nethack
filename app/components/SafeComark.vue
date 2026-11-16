<script setup lang="ts">
import type { VNode } from "vue";
import breaks from "comark/plugins/breaks";
import SafeLink from "~/components/SafeLink.vue";

const safeComponents = { a: SafeLink };
// Event text is user-authored: keep raw HTML out of the render tree while
// preserving single newlines the way the submission form collected them.
const safeOptions = { registerDefaultPlugins: false };
const safePlugins = [breaks()];
const slots = useSlots();

const getNodeText = (node: VNode | string): string => {
    if (typeof node === "string") return node;
    if (typeof node.children === "string") return node.children;
    if (Array.isArray(node.children)) {
        return node.children.map((child) => getNodeText(child as VNode | string)).join("");
    }
    return "";
};

const markdown = computed(() => (slots.default?.() ?? []).map(getNodeText).join(""));
</script>

<template>
    <Markdown
        :value="markdown"
        :options="safeOptions"
        :plugins="safePlugins"
        :components="safeComponents"
    />
</template>
