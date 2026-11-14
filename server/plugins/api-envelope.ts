import { APIResponse } from "@basis/schema/api";

const isJsonApiResponse = (event: any, body: unknown) => {
    if (!event.path?.startsWith("/api/") || body === undefined || body === null) return false;
    if (body instanceof Response || typeof body !== "object") return false;
    return !ArrayBuffer.isView(body) && !(body instanceof ArrayBuffer);
};

export default defineNitroPlugin((nitroApp) => {
    nitroApp.hooks.hook("beforeResponse", (event, response) => {
        if (!isJsonApiResponse(event, response.body)) return;
        const body = response.body;
        if (
            body &&
            typeof body === "object" &&
            !Array.isArray(body) &&
            "status" in body &&
            "code" in body &&
            ("data" in body || "error" in body)
        ) {
            return;
        }

        const status = event.node.res.statusCode || 200;
        response.body = new APIResponse({ data: response.body }, status).toJSON();
    });
});
