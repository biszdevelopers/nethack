import { beforeAll, describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";

let beforeResponse: ((event: any, response: any) => void) | undefined;

beforeAll(async () => {
    vi.stubGlobal("defineNitroPlugin", (plugin: any) => plugin);
    const plugin = (await import("~~/server/plugins/api-envelope")).default;
    plugin({
        hooks: {
            hook(name: string, callback: typeof beforeResponse) {
                if (name === "beforeResponse") beforeResponse = callback;
            },
        },
    });
});

const applyEnvelope = (body: unknown, statusCode = 200, path = "/api/test") => {
    const response = { body };
    beforeResponse!({ path, node: { res: { statusCode } } }, response);
    return response.body;
};

describe("APIResponse envelope plugin", () => {
    it("wraps object and array domain values and preserves HTTP status", () => {
        expect(applyEnvelope({ status: "in_progress" }, 201)).toEqual({
            status: 201,
            code: 201,
            data: { status: "in_progress" },
        });
        expect(applyEnvelope([1, 2])).toEqual({ status: 200, code: 200, data: [1, 2] });
    });

    it("does not double-wrap canonical envelopes", () => {
        const body = { status: 409, code: 409, error: "conflict", error_description: "No" };
        expect(applyEnvelope(body, 409)).toBe(body);
    });

    it("preserves redirects, streams, and other native responses", () => {
        const response = new Response("redirect", { status: 302 });
        expect(applyEnvelope(response, 302)).toBe(response);
        expect(applyEnvelope("validationToken")).toBe("validationToken");
        expect(applyEnvelope({ ok: true }, 200, "/not-api")).toEqual({ ok: true });
    });

    it("never wraps file downloads or other non-JSON responses", () => {
        const csv = {
            node: { res: { statusCode: 200, getHeader: () => "text/csv; charset=utf-8" } },
        };
        const response = { body: { rows: [] } };
        beforeResponse!({ path: "/api/admin/database/export", ...csv }, response);
        expect(response.body).toEqual({ rows: [] });

        const json = { node: { res: { statusCode: 200, getHeader: () => "application/json" } } };
        const streamed = { body: new PassThrough() };
        beforeResponse!({ path: "/api/admin/database/export", ...json }, streamed);
        expect(streamed.body).toBeInstanceOf(PassThrough);

        const wrapped = { body: { rows: [] } };
        beforeResponse!({ path: "/api/admin/database/export", ...json }, wrapped);
        expect(wrapped.body).toEqual({ status: 200, code: 200, data: { rows: [] } });

        const unset = { node: { res: { statusCode: 200, getHeader: () => undefined } } };
        const fallback = { body: { rows: [] } };
        beforeResponse!({ path: "/api/admin/database/export", ...unset }, fallback);
        expect(fallback.body).toEqual({ status: 200, code: 200, data: { rows: [] } });
    });
});
