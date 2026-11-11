import { describe, expect, it } from "vitest";
import { hasValidMicrosoftWebhookState } from "~~/server/utils/microsoft-webhook-security";

describe("Microsoft Graph webhook state validation", () => {
    it("fails closed when no webhook secret is initialized", () => {
        expect(hasValidMicrosoftWebhookState([{ clientState: null }], null)).toBe(false);
    });

    it("requires every notification in a batch to carry the expected secret", () => {
        expect(
            hasValidMicrosoftWebhookState(
                [{ clientState: "secret" }, { clientState: "wrong" }],
                "secret",
            ),
        ).toBe(false);
    });

    it("accepts a non-empty batch only when every state matches", () => {
        expect(
            hasValidMicrosoftWebhookState(
                [{ clientState: "secret" }, { clientState: "secret" }],
                "secret",
            ),
        ).toBe(true);
        expect(hasValidMicrosoftWebhookState([], "secret")).toBe(false);
    });
});
