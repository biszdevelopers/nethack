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

    it("rejects a non-string client state when a secret is configured", () => {
        expect(hasValidMicrosoftWebhookState([{ clientState: 42 }], "secret")).toBe(false);
        expect(hasValidMicrosoftWebhookState([{ clientState: null }], "secret")).toBe(false);
    });

    it("rejects a multibyte client state without throwing", () => {
        const expected = "a".repeat(32);
        const candidate = "α".repeat(16) + "a".repeat(16);
        expect(() =>
            hasValidMicrosoftWebhookState([{ clientState: candidate }], expected),
        ).not.toThrow();
        expect(hasValidMicrosoftWebhookState([{ clientState: candidate }], expected)).toBe(false);
    });
});
