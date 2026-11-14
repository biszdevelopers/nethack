import {
    getChatbotWebhookId,
    getMicrosoftWebhookState,
    refreshChatbotWebhook,
} from "~~/server/plugins/microsoft";
import { readLimitedJsonBody } from "~~/server/utils/limited-json-body";
import { hasValidMicrosoftWebhookState } from "~~/server/utils/microsoft-webhook-security";
import {
    MicrosoftWebhookBody,
    MicrosoftWebhookQuery,
} from "~~/server/utils/microsoft-webhook-validation";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

const MAX_WEBHOOK_REQUEST_BYTES = 64 * 1024;

export default defineEventHandler(
    applyRateLimit(async (event) => {
        // Microsoft Graph sends a validation token as a query parameter during subscription creation/renewal.
        // The endpoint MUST respond with 200 OK and echo the token as text/plain.
        const { validationToken } = await getValidatedQuery(event, MicrosoftWebhookQuery.parse);
        if (validationToken) {
            setResponseHeader(event, "Content-Type", "text/plain; charset=utf-8");
            setResponseStatus(event, 200);
            return validationToken;
        }

        const parsedBody = MicrosoftWebhookBody.safeParse(
            await readLimitedJsonBody(event, MAX_WEBHOOK_REQUEST_BYTES),
        );
        if (!parsedBody.success) {
            console.warn("[MS Graph] Invalid MS Lifecycle");
            throw createError({
                statusCode: 400,
                message: "Bad Request",
            });
        }
        const { value } = parsedBody.data;

        if (!hasValidMicrosoftWebhookState(value, getMicrosoftWebhookState())) {
            console.warn("[MS Graph] Rejected lifecycle notification with invalid client state");
            throw createError({
                statusCode: 403,
                message: "Forbidden",
            });
        }

        const lifecycleEvent = value[0].lifecycleEvent;
        console.log("[MS Graph] Webhook lifecycle received");

        if (lifecycleEvent === "reauthorizationRequired") {
            refreshChatbotWebhook()
                .then(() => {
                    console.log("[MS Graph] Chatbot webhook refreshed successfully");
                })
                .catch((err) => {
                    console.error("[MS Graph] Failed to refresh chatbot webhook:", err);
                });
        }

        setResponseStatus(event, 202);
        return { message: "Received" };
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
