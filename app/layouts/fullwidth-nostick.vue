<template>
    <div>
        <a
            href="#main-content"
            class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:min-h-11 focus:rounded-md focus:bg-primary focus:px-4 focus:py-3 focus:text-inverted focus:shadow-lg"
        >
            Skip to main content
        </a>
        <RoleHeader class="relative" />

        <UMain id="main-content" tabindex="-1">
            <slot />
        </UMain>

        <Footer />
    </div>
</template>
