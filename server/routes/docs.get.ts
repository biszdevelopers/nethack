import { serveProtectedDocsFile } from "~~/server/utils/protected-docs";

export default defineEventHandler(async (event) => {
    return serveProtectedDocsFile(event, "");
});
