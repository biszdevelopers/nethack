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
            notification.clientState === expectedState,
    );
}
