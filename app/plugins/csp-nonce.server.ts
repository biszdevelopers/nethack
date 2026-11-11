export default defineNuxtPlugin(() => {
    const nonce = useRequestEvent()?.context.cspNonce;
    if (!nonce) return;

    // Nuxt reads this nonce during SSR and propagates it to streamed hydration scripts.
    useHead({ script: [{ nonce, innerHTML: "/* Per-response CSP nonce marker. */" }] });
});
