import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatDateTime } from "~/app/utils/datetime";

const source = readFileSync(
    resolve(import.meta.dirname, "..", "..", "app", "components", "DateTime.vue"),
    "utf-8",
);

describe("DateTime SSR output", () => {
    it("renders the formatted value on the server without a ClientOnly wrapper", () => {
        expect(source).not.toContain("ClientOnly");
        expect(source).toContain("<time");
        expect(source).toContain(':datetime="dateTime"');
        expect(source).toContain("{{ text }}");
    });

    it("labels the display zone", () => {
        expect(source).toContain("DISPLAY_TIME_ZONE_LABEL");
        expect(source).toContain("({{ DISPLAY_TIME_ZONE_LABEL }})");
    });
});

describe("display time formatting", () => {
    it("produces the same deterministic string on every format call", () => {
        const value = "2026-01-02T03:04:05.000Z";
        const first = formatDateTime(value);

        expect(first).toBe(formatDateTime(value));
        expect(first).toBe("2026-01-02 11:04");
    });

    it("names missing values instead of throwing", () => {
        expect(formatDateTime(null)).toBe("Date unavailable");
        expect(formatDateTime("not a date")).toBe("Date unavailable");
    });
});
