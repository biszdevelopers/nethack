import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
    resolve(import.meta.dirname, "..", "..", "app", "components", "ModalConfirm.vue"),
    "utf-8",
);

describe("ModalConfirm.vue", () => {
    it("closes the modal after the Confirm action runs", () => {
        expect(source).toContain("click();");
        expect(source).toContain("close();");
        expect(source).toContain('@click="');
    });

    it("declares an open model with defineModel", () => {
        expect(source).toContain('defineModel("open"');
    });

    it("has a default open value of false", () => {
        expect(source).toContain("default: false");
    });

    it("renders a Confirm button", () => {
        expect(source).toContain("Confirm");
        expect(source).toContain("UButton");
    });

    it("renders a Cancel button", () => {
        expect(source).toContain("Cancel");
    });

    it("renders a color prop with default 'primary'", () => {
        expect(source).toContain("color:");
        expect(source).toContain('default: "primary"');
    });

    it("renders a colorSecond prop with default 'neutral'", () => {
        expect(source).toContain("colorSecond:");
        expect(source).toContain('default: "neutral"');
    });

    it("provides a default click function that does nothing", () => {
        expect(source).toContain("default: () => {}");
    });

    it("uses UModal as the wrapper component", () => {
        expect(source).toContain("UModal");
    });

    it("renders a default slot for content", () => {
        expect(source).toContain("<slot />");
    });

    it("renders a named content slot inside the body", () => {
        expect(source).toContain('name="content"');
    });

    it("renders a footer slot with Confirm and Cancel buttons", () => {
        expect(source).toContain('#footer="{ close }"');
    });

    it("has a cancel button with outline variant", () => {
        expect(source).toContain('variant="outline"');
        expect(source).toContain("Cancel");
    });

    it("the cancel button closes the modal", () => {
        expect(source).toContain('@click="close"');
    });

    it("gives both modal actions enough height for a 44px touch target", () => {
        expect(source.match(/class="min-h-12"/g)).toHaveLength(2);
    });
});
