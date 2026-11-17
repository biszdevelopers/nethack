import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockBody, setupNitroGlobals } from "../helpers";

const mocks = vi.hoisted(() => ({
    test: vi.fn(),
    logout: vi.fn(),
    revoke: vi.fn(),
}));

vi.mock("~~/server/utils/basis-auth-backchannel", () => ({
    handleBackchannelTest: mocks.test,
    applyBasisAuthLogoutToken: mocks.logout,
    applyBasisAuthAccessTokenRevocation: mocks.revoke,
}));

vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (handler: any) => handler,
}));

let handler: any;
const setResponseStatusMock = vi.fn();
const setResponseHeaderMock = vi.fn();

beforeAll(async () => {
    setupNitroGlobals();
    vi.stubGlobal("readRawBody", async () => mockBody.value);
    vi.stubGlobal("setResponseStatus", setResponseStatusMock);
    vi.stubGlobal("setResponseHeader", setResponseHeaderMock);
    handler = (await import("~~/server/api/auth/basis/backchannel.post")).default;
});

beforeEach(() => {
    vi.clearAllMocks();
});

describe("POST /api/auth/basis/backchannel", () => {
    it("answers a webhook test with 202", async () => {
        mockBody.value = "action=test&nonce=nonce&challenge=challenge";

        await expect(handler({ context: {} })).resolves.toEqual({ status: "accepted" });
        expect(mocks.test).toHaveBeenCalledOnce();
        expect(setResponseStatusMock).toHaveBeenCalledWith(expect.anything(), 202);
    });

    it("applies a logout token and answers 204", async () => {
        mockBody.value = "logout_token=signed";

        await handler({ context: {} });
        expect(mocks.logout).toHaveBeenCalledWith(expect.anything(), "signed");
        expect(setResponseStatusMock).toHaveBeenCalledWith(expect.anything(), 204);
    });

    it("applies an access-token revocation and answers 204", async () => {
        mockBody.value =
            "action=revoke_access_token&jti=jti-1&valid_after=1&revocation_token=signed";

        await handler({ context: {} });
        expect(mocks.revoke).toHaveBeenCalledWith(expect.anything(), expect.any(URLSearchParams));
        expect((mocks.revoke.mock.calls[0]![1] as URLSearchParams).get("jti")).toBe("jti-1");
        expect(setResponseStatusMock).toHaveBeenCalledWith(expect.anything(), 204);
    });

    it("rejects unsupported events", async () => {
        mockBody.value = "action=unknown";

        await expect(handler({ context: {} })).rejects.toMatchObject({ statusCode: 400 });
    });

    it("rejects an empty request body", async () => {
        mockBody.value = undefined;

        await expect(handler({ context: {} })).rejects.toMatchObject({ statusCode: 400 });
    });
});
