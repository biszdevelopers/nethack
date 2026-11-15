import { getRouterParam } from "h3";
import { serveProtectedDocsFile } from "~~/server/utils/protected-docs";

export default defineEventHandler(async (event) => {
    return serveProtectedDocsFile(event, getRouterParam(event, "path") ?? "");
});
