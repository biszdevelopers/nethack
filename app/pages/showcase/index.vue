<script setup lang="ts">
definePageMeta({
    layout: "fullwidth-nostick",
});

useHead({
    title: `Showcase | ${WEBSITE_NAME}`,
    meta: [
        {
            name: "description",
            content: "Explore the winning projects and season showcases from basishacks.",
        },
    ],
});
</script>

<template>
    <main class="showcase-index bg-[#05080d] text-white">
        <section class="featured-showcase relative isolate min-h-[82vh] overflow-hidden">
            <div class="featured-grid absolute inset-0" aria-hidden="true" />
            <div class="featured-glow absolute inset-0" aria-hidden="true" />

            <div
                class="relative z-10 mx-auto flex min-h-[82vh] max-w-7xl flex-col justify-end px-6 py-16 sm:px-10 lg:px-16 lg:py-24"
            >
                <div class="mb-auto flex items-center justify-between gap-4 pt-4">
                </div>

                <div class="max-w-4xl">
                    <h1
                        class="featured-title text-5xl leading-[0.92] font-black tracking-[-0.055em] sm:text-7xl lg:text-[7.5rem]"
                    >
                        Beneath
                        <br />
                        the Surface
                    </h1>
                    <p class="mt-8 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                        Descend through six project worlds shaped by hidden systems, unseen layers,
                        and signals waiting below the surface.
                    </p>

                    <UButton
                        to="/showcase/beneath-the-surface"
                        size="xl"
                        color="primary"
                        trailing-icon="i-lucide-arrow-up-right"
                        class="mt-9"
                    >
                        Enter the featured showcase
                    </UButton>
                </div>
            </div>
        </section>

        <section
            class="border-t border-white/10 bg-[#090909] px-6 py-20 sm:px-10 lg:px-16 lg:py-28"
        >
            <div class="mx-auto max-w-7xl">
                <div class="mb-10 flex flex-wrap items-end justify-between gap-5">
                    <div>
                        <p class="font-mono text-xs tracking-[0.28em] text-red-300 uppercase">
                            Previous season
                        </p>
                        <h2 class="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">
                            From the archive
                        </h2>
                    </div>
                    <p class="max-w-md text-sm leading-6 text-white/55 sm:text-base">
                        Revisit the projects that broke through the noise and made themselves heard.
                    </p>
                </div>

                <NuxtLink
                    to="/showcase/signal"
                    class="signal-card group relative block min-h-[30rem] overflow-hidden border border-white/10 bg-black sm:min-h-[36rem]"
                >
                    <div
                        class="signal-image absolute inset-0 transition duration-700 group-hover:scale-105"
                    />
                    <div class="signal-overlay absolute inset-0" />

                    <div
                        class="relative z-10 flex min-h-[30rem] flex-col justify-between p-7 sm:min-h-[36rem] sm:p-11 lg:p-14"
                    >
                        <div class="flex items-center justify-between gap-4">
                            <span class="text-xs tracking-[0.24em] text-white/60 uppercase">
                                February 2026
                            </span>
                            <UIcon
                                name="i-lucide-arrow-up-right"
                                class="size-7 transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-1"
                            />
                        </div>

                        <div>
                            <p class="mb-3 text-lg text-white/70">When there is</p>
                            <h3
                                class="signal-title text-6xl font-black uppercase sm:text-8xl lg:text-9xl"
                            >
                                Signal
                            </h3>
                            <p class="mt-6 max-w-xl text-sm leading-6 text-white/65 sm:text-base">
                                Explore the previous season's winners and the complete project
                                archive in its original interactive showcase.
                            </p>
                        </div>
                    </div>
                </NuxtLink>
            </div>
        </section>
    </main>
</template>

<style scoped>
.featured-showcase {
    background:
        radial-gradient(circle at 72% 20%, rgba(0, 217, 255, 0.14), transparent 34%),
        linear-gradient(145deg, #08111b 0%, #05080d 48%, #020304 100%);
}

.featured-grid {
    background-image:
        linear-gradient(rgba(87, 220, 255, 0.07) 1px, transparent 1px),
        linear-gradient(90deg, rgba(87, 220, 255, 0.07) 1px, transparent 1px);
    background-size: 64px 64px;
    mask-image: linear-gradient(to bottom, black, transparent 88%);
}

.featured-glow {
    background: linear-gradient(
        115deg,
        transparent 42%,
        rgba(79, 225, 255, 0.08) 50%,
        transparent 58%
    );
}

.featured-title {
    font-family: "Unbounded", sans-serif;
    text-shadow: 0 0 48px rgba(56, 217, 255, 0.18);
}

.signal-image {
    background-image: url("/assets/c6c7b5b3-4256-4f9d-9899-15a7905a154c");
    background-position: center;
    background-size: cover;
}

.signal-overlay {
    background: linear-gradient(
        90deg,
        rgba(0, 0, 0, 0.94) 0%,
        rgba(0, 0, 0, 0.7) 48%,
        rgba(0, 0, 0, 0.22) 100%
    );
}

.signal-title {
    color: #41ff73;
    text-shadow:
        0 0 12px rgba(65, 255, 115, 0.7),
        0 0 40px rgba(65, 255, 115, 0.38);
}

@media (prefers-reduced-motion: reduce) {
    .signal-image,
    .signal-card :deep(*) {
        transition: none !important;
    }
}
</style>
