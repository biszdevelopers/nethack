import { describe, expect, it } from "vitest";
import { unwrapApiResponseData } from "~~/app/utils/api-response";

describe("unwrapApiResponseData", () => {
    it("unwraps the standard API response envelope", () => {
        const data = { version_id: 4, tracks: { junior: { name: "Junior" } } };

        expect(unwrapApiResponseData({ status: 200, code: "ok", data })).toEqual(data);
    });

    it("preserves payloads that are already unwrapped", () => {
        const payload = { id: 8, name: "Team" };

        expect(unwrapApiResponseData(payload)).toBe(payload);
    });

    it("does not unwrap objects that only partially match the envelope", () => {
        const payload = { status: 200, data: { id: 1 } };

        expect(unwrapApiResponseData(payload)).toBe(payload);
    });

    it("preserves null and array payloads", () => {
        expect(unwrapApiResponseData(null)).toBeNull();
        expect(unwrapApiResponseData([])).toEqual([]);
    });
});
