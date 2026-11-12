<template>
    <div>
        <a
            href="#main-content"
            class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:min-h-11 focus:rounded-md focus:bg-primary focus:px-4 focus:py-3 focus:text-inverted focus:shadow-lg"
        >
            Skip to main content
        </a>
        <RoleHeader />

        <UMain id="main-content" tabindex="-1">
            <div class="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
                <slot />
            </div>
        </UMain>

        <Footer />
    </div>
</template>
