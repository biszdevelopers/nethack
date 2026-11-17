export default defineNuxtPlugin(() => {
    const configuredOrigin = process.env.CURRENT_URL_ORIGIN;
    if (configuredOrigin) useRuntimeConfig().public.siteOrigin = configuredOrigin;
});
