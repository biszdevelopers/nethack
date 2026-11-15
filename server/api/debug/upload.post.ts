export default defineEventHandler(() => {
    throw createError({ statusCode: 410, statusMessage: "Debug uploads have been removed" });
});
