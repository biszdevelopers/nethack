/** Load the browser-safe session once so public pages render signed-in state too. */
export default defineNuxtPlugin(async () => {
    const session = useBasisAuthSession();
    if (!session.ready.value) await session.refresh();
});
