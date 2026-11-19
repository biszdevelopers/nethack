import { describe, expect, it } from "vitest";
import { databaseErrorCodes, isUniqueViolation } from "~~/server/utils/database/query";

describe("database error code unwrapping", () => {
    it("reads a code from a bare driver error", () => {
        expect(isUniqueViolation(Object.assign(new Error("dup"), { code: "23505" }))).toBe(true);
    });

    it("reads a code from a DrizzleQueryError cause", () => {
        const cause = Object.assign(new Error("dup"), { code: "23505" });
        const wrapped = Object.assign(new Error("Failed query"), { cause });
        expect(isUniqueViolation(wrapped)).toBe(true);
    });

    it("reads a code from a doubly-wrapped error", () => {
        const cause = Object.assign(new Error("dup"), { code: "23505" });
        const wrapped = Object.assign(new Error("Failed query"), { cause: { cause } });
        expect(isUniqueViolation(wrapped)).toBe(true);
    });

    it("does not treat unrelated errors as unique violations", () => {
        expect(isUniqueViolation(Object.assign(new Error("x"), { code: "42P01" }))).toBe(false);
        expect(isUniqueViolation(new Error("no code"))).toBe(false);
    });

    it("collects all codes across the cause chain", () => {
        const wrapped = Object.assign(new Error("outer"), {
            code: "DRIZZLE",
            cause: Object.assign(new Error("inner"), { code: "23505" }),
        });
        expect(databaseErrorCodes(wrapped)).toEqual(["DRIZZLE", "23505"]);
    });
});
