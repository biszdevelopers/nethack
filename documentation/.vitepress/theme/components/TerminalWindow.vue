<script setup lang="ts">
interface Props {
    title?: string;
    prompt?: string;
}

withDefaults(defineProps<Props>(), {
    title: "nethack@docs:~",
    prompt: "$",
});
</script>

<template>
    <div class="vp-terminal-window">
        <div class="vp-terminal-titlebar">
            <div class="vp-terminal-dots">
                <span style="background: #ff5f57"></span>
                <span style="background: #febc2e"></span>
                <span style="background: #28c840"></span>
            </div>
            <span class="vp-terminal-title">{{ title }}</span>
        </div>
        <div class="vp-terminal-body">
            <div class="vp-terminal-prompt">
                <span class="t-user">nethack</span>
                <span class="t-at">@</span>
                <span class="t-host">docs</span>
                <span class="t-colon">:</span>
                <span class="t-path">~</span>
                <span class="t-dollar">{{ prompt }}</span>
            </div>
            <slot />
        </div>
    </div>
</template>
