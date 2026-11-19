import { timingSafeEqual } from "node:crypto";

function matchesClientState(candidate: unknown, expected: string): boolean {
    if (typeof candidate !== "string") return false;
    const candidateBytes = Buffer.from(candidate);
    const expectedBytes = Buffer.from(expected);
    // Compare bytes, not UTF-16 code units: a multibyte candidate can have
    // the same `.length` but a different byte length, which makes
    // timingSafeEqual throw and turns a public webhook into a 500.
    if (candidateBytes.length !== expectedBytes.length) return false;
    return timingSafeEqual(candidateBytes, expectedBytes);
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
