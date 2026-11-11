import { getMicrosoftWebhookState } from "~~/server/plugins/microsoft";
import { readLimitedJsonBody } from "~~/server/utils/limited-json-body";
import { hasValidMicrosoftWebhookState } from "~~/server/utils/microsoft-webhook-security";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

const MAX_WEBHOOK_REQUEST_BYTES = 64 * 1024;

export default defineEventHandler(
    applyRateLimit(async (event) => {
        // Microsoft Graph sends a validation token as a query parameter during subscription creation/renewal.
        // The endpoint MUST respond with 200 OK and echo the token as text/plain.
        const query = getQuery(event);
        const validationToken = query.validationToken as string | undefined;
        if (validationToken) {
            setResponseHeader(event, "Content-Type", "text/plain; charset=utf-8");
            setResponseStatus(event, 200);
            return validationToken;
        }

        const body = (await readLimitedJsonBody(event, MAX_WEBHOOK_REQUEST_BYTES)) as {
            value?: unknown;
        } | null;

        const value = body?.value;
        if (value == null || !Array.isArray(value) || value.length == 0) {
            console.warn("[MS Graph] Invalid MS Webhook Update");
            return createError({
                statusCode: 400,
                message: "Bad Request",
            });
        }

        if (!hasValidMicrosoftWebhookState(value, getMicrosoftWebhookState())) {
            console.warn("[MS Graph] Rejected webhook notification with invalid client state");
            throw createError({
                statusCode: 403,
                message: "Forbidden",
            });
        }

        const changeType = value[0].changeType;
        const resource = value[0].resource;

        console.log("[MS Graph] Webhook update received:", changeType, resource);

        setResponseStatus(event, 200);
        return { message: "Received" };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
