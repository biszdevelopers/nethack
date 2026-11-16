import { describe, expect, it } from "vitest";
import {
    formatDateTime,
    fromDateTimeLocalString,
    toDateTimeLocalString,
    toValidDate,
} from "~/app/utils/datetime";

describe("toValidDate", () => {
    it("accepts native Date instances, ISO strings, and epoch milliseconds", () => {
        const expected = "2026-01-02T03:04:05.000Z";

        expect(toValidDate(new Date(expected))?.toISOString()).toBe(expected);
        expect(toValidDate(expected)?.toISOString()).toBe(expected);
        expect(toValidDate(Date.parse(expected))?.toISOString()).toBe(expected);
    });

    it("returns null for invalid and absent values instead of exposing toISOString errors", () => {
        expect(toValidDate("not a date")).toBeNull();
        expect(toValidDate(new Date("not a date"))).toBeNull();
        expect(toValidDate(null)).toBeNull();
        expect(toValidDate(undefined)).toBeNull();
    });
});

describe("formatDateTime", () => {
    it("renders every timestamp in the display zone, not the host zone", () => {
        const text = formatDateTime("2026-01-02T03:04:05.000Z");

        expect(text).toContain("2026");
        expect(text).toContain("11:04");
        expect(text).not.toContain("03:04");
    });

    it("names an unavailable date instead of rendering Invalid Date", () => {
        expect(formatDateTime("not a date")).toBe("Date unavailable");
        expect(formatDateTime(null)).toBe("Date unavailable");
    });
});

describe("datetime-local conversions", () => {
    it("builds the form value in the display zone", () => {
        expect(toDateTimeLocalString("2026-01-02T03:04:05.000Z")).toBe("2026-01-02T11:04");
    });

    it("uses midnight as 00:00 instead of 24:00", () => {
        expect(toDateTimeLocalString("2026-01-02T16:00:00.000Z")).toBe("2026-01-03T00:00");
    });

    it("returns an empty value when there is no date", () => {
        expect(toDateTimeLocalString(null)).toBe("");
        expect(toDateTimeLocalString("not a date")).toBe("");
    });

    it("parses the form value back as display-zone time", () => {
        expect(fromDateTimeLocalString("2026-01-02T11:04")).toBe(
            Date.parse("2026-01-02T03:04:00.000Z"),
        );
    });

    it("returns 0 for an empty or invalid form value", () => {
        expect(fromDateTimeLocalString("")).toBe(0);
        expect(fromDateTimeLocalString("not a date")).toBe(0);
    });

    it("round-trips an epoch timestamp through the form value to the same minute", () => {
        const timestamp = Date.parse("2026-07-01T18:45:00.000Z");

        expect(fromDateTimeLocalString(toDateTimeLocalString(timestamp))).toBe(
            Date.parse("2026-07-01T18:45:00.000Z"),
        );
    });
});
