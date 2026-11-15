import { getRouterParam, setHeader } from "h3";
import { readProtectedDocsFile } from "~~/server/utils/protected-docs";

export default defineEventHandler(async (event) => {
    const { body, contentType } = await readProtectedDocsFile(
        event,
        getRouterParam(event, "path") ?? "",
    );
    setHeader(event, "Content-Type", contentType);
    setHeader(event, "Cache-Control", "private, no-store");
    setHeader(event, "X-Content-Type-Options", "nosniff");
    return body;
});
