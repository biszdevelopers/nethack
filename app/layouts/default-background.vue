<template>
    <div>
        <RoleHeader />

        <UMain class="bg-red-100">
            <div class="mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-8">
                <slot />
            </div>
        </UMain>

        <Footer />
    </div>
</template>
