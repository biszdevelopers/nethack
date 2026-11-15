import { timingSafeEqual } from "node:crypto";

function matchesClientState(candidate: unknown, expected: string): boolean {
    if (typeof candidate !== "string" || candidate.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}

/** Graph may batch notifications; every item must carry the configured secret. */
export function hasValidMicrosoftWebhookState(
    value: unknown,
    expectedState: string | null,
): boolean {
    if (!expectedState || !Array.isArray(value) || value.length === 0) return false;

    return value.every(
        (notification) =>
            notification !== null &&
            typeof notification === "object" &&
            "clientState" in notification &&
            matchesClientState(notification.clientState, expectedState),
    );
}
