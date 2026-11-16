<template>
    <Transition name="fade">
        <UButton
            v-if="isVisible"
            class="z-999 fixed bottom-4 right-4"
            icon="i-lucide-arrow-up"
            aria-label="Back to top"
            @click="scrollToTop"
        />
    </Transition>
</template>

<script setup>
const isVisible = ref(false);

const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
};

const handleScroll = () => {
    isVisible.value = window.scrollY > window.innerHeight;
};

onMounted(() => {
    window.addEventListener("scroll", handleScroll);
});

onUnmounted(() => {
    window.removeEventListener("scroll", handleScroll);
});
</script>

<style scoped>
.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}

.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.4s ease;
}
</style>
